//! Shared format checks for dates and clock times stored as text.

use crate::error::{Error, Result};

/// 'YYYY-MM-DD' with a plausible month/day (calendar validity beyond that is the caller's concern).
pub fn date(s: &str) -> Result<()> {
    let b = s.as_bytes();
    let ok = b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && s[0..4].parse::<u16>().is_ok()
        && matches!(s[5..7].parse::<u8>(), Ok(1..=12))
        && matches!(s[8..10].parse::<u8>(), Ok(1..=31));
    if ok { Ok(()) } else { Err(Error::Invalid(format!("bad date {s:?}"))) }
}

/// 'HH:MM' from 00:00 to 24:00; returns minutes since midnight.
pub fn hm(s: &str) -> Result<u32> {
    let bad = || Error::Invalid(format!("bad time {s:?}"));
    let (h, m) = s.split_once(':').ok_or_else(bad)?;
    if h.len() != 2 || m.len() != 2 {
        return Err(bad());
    }
    let (h, m): (u32, u32) = (h.parse().map_err(|_| bad())?, m.parse().map_err(|_| bad())?);
    if m > 59 || h > 24 || (h == 24 && m > 0) {
        return Err(bad());
    }
    Ok(h * 60 + m)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_and_times() {
        assert!(date("2026-10-02").is_ok());
        assert!(date("2026-13-02").is_err());
        assert!(date("2026-1-2").is_err());
        assert_eq!(hm("09:30").unwrap(), 570);
        assert_eq!(hm("24:00").unwrap(), 1440);
        assert!(hm("24:01").is_err());
        assert!(hm("9:30").is_err());
    }
}
