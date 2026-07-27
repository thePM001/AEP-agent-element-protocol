// BM-01: exclusive file lock around spend read/modify/append
use serde::{Deserialize, Serialize};
use std::fs::{create_dir_all, File, OpenOptions};
use std::io::{BufRead, BufReader, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize)]
struct SpendEntry {
    date: String,
    amount: f64,
    currency: String,
    ts: String,
}

/// Holds an exclusive flock for the lifetime of the guard (unix).
struct FileLockGuard {
    file: File,
}

impl FileLockGuard {
    fn acquire(path: &Path) -> std::io::Result<Self> {
        if let Some(parent) = path.parent() {
            create_dir_all(parent)?;
        }
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(path)?;
        flock_exclusive(&file)?;
        Ok(Self { file })
    }
}

impl Drop for FileLockGuard {
    fn drop(&mut self) {
        let _ = flock_unlock(&self.file);
    }
}

#[cfg(unix)]
fn flock_exclusive(file: &File) -> std::io::Result<()> {
    use std::os::unix::io::AsRawFd;
    let fd = file.as_raw_fd();
    let rc = unsafe { libc::flock(fd, libc::LOCK_EX) };
    if rc == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(unix)]
fn flock_unlock(file: &File) -> std::io::Result<()> {
    use std::os::unix::io::AsRawFd;
    let fd = file.as_raw_fd();
    let rc = unsafe { libc::flock(fd, libc::LOCK_UN) };
    if rc == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(unix))]
fn flock_exclusive(_file: &File) -> std::io::Result<()> {
    // Non-unix: best-effort no-op (commerce production targets linux/unix).
    Ok(())
}

#[cfg(not(unix))]
fn flock_unlock(_file: &File) -> std::io::Result<()> {
    Ok(())
}

#[derive(Debug)]
pub struct SpendTracker {
    max_daily: f64,
    currency: String,
    file_path: PathBuf,
    today_total: f64,
    today_date: String,
}

impl SpendTracker {
    pub fn new(max_daily: f64, currency: impl Into<String>, base_dir: impl AsRef<Path>) -> Self {
        let file_path = base_dir.as_ref().join("spend.jsonl");
        let today_date = chrono_lite_date();
        let mut tracker = Self {
            max_daily,
            currency: currency.into(),
            file_path,
            today_total: 0.0,
            today_date,
        };
        // Best-effort warm load; authoritative total is reloaded under lock.
        let _ = tracker.reload_under_lock();
        tracker
    }

    fn reload_from_file(&mut self, file: &mut File) -> std::io::Result<()> {
        file.seek(SeekFrom::Start(0))?;
        self.today_total = 0.0;
        for line in BufReader::new(file.try_clone()?).lines().map_while(Result::ok) {
            if let Ok(entry) = serde_json::from_str::<SpendEntry>(&line) {
                if entry.date == self.today_date {
                    self.today_total += entry.amount;
                }
            }
        }
        Ok(())
    }

    fn reload_under_lock(&mut self) -> std::io::Result<()> {
        let mut guard = FileLockGuard::acquire(&self.file_path)?;
        self.today_date = chrono_lite_date();
        self.reload_from_file(&mut guard.file)
    }

    pub fn record(&mut self, amount: f64) {
        let today = chrono_lite_date();
        let Ok(mut guard) = FileLockGuard::acquire(&self.file_path) else {
            return;
        };
        self.today_date = today.clone();
        if self.reload_from_file(&mut guard.file).is_err() {
            return;
        }
        let entry = SpendEntry {
            date: today,
            amount,
            currency: self.currency.clone(),
            ts: chrono_lite_now(),
        };
        let line = match serde_json::to_string(&entry) {
            Ok(s) => s,
            Err(_) => return,
        };
        if guard.file.seek(SeekFrom::End(0)).is_err() {
            return;
        }
        if writeln!(guard.file, "{}", line).is_ok() {
            let _ = guard.file.flush();
            self.today_total += amount;
        }
    }

    /// Returns Ok(true/false) when lock+reload succeed. Err on lock/IO (fail closed).
    pub fn can_spend_checked(&mut self, amount: f64) -> Result<bool, String> {
        let today = chrono_lite_date();
        let mut guard = FileLockGuard::acquire(&self.file_path)
            .map_err(|e| format!("spend ledger lock failed (fail-closed): {e}"))?;
        self.today_date = today;
        self.reload_from_file(&mut guard.file)
            .map_err(|e| format!("spend ledger reload failed (fail-closed): {e}"))?;
        if self.max_daily <= 0.0 {
            // HIGH fail-closed: max_daily <= 0 means no spend allowed (not unlimited).
            return Ok(false);
        }
        Ok(self.today_total + amount <= self.max_daily)
    }

    pub fn can_spend(&mut self, amount: f64) -> bool {
        // Fail closed on lock/IO errors (was: reset total to 0 and allow).
        self.can_spend_checked(amount).unwrap_or(false)
    }

    /// Atomic check+append under one exclusive lock (closes can_spend/record TOCTOU).
    pub fn reserve_and_record(&mut self, amount: f64) -> Result<(), String> {
        if amount <= 0.0 {
            return Ok(());
        }
        let today = chrono_lite_date();
        let mut guard = FileLockGuard::acquire(&self.file_path)
            .map_err(|e| format!("spend ledger lock failed (fail-closed): {e}"))?;
        self.today_date = today.clone();
        self.reload_from_file(&mut guard.file)
            .map_err(|e| format!("spend ledger reload failed (fail-closed): {e}"))?;
        if self.max_daily <= 0.0 {
            return Err(format!(
                "Daily spend denied: max_daily_spend is {} (set a positive limit when commerce is enabled).",
                self.max_daily
            ));
        }
        if self.today_total + amount > self.max_daily {
            return Err(format!(
                "Daily spend limit would be exceeded. Current: {}, requested: {amount}, limit: {}",
                self.today_total, self.max_daily
            ));
        }
        let entry = SpendEntry {
            date: today,
            amount,
            currency: self.currency.clone(),
            ts: chrono_lite_now(),
        };
        let line = serde_json::to_string(&entry)
            .map_err(|e| format!("spend serialize failed: {e}"))?;
        guard
            .file
            .seek(SeekFrom::End(0))
            .map_err(|e| format!("spend seek failed: {e}"))?;
        writeln!(guard.file, "{line}").map_err(|e| format!("spend write failed: {e}"))?;
        guard
            .file
            .flush()
            .map_err(|e| format!("spend flush failed: {e}"))?;
        self.today_total += amount;
        Ok(())
    }

    pub fn today_total(&mut self) -> f64 {
        let _ = self.reload_under_lock();
        self.today_total
    }
}

fn chrono_lite_date() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

fn chrono_lite_now() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::thread;
    use tempfile::tempdir;

    #[test]
    fn bm01_record_under_lock_persists_and_sums() {
        let dir = tempdir().unwrap();
        let mut a = SpendTracker::new(1000.0, "USD", dir.path());
        a.record(10.0);
        a.record(5.5);
        assert!((a.today_total() - 15.5).abs() < 1e-9);
        // second tracker sees file totals
        let mut b = SpendTracker::new(1000.0, "USD", dir.path());
        assert!((b.today_total() - 15.5).abs() < 1e-9);
    }

    #[test]
    fn bm01_concurrent_records_no_lost_writes() {
        let dir = tempdir().unwrap();
        let path = dir.path().to_path_buf();
        let barrier = Arc::new(Barrier::new(8));
        let mut handles = vec![];
        for _ in 0..8 {
            let p = path.clone();
            let b = barrier.clone();
            handles.push(thread::spawn(move || {
                b.wait();
                let mut t = SpendTracker::new(10_000.0, "USD", &p);
                for _ in 0..20 {
                    t.record(1.0);
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        let mut t = SpendTracker::new(10_000.0, "USD", &path);
        let total = t.today_total();
        assert!(
            (total - 160.0).abs() < 1e-6,
            "expected 160.0 concurrent records, got {total}"
        );
    }

    #[test]
    fn bm01_reserve_and_record_atomic_limit() {
        let dir = tempdir().unwrap();
        let mut a = SpendTracker::new(10.0, "USD", dir.path());
        a.reserve_and_record(6.0).unwrap();
        assert!(a.reserve_and_record(5.0).is_err());
        assert!((a.today_total() - 6.0).abs() < 1e-9);
    }

    #[test]
    fn bm01_can_spend_respects_file_total() {
        let dir = tempdir().unwrap();
        let mut a = SpendTracker::new(50.0, "USD", dir.path());
        a.record(40.0);
        let mut b = SpendTracker::new(50.0, "USD", dir.path());
        assert!(!b.can_spend(20.0));
        assert!(b.can_spend(10.0));
    }
}
