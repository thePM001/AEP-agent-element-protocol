//! Timestamps as unix seconds. Integer arithmetic only, so every target agrees.
//!
//! A record carries the time of its verdict. Callers hand it over as unix seconds,
//! as unix milliseconds or as an ISO 8601 text. A text that is none of these is an
//! error. It is never replaced by the present time.

use crate::error::CoreError;

/// Unix values at or above this bound are read as milliseconds. In seconds the bound is
/// the year 5138, so no value of seconds in use reaches it.
const MILLIS_FLOOR: i64 = 100_000_000_000;

const SECONDS_PER_DAY: i64 = 86_400;

/// Days from 1970-01-01 to the given civil date of the proleptic Gregorian calendar.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn is_leap(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        _ => {
            if is_leap(year) {
                29
            } else {
                28
            }
        }
    }
}

/// Read exactly `len` ASCII digits at `at`.
fn digits(bytes: &[u8], at: usize, len: usize) -> Option<i64> {
    let slice = bytes.get(at..at.checked_add(len)?)?;
    let mut value: i64 = 0;
    for b in slice {
        if !b.is_ascii_digit() {
            return None;
        }
        value = value * 10 + i64::from(b - b'0');
    }
    Some(value)
}

fn parse_unix_number(text: &str) -> Option<i64> {
    let body = text.strip_prefix('-').unwrap_or(text);
    if body.is_empty() || body.len() > 18 || !body.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let value: i64 = text.parse().ok()?;
    if value >= MILLIS_FLOOR || value <= -MILLIS_FLOOR {
        Some(value.div_euclid(1000))
    } else {
        Some(value)
    }
}

/// Offset of a zone suffix in seconds east of UTC. An empty suffix is UTC.
fn parse_zone(rest: &[u8]) -> Option<i64> {
    match rest {
        [] | [b'Z'] | [b'z'] => Some(0),
        [sign @ (b'+' | b'-'), tail @ ..] => {
            let (hours, minutes) = match tail.len() {
                2 => (digits(tail, 0, 2)?, 0),
                4 => (digits(tail, 0, 2)?, digits(tail, 2, 2)?),
                5 if tail[2] == b':' => (digits(tail, 0, 2)?, digits(tail, 3, 2)?),
                _ => return None,
            };
            if hours > 23 || minutes > 59 {
                return None;
            }
            let offset = hours * 3600 + minutes * 60;
            Some(if *sign == b'-' { -offset } else { offset })
        }
        _ => None,
    }
}

fn parse_iso(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    let year = digits(bytes, 0, 4)?;
    if bytes.get(4) != Some(&b'-') || bytes.get(7) != Some(&b'-') {
        return None;
    }
    let month = digits(bytes, 5, 2)?;
    let day = digits(bytes, 8, 2)?;
    if !(1..=12).contains(&month) || day < 1 || day > days_in_month(year, month) {
        return None;
    }
    let date = days_from_civil(year, month, day) * SECONDS_PER_DAY;
    if bytes.len() == 10 {
        return Some(date);
    }
    if !matches!(bytes.get(10), Some(b'T' | b't' | b' ')) || bytes.get(13) != Some(&b':') {
        return None;
    }
    let hour = digits(bytes, 11, 2)?;
    let minute = digits(bytes, 14, 2)?;
    let mut at = 16;
    let mut second = 0;
    if bytes.get(at) == Some(&b':') {
        second = digits(bytes, at + 1, 2)?;
        at += 3;
        if bytes.get(at) == Some(&b'.') {
            let start = at + 1;
            let mut end = start;
            while bytes.get(end).is_some_and(u8::is_ascii_digit) {
                end += 1;
            }
            if end == start {
                return None;
            }
            at = end;
        }
    }
    // A leap second is read as the second before it, so the result remains monotonic.
    if hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let second = second.min(59);
    let offset = parse_zone(bytes.get(at..)?)?;
    Some(date + hour * 3600 + minute * 60 + second - offset)
}

/// Unix seconds of a timestamp text.
///
/// Accepted forms: unix seconds, unix milliseconds and ISO 8601 with a date, an optional
/// time and an optional zone. A text without a zone is read as UTC. Fractions of a
/// second are dropped.
pub fn parse_timestamp_unix(text: &str) -> Result<i64, CoreError> {
    let trimmed = text.trim();
    if let Some(value) = parse_unix_number(trimmed) {
        return Ok(value);
    }
    match parse_iso(trimmed) {
        Some(value) => Ok(value),
        None => Err(CoreError::Timestamp(trimmed.chars().take(64).collect())),
    }
}

/// The civil date of a count of days since 1970-01-01.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// Unix seconds as ISO 8601 text in UTC, such as `2026-11-20T19:20:40Z`.
pub fn format_unix_iso(unix: i64) -> String {
    let days = unix.div_euclid(SECONDS_PER_DAY);
    let second_of_day = unix.rem_euclid(SECONDS_PER_DAY);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        second_of_day / 3600,
        second_of_day % 3600 / 60,
        second_of_day % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unix_seconds_format_as_iso_and_parse_back() {
        assert_eq!(format_unix_iso(0), "1970-01-01T00:00:00Z");
        assert_eq!(format_unix_iso(1_795_202_440), "2026-11-20T19:20:40Z");
        assert_eq!(format_unix_iso(-1), "1969-12-31T23:59:59Z");
        assert_eq!(format_unix_iso(951_868_800), "2000-03-01T00:00:00Z");
        let mut unix = -4_000_000_000i64;
        while unix < 8_000_000_000 {
            assert_eq!(parse_timestamp_unix(&format_unix_iso(unix)).unwrap(), unix);
            unix += 86_399 * 37 + 11;
        }
    }

    #[test]
    fn iso_timestamp_parses_to_correct_unix() {
        assert_eq!(parse_timestamp_unix("1970-01-01T00:00:00Z").unwrap(), 0);
        assert_eq!(
            parse_timestamp_unix("2000-03-01T00:00:00Z").unwrap(),
            951_868_800
        );
        assert_eq!(
            parse_timestamp_unix("2026-11-20T19:20:40Z").unwrap(),
            1_795_202_440
        );
        // The form JavaScript writes with toISOString.
        assert_eq!(
            parse_timestamp_unix("2026-11-20T19:20:40.123Z").unwrap(),
            1_795_202_440
        );
    }

    #[test]
    fn iso_timestamp_is_not_read_as_a_date_in_2034() {
        // Reading the first ten digits of the text as unix seconds gave 2026112019,
        // a date in 2034. The right value lies in 2026.
        let parsed = parse_timestamp_unix("2026-11-20T19:20:40Z").unwrap();
        assert_ne!(parsed, 2_026_112_019);
        assert!((1_767_225_600..1_798_761_600).contains(&parsed));
    }

    #[test]
    fn zone_offsets_are_applied() {
        let utc = parse_timestamp_unix("2024-02-29T10:00:00Z").unwrap();
        assert_eq!(utc, 1_709_200_800);
        assert_eq!(
            parse_timestamp_unix("2024-02-29T12:00:00+02:00").unwrap(),
            utc
        );
        assert_eq!(
            parse_timestamp_unix("2024-02-29T05:30:00-0430").unwrap(),
            utc
        );
        assert_eq!(parse_timestamp_unix("2024-02-29T11:00:00+01").unwrap(), utc);
        assert_eq!(parse_timestamp_unix("2024-02-29 10:00:00").unwrap(), utc);
        assert_eq!(parse_timestamp_unix("2024-02-29T10:00Z").unwrap(), utc);
    }

    #[test]
    fn date_without_time_is_midnight_utc() {
        assert_eq!(parse_timestamp_unix("2026-11-20").unwrap(), 1_795_132_800);
    }

    #[test]
    fn unix_seconds_and_milliseconds_are_accepted() {
        assert_eq!(parse_timestamp_unix("1795202440").unwrap(), 1_795_202_440);
        assert_eq!(
            parse_timestamp_unix("1795202440123").unwrap(),
            1_795_202_440
        );
        assert_eq!(parse_timestamp_unix(" 0 ").unwrap(), 0);
        assert_eq!(parse_timestamp_unix("-86400").unwrap(), -86_400);
    }

    #[test]
    fn dates_before_the_epoch_parse() {
        assert_eq!(parse_timestamp_unix("1969-12-31T23:59:59Z").unwrap(), -1);
        assert_eq!(
            parse_timestamp_unix("1900-01-01T00:00:00Z").unwrap(),
            -2_208_988_800
        );
    }

    #[test]
    fn malformed_text_is_an_error_and_never_the_present_time() {
        for bad in [
            "",
            "soon",
            "2026-13-01T00:00:00Z",
            "2026-02-30T00:00:00Z",
            "2025-02-29",
            "2026-11-20T24:00:00Z",
            "2026-11-20T19:60:00Z",
            "2026-11-20T19:20:40.Z",
            "2026-11-20T19:20:40+25:00",
            "2026-11-20T19:20:40 UTC",
            "2026-11-20X19:20:40Z",
        ] {
            assert!(
                matches!(parse_timestamp_unix(bad), Err(CoreError::Timestamp(_))),
                "{bad}"
            );
        }
    }

    #[test]
    fn every_day_of_four_centuries_is_one_day_after_the_day_before() {
        let mut expected = days_from_civil(1900, 1, 1);
        for year in 1900..2300 {
            for month in 1..=12 {
                for day in 1..=days_in_month(year, month) {
                    assert_eq!(days_from_civil(year, month, day), expected);
                    expected += 1;
                }
            }
        }
    }
}
