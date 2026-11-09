//! Runtime values, static types and the JSON result form.

use crate::error::{Result, UcmError};
use crate::num::{parse_decimal, parse_rat, render_rat, terminating_decimal, Decimal, Rat};
use crate::units::{dim_render, parse_unit, Dim, DIMLESS};
use chrono::NaiveDate;
use num_bigint::BigInt;
use serde_json::{json, Value as J};

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Int(BigInt),
    Rat(Rat),
    Dec(Decimal),
    Money(Rat, String),
    Qty(Rat, Dim),
    Interval(Rat, Rat),
    Float(f64),
    Bool(bool),
    Date(NaiveDate),
    /// Seconds since 1970-01-01T00:00:00Z, exact.
    Instant(Rat),
    Text(String),
    Vec(Vec<Value>),
}

/// Static types. Money carries its currency when the program fixes it.
#[derive(Debug, Clone, PartialEq)]
pub enum Ty {
    Int,
    Rational,
    Decimal,
    Money(Option<String>),
    Quantity(Dim),
    Interval,
    Float,
    Bool,
    Date,
    Instant,
    /// Text with its literal value when the program spells it out.
    Text(Option<String>),
    Vector(Box<Ty>),
    /// Element type of an empty vector literal. Joins with any type.
    Empty,
    Lambda,
}

impl Ty {
    pub fn name(&self) -> String {
        match self {
            Ty::Int => "int".into(),
            Ty::Rational => "rational".into(),
            Ty::Decimal => "decimal".into(),
            Ty::Money(Some(c)) => format!("money[{c}]"),
            Ty::Money(None) => "money".into(),
            Ty::Quantity(d) => format!("quantity[{}]", dim_render(d)),
            Ty::Interval => "interval".into(),
            Ty::Float => "float".into(),
            Ty::Bool => "bool".into(),
            Ty::Date => "date".into(),
            Ty::Instant => "instant".into(),
            Ty::Text(_) => "text".into(),
            Ty::Vector(t) => format!("vector[{}]", t.name()),
            Ty::Empty => "empty".into(),
            Ty::Lambda => "lambda".into(),
        }
    }

    pub fn is_exact_num(&self) -> bool {
        matches!(self, Ty::Int | Ty::Rational | Ty::Decimal)
    }

    /// Parse a declared input type such as money[USD], quantity[m/s^2] or vector[rational].
    pub fn parse(s: &str) -> Result<Ty> {
        let t = s.trim();
        let inner =
            |p: &str| -> Option<&str> { t.strip_prefix(p).and_then(|r| r.strip_suffix(']')) };
        if let Some(c) = inner("money[") {
            return Ok(Ty::Money(Some(check_currency(c)?)));
        }
        if let Some(u) = inner("quantity[") {
            return Ok(crate::ops::qty_ty(parse_unit(u)?.dim));
        }
        if let Some(e) = inner("vector[") {
            return Ok(Ty::Vector(Box::new(Ty::parse(e)?)));
        }
        Ok(match t {
            "int" => Ty::Int,
            "rational" => Ty::Rational,
            "decimal" => Ty::Decimal,
            "money" => Ty::Money(None),
            "interval" => Ty::Interval,
            "float" => Ty::Float,
            "bool" => Ty::Bool,
            "date" => Ty::Date,
            "instant" => Ty::Instant,
            "text" => Ty::Text(None),
            other => return Err(UcmError::Type(format!("unknown input type {other}"))),
        })
    }

    /// Whether a value of type `self` may stand where `want` is declared.
    pub fn conforms(&self, want: &Ty) -> bool {
        match (self, want) {
            (_, _) if self == want => true,
            (Ty::Money(_), Ty::Money(None)) => true,
            (Ty::Money(None), Ty::Money(Some(_))) => true,
            (Ty::Text(_), Ty::Text(_)) => true,
            (Ty::Empty, _) => true,
            (Ty::Vector(a), Ty::Vector(b)) => a.conforms(b),
            _ => false,
        }
    }
}

pub fn check_currency(c: &str) -> Result<String> {
    if c.len() == 3 && c.chars().all(|ch| ch.is_ascii_uppercase()) {
        Ok(c.to_string())
    } else {
        Err(UcmError::Type(format!(
            "currency must be a three letter ISO 4217 code, got {c}"
        )))
    }
}

impl Value {
    pub fn ty(&self) -> Ty {
        match self {
            Value::Int(_) => Ty::Int,
            Value::Rat(_) => Ty::Rational,
            Value::Dec(_) => Ty::Decimal,
            Value::Money(_, c) => Ty::Money(Some(c.clone())),
            Value::Qty(_, d) => {
                if *d == DIMLESS {
                    Ty::Rational
                } else {
                    Ty::Quantity(*d)
                }
            }
            Value::Interval(..) => Ty::Interval,
            Value::Float(_) => Ty::Float,
            Value::Bool(_) => Ty::Bool,
            Value::Date(_) => Ty::Date,
            Value::Instant(_) => Ty::Instant,
            Value::Text(t) => Ty::Text(Some(t.clone())),
            Value::Vec(items) => match items.first() {
                Some(v) => Ty::Vector(Box::new(v.ty())),
                None => Ty::Vector(Box::new(Ty::Empty)),
            },
        }
    }

    /// Exact rational view of a number value.
    pub fn as_rat(&self) -> Option<Rat> {
        match self {
            Value::Int(i) => Some(Rat::from_integer(i.clone())),
            Value::Rat(r) => Some(r.clone()),
            Value::Dec(d) => Some(d.to_rat()),
            _ => None,
        }
    }

    /// Result form. Every scalar is a string so canonical JSON never holds a JSON number.
    pub fn to_json(&self) -> J {
        match self {
            Value::Int(i) => json!({ "type": "int", "value": i.to_string() }),
            Value::Rat(r) => {
                let mut o = json!({ "type": "rational", "value": render_rat(r) });
                if let Some(d) = terminating_decimal(r) {
                    o["decimal"] = J::String(d);
                }
                o
            }
            Value::Dec(d) => json!({ "type": "decimal", "value": d.render() }),
            Value::Money(r, c) => {
                let mut o = json!({ "type": "money", "currency": c, "value": render_rat(r) });
                if let Some(d) = terminating_decimal(r) {
                    o["decimal"] = J::String(d);
                }
                o
            }
            Value::Qty(r, d) => {
                json!({ "type": "quantity", "unit": dim_render(d), "value": render_rat(r) })
            }
            Value::Interval(a, b) => {
                json!({ "type": "interval", "lo": render_rat(a), "hi": render_rat(b) })
            }
            Value::Float(f) => json!({ "type": "float", "value": render_float(*f) }),
            Value::Bool(b) => json!({ "type": "bool", "value": if *b { "true" } else { "false" } }),
            Value::Date(d) => json!({ "type": "date", "value": d.format("%Y-%m-%d").to_string() }),
            Value::Instant(s) => {
                json!({ "type": "instant", "value": crate::time::render_instant(s), "seconds": render_rat(s) })
            }
            Value::Text(t) => json!({ "type": "text", "value": t }),
            Value::Vec(items) => {
                json!({ "type": "vector", "items": items.iter().map(|v| v.to_json()).collect::<Vec<_>>() })
            }
        }
    }

    pub fn bits(&self) -> u64 {
        use crate::num::rat_bits;
        match self {
            Value::Int(i) => i.bits(),
            Value::Rat(r) | Value::Money(r, _) | Value::Qty(r, _) | Value::Instant(r) => {
                rat_bits(r)
            }
            Value::Dec(d) => d.unscaled.bits() + (d.scale as u64) * 4,
            Value::Interval(a, b) => rat_bits(a).max(rat_bits(b)),
            Value::Vec(items) => items.iter().map(|v| v.bits()).max().unwrap_or(0),
            _ => 0,
        }
    }
}

pub fn render_float(f: f64) -> String {
    if f.is_nan() {
        "nan".into()
    } else if f.is_infinite() {
        if f > 0.0 {
            "inf".into()
        } else {
            "-inf".into()
        }
    } else {
        // Rust prints the shortest text that reads back to the same f64.
        format!("{f:?}")
    }
}

/// Parse one input value against its declared type. Inputs are JSON strings,
/// JSON arrays for vectors and JSON booleans or strings for bool.
pub fn parse_input(ty: &Ty, v: &J) -> Result<Value> {
    let bad = |msg: &str| UcmError::Input(format!("{msg} for type {}", ty.name()));
    if let Ty::Vector(el) = ty {
        let arr = v.as_array().ok_or_else(|| bad("expected an array"))?;
        return Ok(Value::Vec(
            arr.iter()
                .map(|x| parse_input(el, x))
                .collect::<Result<Vec<_>>>()?,
        ));
    }
    if let (Ty::Bool, Some(b)) = (ty, v.as_bool()) {
        return Ok(Value::Bool(b));
    }
    let s = v
        .as_str()
        .ok_or_else(|| bad("expected a string (numbers are passed as strings)"))?
        .trim();
    Ok(match ty {
        Ty::Int => Value::Int(s.parse::<BigInt>().map_err(|_| bad("bad int"))?),
        Ty::Rational => Value::Rat(parse_rat(s)?),
        Ty::Decimal => Value::Dec(parse_decimal(s)?),
        Ty::Money(cur) => {
            let (amt, c) = s
                .rsplit_once(' ')
                .ok_or_else(|| bad("expected \"amount CODE\""))?;
            let c = check_currency(c.trim())?;
            if let Some(want) = cur {
                if &c != want {
                    return Err(UcmError::Input(format!(
                        "currency {c} where {want} is declared"
                    )));
                }
            }
            Value::Money(parse_rat(amt)?, c)
        }
        Ty::Quantity(dim) => {
            let (num, unit) = s
                .split_once(' ')
                .ok_or_else(|| bad("expected \"value unit\""))?;
            let u = parse_unit(unit)?;
            if &u.dim != dim {
                return Err(UcmError::Input(format!(
                    "unit {unit} has dimension {} where {} is declared",
                    dim_render(&u.dim),
                    dim_render(dim)
                )));
            }
            crate::ops::qty(parse_rat(num)? * u.factor, *dim)
        }
        Ty::Interval => {
            let inner = s
                .strip_prefix('[')
                .and_then(|x| x.strip_suffix(']'))
                .ok_or_else(|| bad("expected \"[lo, hi]\""))?;
            let (a, b) = inner
                .split_once(',')
                .ok_or_else(|| bad("expected \"[lo, hi]\""))?;
            let (lo, hi) = (parse_rat(a)?, parse_rat(b)?);
            if lo > hi {
                return Err(bad("lo above hi"));
            }
            Value::Interval(lo, hi)
        }
        Ty::Float => Value::Float(s.parse::<f64>().map_err(|_| bad("bad float"))?),
        Ty::Bool => match s {
            "true" => Value::Bool(true),
            "false" => Value::Bool(false),
            _ => return Err(bad("bad bool")),
        },
        Ty::Date => Value::Date(crate::time::parse_date(s)?),
        Ty::Instant => Value::Instant(crate::time::parse_instant_utc(s)?),
        Ty::Text(_) => Value::Text(s.to_string()),
        Ty::Vector(_) | Ty::Empty | Ty::Lambda => return Err(bad("unsupported input type")),
    })
}
