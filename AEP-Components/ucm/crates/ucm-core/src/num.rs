//! Exact number helpers: rationals, fixed scale decimals and explicit rounding.

use crate::error::{domain_err, Result, UcmError};
use num_bigint::{BigInt, Sign};
use num_integer::Integer;
use num_rational::BigRational;
use num_traits::{One, Signed, ToPrimitive, Zero};

pub type Rat = BigRational;

pub fn int(i: i64) -> BigInt {
    BigInt::from(i)
}

pub fn rat_int(i: BigInt) -> Rat {
    Rat::from_integer(i)
}

pub fn pow10(n: u32) -> BigInt {
    num_traits::pow(BigInt::from(10u32), n as usize)
}

/// A fixed scale decimal: value = unscaled / 10^scale.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decimal {
    pub unscaled: BigInt,
    pub scale: u32,
}

/// Largest scale a decimal may carry. Bounds memory and formatting work.
pub const MAX_SCALE: u32 = 10_000;

impl Decimal {
    pub fn to_rat(&self) -> Rat {
        Rat::new(self.unscaled.clone(), pow10(self.scale))
    }

    pub fn from_int(i: &BigInt) -> Decimal {
        Decimal {
            unscaled: i.clone(),
            scale: 0,
        }
    }

    pub fn rescale_up(&self, scale: u32) -> Decimal {
        if scale <= self.scale {
            return self.clone();
        }
        Decimal {
            unscaled: &self.unscaled * pow10(scale - self.scale),
            scale,
        }
    }

    pub fn render(&self) -> String {
        let neg = self.unscaled.sign() == Sign::Minus;
        let digits = self.unscaled.abs().to_string();
        let s = self.scale as usize;
        let body = if s == 0 {
            digits
        } else if digits.len() > s {
            format!(
                "{}.{}",
                &digits[..digits.len() - s],
                &digits[digits.len() - s..]
            )
        } else {
            format!("0.{}{}", "0".repeat(s - digits.len()), digits)
        };
        if neg {
            format!("-{body}")
        } else {
            body
        }
    }
}

/// Rounding modes. Every operation that can lose digits names one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoundMode {
    HalfEven,
    HalfUp,
    HalfDown,
    Up,
    Down,
    Floor,
    Ceiling,
}

impl RoundMode {
    pub fn parse(s: &str) -> Result<RoundMode> {
        Ok(match s {
            "half_even" => RoundMode::HalfEven,
            "half_up" => RoundMode::HalfUp,
            "half_down" => RoundMode::HalfDown,
            "up" => RoundMode::Up,
            "down" => RoundMode::Down,
            "floor" => RoundMode::Floor,
            "ceiling" => RoundMode::Ceiling,
            other => return domain_err(format!("unknown rounding mode {other}")),
        })
    }

    pub const NAMES: [&'static str; 7] = [
        "half_even",
        "half_up",
        "half_down",
        "up",
        "down",
        "floor",
        "ceiling",
    ];
}

/// Round a rational to an integer with the given mode.
pub fn round_rat_to_int(r: &Rat, mode: RoundMode) -> BigInt {
    let floor = r.floor().to_integer();
    let frac = r - Rat::from_integer(floor.clone());
    if frac.is_zero() {
        return floor;
    }
    let ceil = &floor + BigInt::one();
    let half = Rat::new(BigInt::one(), BigInt::from(2));
    let positive = r.is_positive();
    match mode {
        RoundMode::Floor => floor,
        RoundMode::Ceiling => ceil,
        RoundMode::Down => {
            if positive {
                floor
            } else {
                ceil
            }
        }
        RoundMode::Up => {
            if positive {
                ceil
            } else {
                floor
            }
        }
        RoundMode::HalfUp | RoundMode::HalfDown | RoundMode::HalfEven => {
            if frac < half {
                floor
            } else if frac > half {
                ceil
            } else {
                match mode {
                    RoundMode::HalfUp => {
                        if positive {
                            ceil
                        } else {
                            floor
                        }
                    }
                    RoundMode::HalfDown => {
                        if positive {
                            floor
                        } else {
                            ceil
                        }
                    }
                    _ => {
                        if floor.is_even() {
                            floor
                        } else {
                            ceil
                        }
                    }
                }
            }
        }
    }
}

pub fn round_to_scale(r: &Rat, scale: u32, mode: RoundMode) -> Result<Decimal> {
    if scale > MAX_SCALE {
        return domain_err(format!("scale {scale} above the limit {MAX_SCALE}"));
    }
    let scaled = r * Rat::from_integer(pow10(scale));
    Ok(Decimal {
        unscaled: round_rat_to_int(&scaled, mode),
        scale,
    })
}

/// Parse an exact number literal: 12, -3, 1/3, 12.50, 1.5e-3, 2E6.
pub fn parse_rat(s: &str) -> Result<Rat> {
    let t = s.trim();
    if let Some((n, d)) = t.split_once('/') {
        let n: BigInt = n
            .trim()
            .parse()
            .map_err(|_| UcmError::Input(format!("bad rational {t}")))?;
        let d: BigInt = d
            .trim()
            .parse()
            .map_err(|_| UcmError::Input(format!("bad rational {t}")))?;
        if d.is_zero() {
            return Err(UcmError::DivisionByZero);
        }
        return Ok(Rat::new(n, d));
    }
    Ok(parse_decimal(t)?.to_rat())
}

/// Parse a decimal literal and keep its written scale.
pub fn parse_decimal(s: &str) -> Result<Decimal> {
    let t = s.trim();
    let bad = || UcmError::Input(format!("bad number {t}"));
    let (mant, exp) = match t.find(['e', 'E']) {
        Some(i) => (&t[..i], t[i + 1..].parse::<i64>().map_err(|_| bad())?),
        None => (t, 0i64),
    };
    if exp.abs() > MAX_SCALE as i64 {
        return Err(bad());
    }
    let (neg, body) = match mant.strip_prefix('-') {
        Some(b) => (true, b),
        None => (false, mant.strip_prefix('+').unwrap_or(mant)),
    };
    let (ip, fp) = body.split_once('.').unwrap_or((body, ""));
    if ip.is_empty() && fp.is_empty() {
        return Err(bad());
    }
    if !ip.chars().all(|c| c.is_ascii_digit()) || !fp.chars().all(|c| c.is_ascii_digit()) {
        return Err(bad());
    }
    let digits = format!("{ip}{fp}");
    let mut unscaled: BigInt = if digits.is_empty() {
        BigInt::zero()
    } else {
        digits.parse().map_err(|_| bad())?
    };
    if neg {
        unscaled = -unscaled;
    }
    let mut scale = fp.len() as i64 - exp;
    if scale < 0 {
        unscaled *= pow10((-scale) as u32);
        scale = 0;
    }
    if scale > MAX_SCALE as i64 {
        return Err(bad());
    }
    Ok(Decimal {
        unscaled,
        scale: scale as u32,
    })
}

/// Canonical rational text: "n" or "n/d", always reduced.
pub fn render_rat(r: &Rat) -> String {
    if r.is_integer() {
        r.numer().to_string()
    } else {
        format!("{}/{}", r.numer(), r.denom())
    }
}

/// Exact decimal text when the rational terminates in base 10.
pub fn terminating_decimal(r: &Rat) -> Option<String> {
    let mut d = r.denom().clone();
    let mut twos = 0u32;
    let mut fives = 0u32;
    let two = BigInt::from(2);
    let five = BigInt::from(5);
    while (&d % &two).is_zero() {
        d /= &two;
        twos += 1;
    }
    while (&d % &five).is_zero() {
        d /= &five;
        fives += 1;
    }
    if !d.is_one() {
        return None;
    }
    let scale = twos.max(fives);
    if scale > MAX_SCALE {
        return None;
    }
    let unscaled = (r * Rat::from_integer(pow10(scale))).to_integer();
    Some(Decimal { unscaled, scale }.render())
}

pub fn bits(i: &BigInt) -> u64 {
    i.bits()
}

pub fn rat_bits(r: &Rat) -> u64 {
    r.numer().bits().max(r.denom().bits())
}

/// floor(sqrt(n)) for n >= 0.
pub fn isqrt(n: &BigInt) -> BigInt {
    n.sqrt()
}

/// Square root of a non-negative rational, rounded to `scale` digits.
pub fn sqrt_round(r: &Rat, scale: u32, mode: RoundMode) -> Result<Decimal> {
    if r.is_negative() {
        return domain_err("sqrt of a negative number");
    }
    if scale > MAX_SCALE {
        return domain_err("scale above the limit");
    }
    // y = r * 10^(2 scale); root = sqrt(y); result = root / 10^scale.
    let y = r * Rat::from_integer(pow10(2 * scale));
    let fl = isqrt(&y.floor().to_integer());
    let fl_r = Rat::from_integer(fl.clone());
    if &fl_r * &fl_r == y {
        return Ok(Decimal {
            unscaled: fl,
            scale,
        });
    }
    // Irrational or non-exact root lies strictly between fl and fl + 1.
    let half = Rat::new(BigInt::one(), BigInt::from(2));
    let mid = &fl_r + &half;
    let mid_sq = &mid * &mid;
    let unscaled = match mode {
        RoundMode::Floor | RoundMode::Down => fl,
        RoundMode::Ceiling | RoundMode::Up => fl + BigInt::one(),
        _ => {
            if y < mid_sq {
                fl
            } else if y > mid_sq {
                fl + BigInt::one()
            } else {
                // y equals (fl + 1/2)^2 only when y is not an integer square: tie.
                round_rat_to_int(&mid, mode)
            }
        }
    };
    Ok(Decimal { unscaled, scale })
}

pub fn pow_rat(base: &Rat, exp: i64) -> Result<Rat> {
    if exp < 0 {
        if base.is_zero() {
            return Err(UcmError::DivisionByZero);
        }
        let p = num_traits::pow(base.clone(), exp.unsigned_abs() as usize);
        return Ok(p.recip());
    }
    Ok(num_traits::pow(base.clone(), exp as usize))
}

pub fn to_i64(r: &Rat) -> Option<i64> {
    if r.is_integer() {
        r.numer().to_i64()
    } else {
        None
    }
}

/// Exact rational value of an f64.
pub fn rat_from_f64(f: f64) -> Result<Rat> {
    Rat::from_float(f).ok_or_else(|| UcmError::Domain("float is not finite".into()))
}

pub fn rat_to_f64(r: &Rat) -> f64 {
    r.to_f64().unwrap_or(f64::NAN)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounding_modes_on_ties() {
        let r = Rat::new(BigInt::from(5), BigInt::from(2));
        assert_eq!(round_rat_to_int(&r, RoundMode::HalfEven), BigInt::from(2));
        assert_eq!(round_rat_to_int(&r, RoundMode::HalfUp), BigInt::from(3));
        assert_eq!(round_rat_to_int(&r, RoundMode::HalfDown), BigInt::from(2));
        let n = -r;
        assert_eq!(round_rat_to_int(&n, RoundMode::HalfUp), BigInt::from(-3));
        assert_eq!(round_rat_to_int(&n, RoundMode::Floor), BigInt::from(-3));
        assert_eq!(round_rat_to_int(&n, RoundMode::Down), BigInt::from(-2));
    }

    #[test]
    fn decimal_parse_and_render() {
        assert_eq!(
            parse_decimal("12.50").map(|d| d.render()),
            Ok("12.50".into())
        );
        assert_eq!(
            parse_decimal("-0.05").map(|d| d.render()),
            Ok("-0.05".into())
        );
        assert_eq!(
            parse_decimal("1.5e-3").map(|d| d.render()),
            Ok("0.0015".into())
        );
        assert_eq!(parse_decimal("2E3").map(|d| d.render()), Ok("2000".into()));
        assert!(parse_decimal("1.2.3").is_err());
    }

    #[test]
    fn sqrt_rounding() {
        let two = Rat::from_integer(BigInt::from(2));
        assert_eq!(
            sqrt_round(&two, 5, RoundMode::HalfEven).map(|d| d.render()),
            Ok("1.41421".into())
        );
        assert_eq!(
            sqrt_round(&two, 5, RoundMode::Ceiling).map(|d| d.render()),
            Ok("1.41422".into())
        );
        let nine = Rat::from_integer(BigInt::from(9));
        assert_eq!(
            sqrt_round(&nine, 2, RoundMode::Floor).map(|d| d.render()),
            Ok("3.00".into())
        );
    }

    #[test]
    fn terminating() {
        assert_eq!(
            terminating_decimal(&Rat::new(BigInt::from(1), BigInt::from(8))),
            Some("0.125".into())
        );
        assert_eq!(
            terminating_decimal(&Rat::new(BigInt::from(1), BigInt::from(3))),
            None
        );
    }
}
