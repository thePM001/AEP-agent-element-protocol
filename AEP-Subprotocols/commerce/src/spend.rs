use serde::{Deserialize, Serialize};
use std::fs::{create_dir_all, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize)]
struct SpendEntry {
    date: String,
    amount: f64,
    currency: String,
    ts: String,
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
        tracker.load_today();
        tracker
    }

    fn load_today(&mut self) {
        self.today_total = 0.0;
        let Ok(file) = std::fs::File::open(&self.file_path) else {
            return;
        };
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            if let Ok(entry) = serde_json::from_str::<SpendEntry>(&line) {
                if entry.date == self.today_date {
                    self.today_total += entry.amount;
                }
            }
        }
    }

    pub fn record(&mut self, amount: f64) {
        let today = chrono_lite_date();
        if today != self.today_date {
            self.today_date = today.clone();
            self.today_total = 0.0;
        }
        self.today_total += amount;
        if let Some(parent) = self.file_path.parent() {
            let _ = create_dir_all(parent);
        }
        if let Ok(mut f) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.file_path)
        {
            let entry = SpendEntry {
                date: today,
                amount,
                currency: self.currency.clone(),
                ts: chrono_lite_now(),
            };
            let _ = writeln!(f, "{}", serde_json::to_string(&entry).unwrap_or_default());
        }
    }

    pub fn can_spend(&mut self, amount: f64) -> bool {
        let today = chrono_lite_date();
        if today != self.today_date {
            self.today_date = today;
            self.today_total = 0.0;
        }
        if self.max_daily <= 0.0 {
            return true;
        }
        self.today_total + amount <= self.max_daily
    }

    pub fn today_total(&mut self) -> f64 {
        let today = chrono_lite_date();
        if today != self.today_date {
            self.today_date = today;
            self.today_total = 0.0;
        }
        self.today_total
    }
}

fn chrono_lite_date() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

fn chrono_lite_now() -> String {
    chrono::Utc::now().to_rfc3339()
}