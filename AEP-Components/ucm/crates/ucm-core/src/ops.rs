//! Operator typing and exact operator evaluation. `op_ty` and `apply` follow the same table,
//! which spec/UCM-SPEC.md section 5 states in full.

use crate::ast::Op;
use crate::error::{domain_err, type_err, Result, UcmError};
use crate::num::{pow_rat, rat_from_f64, rat_to_f64, Decimal, Rat};
// Inside `apply` the Value variants are in scope and `Rat` names the variant, so the
// exact rational type is spelled Q there.
use crate::num::Rat as Q;
use crate::units::{dim_add, dim_neg, dim_scale, Dim, DIMLESS};
use crate::value::{Ty, Value};
use num_bigint::BigInt;
use num_traits::{Signed, ToPrimitive, Zero};
use std::cmp::Ordering;

const TIME: Dim = [0, 0, 1, 0, 0, 0, 0];

pub fn qty(r: Rat, d: Dim) -> Value {
    if d == DIMLESS {
        Value::Rat(r)
    } else {
        Value::Qty(r, d)
    }
}

pub fn qty_ty(d: Dim) -> Ty {
    if d == DIMLESS {
        Ty::Rational
    } else {
        Ty::Quantity(d)
    }
}

/// Join of two exact number types: int < decimal < rational.
pub fn num_join(a: &Ty, b: &Ty) -> Option<Ty> {
    use Ty::*;
    Some(match (a, b) {
        (Int, Int) => Int,
        (Int, Decimal) | (Decimal, Int) | (Decimal, Decimal) => Decimal,
        (Int | Decimal | Rational, Rational) | (Rational, Int | Decimal) => Rational,
        _ => return None,
    })
}

fn money_cur(a: &Option<String>, b: &Option<String>) -> Result<Option<String>> {
    match (a, b) {
        (Some(x), Some(y)) if x != y => {
            type_err(format!("money in {x} and {y} do not mix, use convert"))
        }
        (Some(x), _) | (_, Some(x)) => Ok(Some(x.clone())),
        _ => Ok(None),
    }
}

/// Static type of an operator application. `pow_lit` is the exponent when it is an int literal.
pub fn op_ty(op: Op, a: &[Ty], float_mode: bool, pow_lit: Option<i64>) -> Result<Ty> {
    use Ty::*;
    let f = |t: &Ty| -> bool { matches!(t, Float) || (float_mode && t.is_exact_num()) };
    match op {
        Op::Not => match &a[0] {
            Bool => Ok(Bool),
            t => type_err(format!("not needs bool, got {}", t.name())),
        },
        Op::And | Op::Or => match (&a[0], &a[1]) {
            (Bool, Bool) => Ok(Bool),
            (x, y) => type_err(format!(
                "{} needs bool and bool, got {} and {}",
                op.symbol(),
                x.name(),
                y.name()
            )),
        },
        Op::Neg => match &a[0] {
            t if f(t) => Ok(Float),
            t @ (Int | Rational | Decimal | Money(_) | Quantity(_) | Interval) => Ok(t.clone()),
            t => type_err(format!("cannot negate {}", t.name())),
        },
        Op::Eq | Op::Ne | Op::Lt | Op::Le | Op::Gt | Op::Ge => {
            let ordered = !matches!(op, Op::Eq | Op::Ne);
            let ok = match (&a[0], &a[1]) {
                (x, y) if x.is_exact_num() && y.is_exact_num() => true,
                (x, y) if f(x) && f(y) => true,
                (Money(x), Money(y)) => {
                    money_cur(x, y)?;
                    true
                }
                (Quantity(x), Quantity(y)) => x == y,
                (Date, Date) | (Instant, Instant) => true,
                (Bool, Bool) | (Text(_), Text(_)) => !ordered,
                _ => false,
            };
            if ok {
                Ok(Bool)
            } else {
                type_err(format!(
                    "cannot compare {} with {} using {}",
                    a[0].name(),
                    a[1].name(),
                    op.symbol()
                ))
            }
        }
        Op::Add | Op::Sub => {
            let (x, y) = (&a[0], &a[1]);
            if f(x) && f(y) {
                return Ok(Float);
            }
            if let Some(t) = num_join(x, y) {
                return Ok(t);
            }
            match (x, y) {
                (Money(p), Money(q)) => Ok(Money(money_cur(p, q)?)),
                (Quantity(p), Quantity(q)) if p == q => Ok(Quantity(*p)),
                (Interval, Interval) => Ok(Interval),
                (Interval, n) | (n, Interval) if n.is_exact_num() => Ok(Interval),
                (Date, Quantity(d)) if *d == TIME => Ok(Date),
                (Quantity(d), Date) if *d == TIME && op == Op::Add => Ok(Date),
                (Date, Date) if op == Op::Sub => Ok(Quantity(TIME)),
                (Instant, Quantity(d)) if *d == TIME => Ok(Instant),
                (Quantity(d), Instant) if *d == TIME && op == Op::Add => Ok(Instant),
                (Instant, Instant) if op == Op::Sub => Ok(Quantity(TIME)),
                _ => type_err(format!(
                    "cannot apply {} to {} and {}",
                    op.symbol(),
                    x.name(),
                    y.name()
                )),
            }
        }
        Op::Mul => {
            let (x, y) = (&a[0], &a[1]);
            if f(x) && f(y) {
                return Ok(Float);
            }
            if let Some(t) = num_join(x, y) {
                return Ok(t);
            }
            match (x, y) {
                (Money(c), n) | (n, Money(c)) if n.is_exact_num() => Ok(Money(c.clone())),
                (Quantity(p), Quantity(q)) => Ok(qty_ty(dim_add(p, q)?)),
                (Quantity(p), n) | (n, Quantity(p)) if n.is_exact_num() => Ok(Quantity(*p)),
                (Interval, Interval) => Ok(Interval),
                (Interval, n) | (n, Interval) if n.is_exact_num() => Ok(Interval),
                _ => type_err(format!("cannot multiply {} and {}", x.name(), y.name())),
            }
        }
        Op::Div => {
            let (x, y) = (&a[0], &a[1]);
            if f(x) && f(y) {
                return Ok(Float);
            }
            if x.is_exact_num() && y.is_exact_num() {
                return Ok(Rational);
            }
            match (x, y) {
                (Money(c), n) if n.is_exact_num() => Ok(Money(c.clone())),
                (Money(p), Money(q)) => {
                    money_cur(p, q)?;
                    Ok(Rational)
                }
                (Quantity(p), Quantity(q)) => Ok(qty_ty(dim_add(p, &dim_neg(q))?)),
                (Quantity(p), n) if n.is_exact_num() => Ok(Quantity(*p)),
                (n, Quantity(q)) if n.is_exact_num() => Ok(Quantity(dim_neg(q))),
                (Interval, Interval) => Ok(Interval),
                (Interval, n) | (n, Interval) if n.is_exact_num() => Ok(Interval),
                _ => type_err(format!("cannot divide {} by {}", x.name(), y.name())),
            }
        }
        Op::Pow => {
            let (x, y) = (&a[0], &a[1]);
            if f(x) && f(y) {
                return Ok(Float);
            }
            if *y != Int {
                return type_err(format!("exponent must be int, got {}", y.name()));
            }
            let nonneg = matches!(pow_lit, Some(n) if n >= 0);
            match x {
                Int if nonneg => Ok(Int),
                Decimal if nonneg => Ok(Decimal),
                Int | Decimal | Rational => Ok(Rational),
                Quantity(d) => match pow_lit {
                    Some(n) => Ok(qty_ty(dim_scale(d, n)?)),
                    None => type_err("a quantity power needs an int literal exponent"),
                },
                Interval if nonneg => Ok(Interval),
                t => type_err(format!("cannot raise {} to a power", t.name())),
            }
        }
    }
}

fn to_float(v: &Value) -> Result<f64> {
    match v {
        Value::Float(f) => Ok(*f),
        other => other
            .as_rat()
            .map(|r| rat_to_f64(&r))
            .ok_or_else(|| UcmError::Type("float block needs numbers".into())),
    }
}

fn exact_combine(
    x: &Value,
    y: &Value,
    int_op: fn(&BigInt, &BigInt) -> BigInt,
    rat_op: fn(&Rat, &Rat) -> Rat,
    dec_add: bool,
) -> Option<Value> {
    use Value::*;
    // For + and - both decimals move to the larger scale. For * the scales add.
    let dec = |a: &Decimal, b: &Decimal| -> Decimal {
        if dec_add {
            let s = a.scale.max(b.scale);
            let (p, q) = (a.rescale_up(s), b.rescale_up(s));
            Decimal {
                unscaled: int_op(&p.unscaled, &q.unscaled),
                scale: s,
            }
        } else {
            Decimal {
                unscaled: int_op(&a.unscaled, &b.unscaled),
                scale: a.scale + b.scale,
            }
        }
    };
    Some(match (x, y) {
        (Int(a), Int(b)) => Int(int_op(a, b)),
        (Dec(a), Dec(b)) => Dec(dec(a, b)),
        (Dec(a), Int(b)) => Dec(dec(a, &Decimal::from_int(b))),
        (Int(a), Dec(b)) => Dec(dec(&Decimal::from_int(a), b)),
        _ => Rat(rat_op(&x.as_rat()?, &y.as_rat()?)),
    })
}

fn interval_mul(a: (&Rat, &Rat), b: (&Rat, &Rat)) -> (Rat, Rat) {
    let ps = [a.0 * b.0, a.0 * b.1, a.1 * b.0, a.1 * b.1];
    let lo = ps.iter().min().cloned().unwrap_or_default();
    let hi = ps.iter().max().cloned().unwrap_or_default();
    (lo, hi)
}

fn as_interval(v: &Value) -> Option<(Rat, Rat)> {
    match v {
        Value::Interval(a, b) => Some((a.clone(), b.clone())),
        other => other.as_rat().map(|r| (r.clone(), r)),
    }
}

fn whole_days(secs: &Rat) -> Result<i64> {
    let day = Rat::from_integer(BigInt::from(86400));
    let days = secs / day;
    if !days.is_integer() {
        return domain_err("a date moves by whole days only");
    }
    days.to_integer()
        .to_i64()
        .ok_or_else(|| UcmError::Domain("day count out of range".into()))
}

pub fn compare(x: &Value, y: &Value) -> Result<Ordering> {
    use Value::*;
    Ok(match (x, y) {
        (Float(a), Float(b)) => a
            .partial_cmp(b)
            .ok_or_else(|| UcmError::Domain("nan does not compare".into()))?,
        (Money(a, c), Money(b, d)) => {
            if c != d {
                return type_err(format!("money in {c} and {d} do not compare"));
            }
            a.cmp(b)
        }
        (Qty(a, p), Qty(b, q)) if p == q => a.cmp(b),
        (Date(a), Date(b)) => a.cmp(b),
        (Instant(a), Instant(b)) => a.cmp(b),
        (Bool(a), Bool(b)) => a.cmp(b),
        (Text(a), Text(b)) => a.cmp(b),
        _ => match (x.as_rat(), y.as_rat()) {
            (Some(a), Some(b)) => a.cmp(&b),
            _ => return type_err("values do not compare"),
        },
    })
}

/// Apply an operator to already evaluated values. `pow_lit_nonneg` says the exponent is a
/// non-negative int literal, which keeps int and decimal powers in their own type.
pub fn apply(
    op: Op,
    args: &[Value],
    float_mode: bool,
    pow_lit_nonneg: bool,
    max_exp: u64,
) -> Result<Value> {
    use Value::*;
    let x = &args[0];
    let fl = |v: &Value| matches!(v, Float(_)) || (float_mode && v.as_rat().is_some());
    match op {
        Op::Not => match x {
            Bool(b) => Ok(Bool(!b)),
            _ => type_err("not needs bool"),
        },
        Op::Neg => {
            if fl(x) {
                return Ok(Float(-to_float(x)?));
            }
            Ok(match x {
                Int(i) => Int(-i),
                Rat(r) => Rat(-r),
                Dec(d) => Dec(Decimal {
                    unscaled: -&d.unscaled,
                    scale: d.scale,
                }),
                Money(r, c) => Money(-r, c.clone()),
                Qty(r, d) => Qty(-r, *d),
                Interval(a, b) => Interval(-b, -a),
                _ => return type_err("cannot negate"),
            })
        }
        Op::And | Op::Or => match (x, &args[1]) {
            (Bool(a), Bool(b)) => Ok(Bool(if op == Op::And { *a && *b } else { *a || *b })),
            _ => type_err("and/or need bool"),
        },
        Op::Eq | Op::Ne | Op::Lt | Op::Le | Op::Gt | Op::Ge => {
            let y = &args[1];
            let o = if fl(x) && fl(y) {
                compare(&Float(to_float(x)?), &Float(to_float(y)?))?
            } else {
                compare(x, y)?
            };
            Ok(Bool(match op {
                Op::Eq => o == Ordering::Equal,
                Op::Ne => o != Ordering::Equal,
                Op::Lt => o == Ordering::Less,
                Op::Le => o != Ordering::Greater,
                Op::Gt => o == Ordering::Greater,
                _ => o != Ordering::Less,
            }))
        }
        Op::Add | Op::Sub => {
            let y = &args[1];
            let sub = op == Op::Sub;
            if fl(x) && fl(y) {
                let (a, b) = (to_float(x)?, to_float(y)?);
                return Ok(Float(if sub { a - b } else { a + b }));
            }
            type IntOp = fn(&BigInt, &BigInt) -> BigInt;
            type RatOp = fn(&Q, &Q) -> Q;
            let (io, ro): (IntOp, RatOp) = if sub {
                (|a, b| a - b, |a, b| a - b)
            } else {
                (|a, b| a + b, |a, b| a + b)
            };
            if let Some(v) = exact_combine(x, y, io, ro, true) {
                return Ok(v);
            }
            match (x, y) {
                (Money(a, c), Money(b, d)) => {
                    if c != d {
                        return type_err(format!("money in {c} and {d} do not mix, use convert"));
                    }
                    Ok(Money(ro(a, b), c.clone()))
                }
                (Qty(a, p), Qty(b, q)) if p == q => Ok(qty(ro(a, b), *p)),
                (Interval(..), _) | (_, Interval(..)) => {
                    let (a, b) = (as_interval(x), as_interval(y));
                    match (a, b) {
                        (Some((al, ah)), Some((bl, bh))) => Ok(if sub {
                            Interval(al - bh, ah - bl)
                        } else {
                            Interval(al + bl, ah + bh)
                        }),
                        _ => type_err("interval arithmetic needs numbers"),
                    }
                }
                (Date(d), Qty(s, dim)) if *dim == TIME => {
                    let n = whole_days(s)?;
                    Ok(Date(crate::time::add_days(d, if sub { -n } else { n })?))
                }
                (Qty(s, dim), Date(d)) if *dim == TIME && !sub => {
                    Ok(Date(crate::time::add_days(d, whole_days(s)?)?))
                }
                (Date(a), Date(b)) if sub => {
                    let days = crate::time::days_from_epoch(a) - crate::time::days_from_epoch(b);
                    Ok(Qty(
                        crate::num::Rat::from_integer(BigInt::from(days) * BigInt::from(86400)),
                        TIME,
                    ))
                }
                (Instant(t), Qty(s, dim)) if *dim == TIME => Ok(Instant(ro(t, s))),
                (Qty(s, dim), Instant(t)) if *dim == TIME && !sub => Ok(Instant(t + s)),
                (Instant(a), Instant(b)) if sub => Ok(Qty(a - b, TIME)),
                _ => type_err("operand types do not fit"),
            }
        }
        Op::Mul => {
            let y = &args[1];
            if fl(x) && fl(y) {
                return Ok(Float(to_float(x)? * to_float(y)?));
            }
            if let Some(v) = exact_combine(x, y, |a, b| a * b, |a, b| a * b, false) {
                return Ok(v);
            }
            match (x, y) {
                (Money(a, c), n) | (n, Money(a, c)) if n.as_rat().is_some() => {
                    Ok(Money(a * n.as_rat().unwrap_or_default(), c.clone()))
                }
                (Qty(a, p), Qty(b, q)) => Ok(qty(a * b, dim_add(p, q)?)),
                (Qty(a, p), n) | (n, Qty(a, p)) if n.as_rat().is_some() => {
                    Ok(Qty(a * n.as_rat().unwrap_or_default(), *p))
                }
                (Interval(..), _) | (_, Interval(..)) => match (as_interval(x), as_interval(y)) {
                    (Some(a), Some(b)) => {
                        let (lo, hi) = interval_mul((&a.0, &a.1), (&b.0, &b.1));
                        Ok(Interval(lo, hi))
                    }
                    _ => type_err("interval arithmetic needs numbers"),
                },
                _ => type_err("operand types do not fit"),
            }
        }
        Op::Div => {
            let y = &args[1];
            if fl(x) && fl(y) {
                return Ok(Float(to_float(x)? / to_float(y)?));
            }
            let nz = |r: &Q| -> Result<()> {
                if r.is_zero() {
                    Err(UcmError::DivisionByZero)
                } else {
                    Ok(())
                }
            };
            if let (Some(a), Some(b)) = (x.as_rat(), y.as_rat()) {
                nz(&b)?;
                return Ok(Rat(a / b));
            }
            match (x, y) {
                (Money(a, c), n) if n.as_rat().is_some() => {
                    let b = n.as_rat().unwrap_or_default();
                    nz(&b)?;
                    Ok(Money(a / b, c.clone()))
                }
                (Money(a, c), Money(b, d)) => {
                    if c != d {
                        return type_err(format!("money in {c} and {d} do not mix"));
                    }
                    nz(b)?;
                    Ok(Rat(a / b))
                }
                (Qty(a, p), Qty(b, q)) => {
                    nz(b)?;
                    Ok(qty(a / b, dim_add(p, &dim_neg(q))?))
                }
                (Qty(a, p), n) if n.as_rat().is_some() => {
                    let b = n.as_rat().unwrap_or_default();
                    nz(&b)?;
                    Ok(Qty(a / b, *p))
                }
                (n, Qty(b, q)) if n.as_rat().is_some() => {
                    nz(b)?;
                    Ok(Qty(n.as_rat().unwrap_or_default() / b, dim_neg(q)))
                }
                (Interval(..), _) | (_, Interval(..)) => match (as_interval(x), as_interval(y)) {
                    (Some(a), Some(b)) => {
                        if !b.0.is_positive() && !b.1.is_negative() {
                            return domain_err("division by an interval that contains zero");
                        }
                        let inv = (b.1.recip(), b.0.recip());
                        let (lo, hi) = interval_mul((&a.0, &a.1), (&inv.0, &inv.1));
                        Ok(Interval(lo, hi))
                    }
                    _ => type_err("interval arithmetic needs numbers"),
                },
                _ => type_err("operand types do not fit"),
            }
        }
        Op::Pow => {
            let y = &args[1];
            if fl(x) && fl(y) {
                return Ok(Float(to_float(x)?.powf(to_float(y)?)));
            }
            let n = match y {
                Int(i) => i.to_i64().ok_or_else(|| UcmError::BudgetExceeded {
                    what: "exponent".into(),
                })?,
                _ => return type_err("exponent must be int"),
            };
            if n.unsigned_abs() > max_exp {
                return Err(UcmError::BudgetExceeded {
                    what: format!("exponent {n} above {max_exp}"),
                });
            }
            match x {
                Int(b) if pow_lit_nonneg => Ok(Int(num_traits::pow(b.clone(), n as usize))),
                Dec(d) if pow_lit_nonneg => Ok(Dec(Decimal {
                    unscaled: num_traits::pow(d.unscaled.clone(), n as usize),
                    scale: d.scale.checked_mul(n as u32).ok_or_else(|| {
                        UcmError::BudgetExceeded {
                            what: "decimal scale".into(),
                        }
                    })?,
                })),
                Int(_) | Rat(_) | Dec(_) => Ok(Rat(pow_rat(&x.as_rat().unwrap_or_default(), n)?)),
                Qty(r, d) => Ok(qty(pow_rat(r, n)?, dim_scale(d, n)?)),
                Interval(a, b) if n >= 0 => {
                    let (pa, pb) = (pow_rat(a, n)?, pow_rat(b, n)?);
                    if n % 2 == 0 && !a.is_positive() && !b.is_negative() {
                        Ok(Interval(Q::zero(), pa.max(pb)))
                    } else {
                        Ok(Interval(pa.clone().min(pb.clone()), pa.max(pb)))
                    }
                }
                _ => type_err("cannot raise to a power"),
            }
        }
    }
}

/// Exact value of an f64, used by exact(x).
pub fn exact_of_float(f: f64) -> Result<Value> {
    Ok(Value::Rat(rat_from_f64(f)?))
}
