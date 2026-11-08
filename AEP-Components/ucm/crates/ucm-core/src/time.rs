//! Calendar dates and instants. Time zones come from the tzdb that chrono-tz bundles;
//! its version is part of every receipt through `tzdb_version`.

use crate::error::{domain_err, Result, UcmError};
use crate::num::Rat;
use chrono::{DateTime, Datelike, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use num_bigint::BigInt;
use num_traits::{ToPrimitive, Zero};

pub fn tzdb_version() -> &'static str {
    chrono_tz::IANA_TZDB_VERSION
}

pub fn parse_date(s: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").map_err(|_| UcmError::Input(format!("bad date {s}, expected YYYY-MM-DD")))
}

pub fn date_from_ymd(y: i64, m: i64, d: i64) -> Result<NaiveDate> {
    let (y, m, d) = (i32::try_from(y), u32::try_from(m), u32::try_from(d));
    match (y, m, d) {
        (Ok(y), Ok(m), Ok(d)) => NaiveDate::from_ymd_opt(y, m, d).ok_or_else(|| UcmError::Domain("no such date".into())),
        _ => domain_err("date part out of range"),
    }
}

pub fn days_from_epoch(d: &NaiveDate) -> i64 {
    let epoch = NaiveDate::from_ymd_opt(1970, 1, 1).unwrap_or(NaiveDate::MIN);
    (*d - epoch).num_days()
}

pub fn add_days(d: &NaiveDate, n: i64) -> Result<NaiveDate> {
    d.checked_add_signed(chrono::Duration::try_days(n).ok_or_else(|| UcmError::Domain("day count out of range".into()))?)
        .ok_or_else(|| UcmError::Domain("date out of range".into()))
}

/// Add calendar months. A day past the end of the target month clamps to its last day.
pub fn add_months(d: &NaiveDate, n: i64) -> Result<NaiveDate> {
    let total = d.year() as i64 * 12 + (d.month0() as i64) + n;
    let y = total.div_euclid(12);
    let m = total.rem_euclid(12) + 1;
    let mut day = d.day() as i64;
    loop {
        if let Ok(x) = date_from_ymd(y, m, day) {
            return Ok(x);
        }
        day -= 1;
        if day < 28 {
            return domain_err("date out of range");
        }
    }
}

fn tz(name: &str) -> Result<Tz> {
    name.parse::<Tz>()
        .map_err(|_| UcmError::Domain(format!("unknown time zone {name}")))
}

fn secs_rat(dt: &DateTime<Utc>) -> Rat {
    let s = BigInt::from(dt.timestamp());
    let ns = BigInt::from(dt.timestamp_subsec_nanos());
    Rat::from_integer(s) + Rat::new(ns, BigInt::from(1_000_000_000u64))
}

/// Parse an RFC 3339 instant with an explicit offset, for example 2026-11-07T10:00:00Z.
pub fn parse_instant_utc(s: &str) -> Result<Rat> {
    let dt =
        DateTime::parse_from_rfc3339(s.trim()).map_err(|_| UcmError::Input(format!("bad instant {s}, expected RFC 3339 with offset")))?;
    Ok(secs_rat(&dt.with_timezone(&Utc)))
}

/// Interpret a local wall clock time in a named zone. Ambiguous or skipped local times refuse.
pub fn instant_in_zone(local: &str, zone: &str) -> Result<Rat> {
    let z = tz(zone)?;
    let t = local.trim();
    let naive = NaiveDateTime::parse_from_str(t, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(t, "%Y-%m-%dT%H:%M"))
        .map_err(|_| UcmError::Input(format!("bad local time {local}, expected YYYY-MM-DDTHH:MM[:SS]")))?;
    match z.from_local_datetime(&naive) {
        LocalResult::Single(dt) => Ok(secs_rat(&dt.with_timezone(&Utc))),
        LocalResult::Ambiguous(..) => domain_err(format!("{local} is ambiguous in {zone}")),
        LocalResult::None => domain_err(format!("{local} does not exist in {zone}")),
    }
}

fn utc_of(secs: &Rat) -> Result<DateTime<Utc>> {
    let whole = secs.floor().to_integer();
    let frac = secs - Rat::from_integer(whole.clone());
    let ns = (frac * Rat::from_integer(BigInt::from(1_000_000_000u64))).floor().to_integer();
    let (w, n) = (whole.to_i64(), ns.to_u32());
    match (w, n) {
        (Some(w), Some(n)) => Utc
            .timestamp_opt(w, n)
            .single()
            .ok_or_else(|| UcmError::Domain("instant out of range".into())),
        _ => domain_err("instant out of range"),
    }
}

pub fn local_date(secs: &Rat, zone: &str) -> Result<NaiveDate> {
    Ok(utc_of(secs)?.with_timezone(&tz(zone)?).date_naive())
}

pub fn local_text(secs: &Rat, zone: &str) -> Result<String> {
    Ok(utc_of(secs)?.with_timezone(&tz(zone)?).format("%Y-%m-%dT%H:%M:%S%:z").to_string())
}

pub fn render_instant(secs: &Rat) -> String {
    match utc_of(secs) {
        Ok(dt) => {
            let frac = secs - secs.floor();
            if frac.is_zero() {
                dt.format("%Y-%m-%dT%H:%M:%SZ").to_string()
            } else {
                dt.format("%Y-%m-%dT%H:%M:%S%.9fZ").to_string()
            }
        }
        Err(_) => "out_of_range".into(),
    }
}

pub fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zones_and_months() {
        let a = instant_in_zone("2026-03-29T01:30", "Europe/Zurich").expect("before change");
        let b = instant_in_zone("2026-03-29T03:30", "Europe/Zurich").expect("after change");
        assert_eq!(b - a, Rat::from_integer(BigInt::from(3600)));
        assert!(instant_in_zone("2026-03-29T02:30", "Europe/Zurich").is_err());
        let d = parse_date("2026-01-31").expect("date");
        assert_eq!(add_months(&d, 1).expect("add").to_string(), "2026-02-28");
        assert!(!tzdb_version().is_empty());
    }
}
