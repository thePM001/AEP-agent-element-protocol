//! SI dimensions and exact unit factors. Every factor is an exact rational.
//! Affine temperature scales are not units here. Use the celsius and fahrenheit functions.

use crate::error::{Result, UcmError};
use crate::num::{parse_rat, Rat};
use num_bigint::BigInt;
use num_traits::{One, Zero};

/// Exponents of the seven SI base quantities: m, kg, s, A, K, mol, cd.
pub type Dim = [i8; 7];

pub const DIMLESS: Dim = [0; 7];
const BASE_SYMBOLS: [&str; 7] = ["m", "kg", "s", "A", "K", "mol", "cd"];

pub fn dim_add(a: &Dim, b: &Dim) -> Result<Dim> {
    let mut out = [0i8; 7];
    for i in 0..7 {
        out[i] = a[i]
            .checked_add(b[i])
            .ok_or_else(|| UcmError::Unit("dimension exponent overflow".into()))?;
    }
    Ok(out)
}

pub fn dim_neg(a: &Dim) -> Dim {
    let mut out = [0i8; 7];
    for i in 0..7 {
        out[i] = -a[i];
    }
    out
}

pub fn dim_scale(a: &Dim, n: i64) -> Result<Dim> {
    let mut out = [0i8; 7];
    for i in 0..7 {
        let v = (a[i] as i64) * n;
        out[i] =
            i8::try_from(v).map_err(|_| UcmError::Unit("dimension exponent overflow".into()))?;
    }
    Ok(out)
}

/// Canonical SI text of a dimension, for example "kg*m/s^2". Dimensionless is "1".
pub fn dim_render(d: &Dim) -> String {
    let mut num = Vec::new();
    let mut den = Vec::new();
    for i in 0..7 {
        let e = d[i];
        if e > 0 {
            num.push(if e == 1 {
                BASE_SYMBOLS[i].to_string()
            } else {
                format!("{}^{}", BASE_SYMBOLS[i], e)
            });
        } else if e < 0 {
            den.push(if e == -1 {
                BASE_SYMBOLS[i].to_string()
            } else {
                format!("{}^{}", BASE_SYMBOLS[i], -e)
            });
        }
    }
    let n = if num.is_empty() {
        "1".to_string()
    } else {
        num.join("*")
    };
    if den.is_empty() {
        n
    } else {
        format!("{}/{}", n, den.join("*"))
    }
}

/// A unit: factor to SI base units and its dimension.
#[derive(Debug, Clone, PartialEq)]
pub struct Unit {
    pub factor: Rat,
    pub dim: Dim,
}

struct Atom {
    sym: &'static str,
    factor: &'static str,
    dim: Dim,
    prefixable: bool,
    name: &'static str,
}

const fn d(m: i8, kg: i8, s: i8, a: i8, k: i8, mol: i8, cd: i8) -> Dim {
    [m, kg, s, a, k, mol, cd]
}

// Factors are exact. Sources: SI Brochure 9th edition (2019) for SI and accepted units,
// NIST SP 811 (2008) for the international inch, foot, yard, mile, pound and US gallon.
const ATOMS: &[Atom] = &[
    Atom {
        sym: "m",
        factor: "1",
        dim: d(1, 0, 0, 0, 0, 0, 0),
        prefixable: true,
        name: "metre",
    },
    Atom {
        sym: "g",
        factor: "1/1000",
        dim: d(0, 1, 0, 0, 0, 0, 0),
        prefixable: true,
        name: "gram",
    },
    Atom {
        sym: "s",
        factor: "1",
        dim: d(0, 0, 1, 0, 0, 0, 0),
        prefixable: true,
        name: "second",
    },
    Atom {
        sym: "A",
        factor: "1",
        dim: d(0, 0, 0, 1, 0, 0, 0),
        prefixable: true,
        name: "ampere",
    },
    Atom {
        sym: "K",
        factor: "1",
        dim: d(0, 0, 0, 0, 1, 0, 0),
        prefixable: true,
        name: "kelvin",
    },
    Atom {
        sym: "mol",
        factor: "1",
        dim: d(0, 0, 0, 0, 0, 1, 0),
        prefixable: true,
        name: "mole",
    },
    Atom {
        sym: "cd",
        factor: "1",
        dim: d(0, 0, 0, 0, 0, 0, 1),
        prefixable: true,
        name: "candela",
    },
    Atom {
        sym: "Hz",
        factor: "1",
        dim: d(0, 0, -1, 0, 0, 0, 0),
        prefixable: true,
        name: "hertz",
    },
    Atom {
        sym: "N",
        factor: "1",
        dim: d(1, 1, -2, 0, 0, 0, 0),
        prefixable: true,
        name: "newton",
    },
    Atom {
        sym: "Pa",
        factor: "1",
        dim: d(-1, 1, -2, 0, 0, 0, 0),
        prefixable: true,
        name: "pascal",
    },
    Atom {
        sym: "J",
        factor: "1",
        dim: d(2, 1, -2, 0, 0, 0, 0),
        prefixable: true,
        name: "joule",
    },
    Atom {
        sym: "W",
        factor: "1",
        dim: d(2, 1, -3, 0, 0, 0, 0),
        prefixable: true,
        name: "watt",
    },
    Atom {
        sym: "C",
        factor: "1",
        dim: d(0, 0, 1, 1, 0, 0, 0),
        prefixable: true,
        name: "coulomb",
    },
    Atom {
        sym: "V",
        factor: "1",
        dim: d(2, 1, -3, -1, 0, 0, 0),
        prefixable: true,
        name: "volt",
    },
    Atom {
        sym: "F",
        factor: "1",
        dim: d(-2, -1, 4, 2, 0, 0, 0),
        prefixable: true,
        name: "farad",
    },
    Atom {
        sym: "ohm",
        factor: "1",
        dim: d(2, 1, -3, -2, 0, 0, 0),
        prefixable: true,
        name: "ohm",
    },
    Atom {
        sym: "S",
        factor: "1",
        dim: d(-2, -1, 3, 2, 0, 0, 0),
        prefixable: true,
        name: "siemens",
    },
    Atom {
        sym: "Wb",
        factor: "1",
        dim: d(2, 1, -2, -1, 0, 0, 0),
        prefixable: true,
        name: "weber",
    },
    Atom {
        sym: "T",
        factor: "1",
        dim: d(0, 1, -2, -1, 0, 0, 0),
        prefixable: true,
        name: "tesla",
    },
    Atom {
        sym: "H",
        factor: "1",
        dim: d(2, 1, -2, -2, 0, 0, 0),
        prefixable: true,
        name: "henry",
    },
    Atom {
        sym: "lm",
        factor: "1",
        dim: d(0, 0, 0, 0, 0, 0, 1),
        prefixable: true,
        name: "lumen",
    },
    Atom {
        sym: "lx",
        factor: "1",
        dim: d(-2, 0, 0, 0, 0, 0, 1),
        prefixable: true,
        name: "lux",
    },
    Atom {
        sym: "Bq",
        factor: "1",
        dim: d(0, 0, -1, 0, 0, 0, 0),
        prefixable: true,
        name: "becquerel",
    },
    Atom {
        sym: "Gy",
        factor: "1",
        dim: d(2, 0, -2, 0, 0, 0, 0),
        prefixable: true,
        name: "gray",
    },
    Atom {
        sym: "Sv",
        factor: "1",
        dim: d(2, 0, -2, 0, 0, 0, 0),
        prefixable: true,
        name: "sievert",
    },
    Atom {
        sym: "kat",
        factor: "1",
        dim: d(0, 0, -1, 0, 0, 1, 0),
        prefixable: true,
        name: "katal",
    },
    Atom {
        sym: "L",
        factor: "1/1000",
        dim: d(3, 0, 0, 0, 0, 0, 0),
        prefixable: true,
        name: "litre",
    },
    Atom {
        sym: "t",
        factor: "1000",
        dim: d(0, 1, 0, 0, 0, 0, 0),
        prefixable: false,
        name: "tonne",
    },
    Atom {
        sym: "min",
        factor: "60",
        dim: d(0, 0, 1, 0, 0, 0, 0),
        prefixable: false,
        name: "minute",
    },
    Atom {
        sym: "h",
        factor: "3600",
        dim: d(0, 0, 1, 0, 0, 0, 0),
        prefixable: false,
        name: "hour",
    },
    Atom {
        sym: "day",
        factor: "86400",
        dim: d(0, 0, 1, 0, 0, 0, 0),
        prefixable: false,
        name: "day",
    },
    Atom {
        sym: "week",
        factor: "604800",
        dim: d(0, 0, 1, 0, 0, 0, 0),
        prefixable: false,
        name: "week",
    },
    Atom {
        sym: "ha",
        factor: "10000",
        dim: d(2, 0, 0, 0, 0, 0, 0),
        prefixable: false,
        name: "hectare",
    },
    Atom {
        sym: "bar",
        factor: "100000",
        dim: d(-1, 1, -2, 0, 0, 0, 0),
        prefixable: true,
        name: "bar",
    },
    Atom {
        sym: "atm",
        factor: "101325",
        dim: d(-1, 1, -2, 0, 0, 0, 0),
        prefixable: false,
        name: "standard atmosphere",
    },
    Atom {
        sym: "eV",
        factor: "1.602176634e-19",
        dim: d(2, 1, -2, 0, 0, 0, 0),
        prefixable: true,
        name: "electronvolt",
    },
    Atom {
        sym: "Wh",
        factor: "3600",
        dim: d(2, 1, -2, 0, 0, 0, 0),
        prefixable: true,
        name: "watt hour",
    },
    Atom {
        sym: "cal",
        factor: "4.184",
        dim: d(2, 1, -2, 0, 0, 0, 0),
        prefixable: true,
        name: "thermochemical calorie",
    },
    // IAU 2012 Resolution B2 value of the astronomical unit, written as an exact fraction.
    Atom {
        sym: "au",
        factor: "299195741400/2",
        dim: d(1, 0, 0, 0, 0, 0, 0),
        prefixable: false,
        name: "astronomical unit",
    },
    Atom {
        sym: "in",
        factor: "0.0254",
        dim: d(1, 0, 0, 0, 0, 0, 0),
        prefixable: false,
        name: "inch",
    },
    Atom {
        sym: "ft",
        factor: "0.3048",
        dim: d(1, 0, 0, 0, 0, 0, 0),
        prefixable: false,
        name: "foot",
    },
    Atom {
        sym: "yd",
        factor: "0.9144",
        dim: d(1, 0, 0, 0, 0, 0, 0),
        prefixable: false,
        name: "yard",
    },
    Atom {
        sym: "mi",
        factor: "1609.344",
        dim: d(1, 0, 0, 0, 0, 0, 0),
        prefixable: false,
        name: "international mile",
    },
    Atom {
        sym: "nmi",
        factor: "1852",
        dim: d(1, 0, 0, 0, 0, 0, 0),
        prefixable: false,
        name: "nautical mile",
    },
    Atom {
        sym: "lb",
        factor: "0.45359237",
        dim: d(0, 1, 0, 0, 0, 0, 0),
        prefixable: false,
        name: "pound",
    },
    Atom {
        sym: "oz",
        factor: "0.028349523125",
        dim: d(0, 1, 0, 0, 0, 0, 0),
        prefixable: false,
        name: "ounce",
    },
    Atom {
        sym: "lbf",
        factor: "4.4482216152605",
        dim: d(1, 1, -2, 0, 0, 0, 0),
        prefixable: false,
        name: "pound force",
    },
    Atom {
        sym: "psi",
        factor: "44482216152605/6451600000",
        dim: d(-1, 1, -2, 0, 0, 0, 0),
        prefixable: false,
        name: "pound force per square inch",
    },
    Atom {
        sym: "gal",
        factor: "0.003785411784",
        dim: d(3, 0, 0, 0, 0, 0, 0),
        prefixable: false,
        name: "US gallon",
    },
    Atom {
        sym: "kn",
        factor: "1852/3600",
        dim: d(1, 0, -1, 0, 0, 0, 0),
        prefixable: false,
        name: "knot",
    },
    Atom {
        sym: "mph",
        factor: "0.44704",
        dim: d(1, 0, -1, 0, 0, 0, 0),
        prefixable: false,
        name: "mile per hour",
    },
];

const PREFIXES: &[(&str, i32)] = &[
    ("Q", 30),
    ("R", 27),
    ("Y", 24),
    ("Z", 21),
    ("E", 18),
    ("P", 15),
    ("T", 12),
    ("G", 9),
    ("M", 6),
    ("k", 3),
    ("h", 2),
    ("da", 1),
    ("d", -1),
    ("c", -2),
    ("m", -3),
    ("u", -6),
    ("n", -9),
    ("p", -12),
    ("f", -15),
    ("a", -18),
    ("z", -21),
    ("y", -24),
    ("r", -27),
    ("q", -30),
];

fn atom_unit(a: &Atom) -> Unit {
    // ATOMS factors are fixed literals that parse_rat accepts; a failure here is a table bug.
    let factor = parse_rat(a.factor).unwrap_or_else(|_| Rat::one());
    Unit { factor, dim: a.dim }
}

fn pow10_rat(e: i32) -> Rat {
    let p = num_traits::pow(BigInt::from(10), e.unsigned_abs() as usize);
    if e >= 0 {
        Rat::from_integer(p)
    } else {
        Rat::new(BigInt::one(), p)
    }
}

fn parse_atom(tok: &str) -> Result<Unit> {
    if let Some(a) = ATOMS.iter().find(|a| a.sym == tok) {
        return Ok(atom_unit(a));
    }
    // Longest prefix first so "da" wins over "d".
    let mut best: Option<Unit> = None;
    for (p, e) in PREFIXES {
        if let Some(rest) = tok.strip_prefix(p) {
            if let Some(a) = ATOMS.iter().find(|a| a.sym == rest && a.prefixable) {
                let u = atom_unit(a);
                let cand = Unit {
                    factor: u.factor * pow10_rat(*e),
                    dim: u.dim,
                };
                if best.is_none() || p.len() > 1 {
                    best = Some(cand);
                }
            }
        }
    }
    best.ok_or_else(|| UcmError::Unit(format!("unknown unit {tok}")))
}

fn parse_factor(part: &str) -> Result<Unit> {
    let part = part.trim();
    if part.is_empty() {
        return Err(UcmError::Unit("empty unit term".into()));
    }
    if part == "1" {
        return Ok(Unit {
            factor: Rat::one(),
            dim: DIMLESS,
        });
    }
    let (sym, exp) = match part.split_once('^') {
        Some((s, e)) => (
            s.trim(),
            e.trim()
                .parse::<i64>()
                .map_err(|_| UcmError::Unit(format!("bad exponent in {part}")))?,
        ),
        None => (part, 1),
    };
    if exp == 0 || exp.abs() > 12 {
        return Err(UcmError::Unit(format!("exponent out of range in {part}")));
    }
    let u = parse_atom(sym)?;
    let factor = crate::num::pow_rat(&u.factor, exp)?;
    Ok(Unit {
        factor,
        dim: dim_scale(&u.dim, exp)?,
    })
}

fn parse_product(s: &str) -> Result<Unit> {
    let mut acc = Unit {
        factor: Rat::one(),
        dim: DIMLESS,
    };
    for part in s.split(['*', '.', ' ']).filter(|p| !p.trim().is_empty()) {
        let u = parse_factor(part)?;
        acc = Unit {
            factor: acc.factor * u.factor,
            dim: dim_add(&acc.dim, &u.dim)?,
        };
    }
    Ok(acc)
}

/// Parse a unit expression such as "kg*m/s^2", "km/h", "N*m" or "1/s".
/// Everything after the one "/" is the denominator.
pub fn parse_unit(s: &str) -> Result<Unit> {
    let t = s.trim();
    if t.is_empty() || t == "1" {
        return Ok(Unit {
            factor: Rat::one(),
            dim: DIMLESS,
        });
    }
    if t.matches('/').count() > 1 {
        return Err(UcmError::Unit(format!("more than one / in {t}")));
    }
    let (num, den) = t.split_once('/').unwrap_or((t, ""));
    let n = parse_product(num)?;
    if den.trim().is_empty() {
        return Ok(n);
    }
    let dn = parse_product(den)?;
    if dn.factor.is_zero() {
        return Err(UcmError::Unit("zero unit factor".into()));
    }
    Ok(Unit {
        factor: n.factor / dn.factor,
        dim: dim_add(&n.dim, &dim_neg(&dn.dim))?,
    })
}

/// Unit catalog rows for the lookup index: symbol, name, dimension text and SI factor.
pub fn unit_catalog() -> Vec<(String, String, String, String)> {
    ATOMS
        .iter()
        .map(|a| {
            (
                a.sym.to_string(),
                a.name.to_string(),
                dim_render(&a.dim),
                a.factor.to_string(),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn units_parse() {
        let n = parse_unit("kg*m/s^2").expect("unit");
        assert_eq!(n.dim, parse_unit("N").expect("N").dim);
        let kmh = parse_unit("km/h").expect("km/h");
        assert_eq!(kmh.factor, Rat::new(BigInt::from(5), BigInt::from(18)));
        assert_eq!(
            parse_unit("mm").expect("mm").factor,
            Rat::new(BigInt::from(1), BigInt::from(1000))
        );
        assert_eq!(
            parse_unit("dam").expect("dam").factor,
            Rat::from_integer(BigInt::from(10))
        );
        assert!(parse_unit("furlong").is_err());
        assert_eq!(
            dim_render(&parse_unit("J/s").expect("J/s").dim),
            "m^2*kg/s^3"
        );
    }

    #[test]
    fn imperial_exact() {
        let mi = parse_unit("mi").expect("mi");
        let ft = parse_unit("ft").expect("ft");
        assert_eq!(mi.factor / ft.factor, Rat::from_integer(BigInt::from(5280)));
    }
}
