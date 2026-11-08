//! Builtin functions. Each entry carries its catalog text, its static type rule and its
//! exact evaluation. Higher order functions (map, filter, fold, any, all, count) and
//! formula are typed and run by the checker and evaluator; their entries here are catalog only.

use crate::budget::Budget;
use crate::error::{domain_err, type_err, Result, UcmError};
use crate::library::Library;
use crate::num::{isqrt, round_rat_to_int, round_to_scale, sqrt_round, Decimal, Rat, RoundMode};
use crate::ops::{compare, exact_of_float, num_join, qty, qty_ty};
use crate::units::{dim_render, parse_unit, Dim, DIMLESS};
use crate::value::{check_currency, Ty, Value};
use num_bigint::BigInt;
use num_integer::Integer;
use num_traits::{One, Signed, ToPrimitive, Zero};
use std::cmp::Ordering;

pub struct TyCtx<'a> {
    pub float_mode: bool,
    pub lib: &'a Library,
}

pub struct Ctx<'a> {
    pub budget: &'a mut Budget,
    pub lib: &'a Library,
    pub float_mode: bool,
    pub float_used: bool,
    pub library_used: bool,
}

pub type TyFn = fn(&TyCtx, &[Ty]) -> Result<Ty>;
pub type EvalFn = fn(&mut Ctx, &[Value]) -> Result<Value>;

pub struct Builtin {
    pub name: &'static str,
    pub category: &'static str,
    pub signature: &'static str,
    pub doc: &'static str,
    pub aliases: &'static [&'static str],
    pub example: &'static str,
    pub float_only: bool,
    pub ty: TyFn,
    pub run: EvalFn,
}

const K_TIME: Dim = [0, 0, 1, 0, 0, 0, 0];
const K_TEMP: Dim = [0, 0, 0, 0, 1, 0, 0];

fn arity(name: &str, a: &[Ty], n: usize) -> Result<()> {
    if a.len() != n {
        return type_err(format!("{name} takes {n} arguments, got {}", a.len()));
    }
    Ok(())
}

fn want_int(name: &str, t: &Ty) -> Result<()> {
    if *t == Ty::Int {
        Ok(())
    } else {
        type_err(format!("{name} needs int, got {}", t.name()))
    }
}

fn want_exact(name: &str, t: &Ty) -> Result<()> {
    if t.is_exact_num() {
        Ok(())
    } else {
        type_err(format!("{name} needs an exact number, got {}", t.name()))
    }
}

fn want_text(name: &str, t: &Ty) -> Result<Option<String>> {
    match t {
        Ty::Text(v) => Ok(v.clone()),
        other => type_err(format!("{name} needs text, got {}", other.name())),
    }
}

fn lit_text(name: &str, t: &Ty) -> Result<String> {
    match want_text(name, t)? {
        Some(s) => Ok(s),
        None => type_err(format!("{name} needs a text literal here")),
    }
}

fn elem(name: &str, t: &Ty) -> Result<Ty> {
    match t {
        Ty::Vector(e) => Ok((**e).clone()),
        other => type_err(format!("{name} needs a vector, got {}", other.name())),
    }
}

fn want_mode(name: &str, t: &Ty) -> Result<()> {
    if let Some(m) = want_text(name, t)? {
        RoundMode::parse(&m)?;
    }
    Ok(())
}

fn matrix_ty(name: &str, t: &Ty) -> Result<()> {
    let row = elem(name, t)?;
    if row == Ty::Empty {
        return Ok(());
    }
    let cell = elem(name, &row)?;
    if cell.is_exact_num() || cell == Ty::Empty {
        Ok(())
    } else {
        type_err(format!("{name} needs a matrix of exact numbers"))
    }
}

// Value helpers.

fn rat(v: &Value) -> Result<Rat> {
    v.as_rat().ok_or_else(|| UcmError::Type("expected an exact number".into()))
}

fn int(v: &Value) -> Result<BigInt> {
    match v {
        Value::Int(i) => Ok(i.clone()),
        _ => type_err("expected int"),
    }
}

fn small(v: &Value, what: &str) -> Result<i64> {
    int(v)?.to_i64().ok_or_else(|| UcmError::Domain(format!("{what} out of range")))
}

fn text(v: &Value) -> Result<String> {
    match v {
        Value::Text(t) => Ok(t.clone()),
        _ => type_err("expected text"),
    }
}

fn vecv(v: &Value) -> Result<&Vec<Value>> {
    match v {
        Value::Vec(x) => Ok(x),
        _ => type_err("expected vector"),
    }
}

fn scale_arg(v: &Value) -> Result<u32> {
    let s = small(v, "scale")?;
    if !(0..=crate::num::MAX_SCALE as i64).contains(&s) {
        return domain_err(format!("scale must be 0 to {}", crate::num::MAX_SCALE));
    }
    Ok(s as u32)
}

fn mode_arg(v: &Value) -> Result<RoundMode> {
    RoundMode::parse(&text(v)?)
}

fn f(v: &Value) -> Result<f64> {
    match v {
        Value::Float(x) => Ok(*x),
        other => other
            .as_rat()
            .map(|r| crate::num::rat_to_f64(&r))
            .ok_or_else(|| UcmError::Type("expected a number".into())),
    }
}

fn add_all(ctx: &mut Ctx, items: &[Value]) -> Result<Value> {
    let mut acc = match items.first() {
        Some(v) => v.clone(),
        None => return Ok(Value::Int(BigInt::zero())),
    };
    for v in &items[1..] {
        ctx.budget.step()?;
        acc = crate::ops::apply(crate::ast::Op::Add, &[acc, v.clone()], ctx.float_mode, false, 0)?;
        ctx.budget.bits(acc.bits())?;
    }
    Ok(acc)
}

/// Split a numeric-like value into a rational and a constructor that rebuilds the same kind.
fn scalar_parts(v: &Value) -> Result<(Rat, Box<dyn Fn(Rat) -> Value>)> {
    Ok(match v {
        Value::Money(r, c) => {
            let c = c.clone();
            (r.clone(), Box::new(move |x| Value::Money(x, c.clone())))
        }
        Value::Qty(r, d) => {
            let d = *d;
            (r.clone(), Box::new(move |x| qty(x, d)))
        }
        other => (rat(other)?, Box::new(Value::Rat)),
    })
}

fn same_kind(items: &[Value]) -> Result<()> {
    if let Some(first) = items.first() {
        let ft = first.ty();
        for v in items {
            let ok = match (&ft, &v.ty()) {
                (a, b) if a.is_exact_num() && b.is_exact_num() => true,
                (a, b) => a == b,
            };
            if !ok {
                return type_err("vector items must share one kind");
            }
        }
    }
    Ok(())
}

fn sorted_rats(items: &[Value]) -> Result<(Vec<Rat>, Box<dyn Fn(Rat) -> Value>)> {
    same_kind(items)?;
    let first = items.first().ok_or_else(|| UcmError::Domain("empty vector".into()))?;
    let (_, mk) = scalar_parts(first)?;
    let mut rs = items.iter().map(|v| scalar_parts(v).map(|p| p.0)).collect::<Result<Vec<_>>>()?;
    rs.sort();
    Ok((rs, mk))
}

fn mean_rats(rs: &[Rat]) -> Rat {
    let n = Rat::from_integer(BigInt::from(rs.len()));
    rs.iter().fold(Rat::zero(), |a, b| a + b) / n
}

fn variance(items: &[Value], sample: bool) -> Result<Rat> {
    let (rs, _) = sorted_rats(items)?;
    let n = rs.len();
    if n == 0 || (sample && n < 2) {
        return domain_err("not enough values for a variance");
    }
    let m = mean_rats(&rs);
    let ss = rs.iter().fold(Rat::zero(), |a, x| a + (x - &m) * (x - &m));
    Ok(ss / Rat::from_integer(BigInt::from(if sample { n - 1 } else { n })))
}

fn var_ty(name: &str, a: &[Ty]) -> Result<Ty> {
    let e = elem(name, &a[0])?;
    match e {
        t if t.is_exact_num() || t == Ty::Empty => Ok(Ty::Rational),
        Ty::Money(_) => type_err(format!("{name} of money has money squared units, use amount() first")),
        Ty::Quantity(d) => Ok(qty_ty(crate::units::dim_scale(&d, 2)?)),
        t => type_err(format!("{name} needs numbers, got {}", t.name())),
    }
}

fn var_wrap(items: &[Value], r: Rat) -> Value {
    match items.first() {
        Some(Value::Qty(_, d)) => qty(r, crate::units::dim_scale(d, 2).unwrap_or(DIMLESS)),
        _ => Value::Rat(r),
    }
}

fn summable(name: &str, t: &Ty) -> Result<Ty> {
    match t {
        Ty::Empty => Ok(Ty::Int),
        t if t.is_exact_num() => Ok(t.clone()),
        Ty::Money(_) | Ty::Quantity(_) | Ty::Interval => Ok(t.clone()),
        Ty::Float => Ok(Ty::Float),
        other => type_err(format!("{name} cannot add {}", other.name())),
    }
}

fn meanable(name: &str, t: &Ty) -> Result<Ty> {
    match t {
        Ty::Empty => type_err(format!("{name} of an empty vector")),
        t if t.is_exact_num() => Ok(Ty::Rational),
        Ty::Money(_) | Ty::Quantity(_) => Ok(t.clone()),
        other => type_err(format!("{name} needs numbers, money or quantities, got {}", other.name())),
    }
}

fn to_matrix(v: &Value) -> Result<Vec<Vec<Rat>>> {
    let rows = vecv(v)?;
    let m: Vec<Vec<Rat>> = rows
        .iter()
        .map(|r| vecv(r)?.iter().map(rat).collect::<Result<Vec<_>>>())
        .collect::<Result<Vec<_>>>()?;
    if let Some(w) = m.first().map(|r| r.len()) {
        if m.iter().any(|r| r.len() != w) {
            return domain_err("matrix rows differ in length");
        }
    }
    Ok(m)
}

fn from_matrix(m: Vec<Vec<Rat>>) -> Value {
    Value::Vec(m.into_iter().map(|r| Value::Vec(r.into_iter().map(Value::Rat).collect())).collect())
}

/// Gauss-Jordan elimination over rationals. Returns (reduced matrix, rank, determinant sign and product).
fn eliminate(ctx: &mut Ctx, mut m: Vec<Vec<Rat>>, cols: usize) -> Result<(Vec<Vec<Rat>>, usize, Rat)> {
    let rows = m.len();
    let mut det = Rat::one();
    let mut r = 0usize;
    for c in 0..cols {
        if r >= rows {
            break;
        }
        ctx.budget.charge((rows * m.first().map(|x| x.len()).unwrap_or(0)) as u64)?;
        let Some(p) = (r..rows).find(|&i| !m[i][c].is_zero()) else {
            det = Rat::zero();
            continue;
        };
        if p != r {
            m.swap(p, r);
            det = -det;
        }
        let pv = m[r][c].clone();
        det *= &pv;
        let width = m[r].len();
        for j in 0..width {
            let x = &m[r][j] / &pv;
            m[r][j] = x;
        }
        for i in 0..rows {
            if i != r && !m[i][c].is_zero() {
                let factor = m[i][c].clone();
                for j in 0..width {
                    let x = &m[i][j] - &factor * &m[r][j];
                    m[i][j] = x;
                }
            }
        }
        for row in &m {
            for x in row {
                ctx.budget.bits(crate::num::rat_bits(x))?;
            }
        }
        r += 1;
    }
    if r < cols {
        det = Rat::zero();
    }
    Ok((m, r, det))
}

fn square(m: &[Vec<Rat>]) -> Result<usize> {
    let n = m.len();
    if m.iter().any(|r| r.len() != n) {
        return domain_err("matrix must be square");
    }
    Ok(n)
}

/// Bound of the deterministic Miller-Rabin test with the first 12 primes as bases.
const PRIME_LIMIT: &str = "318665857834031151167461";

fn miller_rabin(n: &BigInt) -> Result<bool> {
    let two = BigInt::from(2);
    if *n < two {
        return Ok(false);
    }
    const SMALL: [u32; 13] = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41];
    for p in SMALL {
        let bp = BigInt::from(p);
        if *n == bp {
            return Ok(true);
        }
        if (n % &bp).is_zero() {
            return Ok(false);
        }
    }
    // The first 12 primes as bases are deterministic below this bound (Sorenson and Webster 2015).
    // The code tests 13 bases, which is at least as strong.
    let limit: BigInt = PRIME_LIMIT.parse().map_err(|_| UcmError::Domain("limit".into()))?;
    if *n >= limit {
        return domain_err(format!("is_prime is exact below {PRIME_LIMIT} only"));
    }
    let nm1 = n - BigInt::one();
    let mut d = nm1.clone();
    let mut s = 0u32;
    while d.is_even() {
        d /= &two;
        s += 1;
    }
    'outer: for a in SMALL {
        let mut x = BigInt::from(a).modpow(&d, n);
        if x.is_one() || x == nm1 {
            continue;
        }
        for _ in 1..s {
            x = x.modpow(&two, n);
            if x == nm1 {
                continue 'outer;
            }
        }
        return Ok(false);
    }
    Ok(true)
}

fn round_value(v: &Value, scale: u32, mode: RoundMode) -> Result<Value> {
    Ok(match v {
        Value::Money(r, c) => Value::Money(round_to_scale(r, scale, mode)?.to_rat(), c.clone()),
        other => Value::Dec(round_to_scale(&rat(other)?, scale, mode)?),
    })
}

fn float_fn(name: &'static str, a: &[Ty], n: usize) -> Result<Ty> {
    arity(name, a, n)?;
    for t in a {
        if !(matches!(t, Ty::Float) || t.is_exact_num()) {
            return type_err(format!("{name} needs numbers"));
        }
    }
    Ok(Ty::Float)
}

macro_rules! fl1 {
    ($name:literal, $f:expr, $doc:literal, $aliases:expr) => {
        Builtin {
            name: $name,
            category: "float",
            signature: concat!($name, "(x) -> float, only inside float { }"),
            doc: $doc,
            aliases: $aliases,
            example: concat!("float { ", $name, "(1/2) }"),
            float_only: true,
            ty: |_, a| float_fn($name, a, 1),
            run: |_, a| {
                let g: fn(f64) -> f64 = $f;
                Ok(Value::Float(g(f(&a[0])?)))
            },
        }
    };
}

fn catalog_only_ty(_: &TyCtx, _: &[Ty]) -> Result<Ty> {
    type_err("handled by the checker")
}

fn catalog_only_run(_: &mut Ctx, _: &[Value]) -> Result<Value> {
    type_err("handled by the evaluator")
}

pub const HIGHER_ORDER: [&str; 7] = ["map", "filter", "fold", "any", "all", "count", "formula"];

pub static BUILTINS: &[Builtin] = &[
    // Numbers.
    Builtin {
        name: "abs", category: "number", signature: "abs(x) -> same kind", doc: "Absolute value of a number, money amount or quantity.",
        aliases: &["absolute value", "magnitude"], example: "abs(-3/4)", float_only: false,
        ty: |c, a| { arity("abs", a, 1)?; match &a[0] { t if t.is_exact_num() || matches!(t, Ty::Money(_) | Ty::Quantity(_)) => Ok(t.clone()), Ty::Float if c.float_mode => Ok(Ty::Float), t => type_err(format!("abs needs a number, got {}", t.name())) } },
        run: |_, a| Ok(match &a[0] { Value::Int(i) => Value::Int(i.abs()), Value::Rat(r) => Value::Rat(r.abs()), Value::Dec(d) => Value::Dec(Decimal { unscaled: d.unscaled.abs(), scale: d.scale }), Value::Money(r, c) => Value::Money(r.abs(), c.clone()), Value::Qty(r, d) => Value::Qty(r.abs(), *d), Value::Float(x) => Value::Float(x.abs()), _ => return type_err("abs needs a number") }),
    },
    Builtin {
        name: "sign", category: "number", signature: "sign(x) -> int", doc: "Sign of an exact number: -1, 0 or 1.",
        aliases: &["signum"], example: "sign(-2)", float_only: false,
        ty: |_, a| { arity("sign", a, 1)?; want_exact("sign", &a[0])?; Ok(Ty::Int) },
        run: |_, a| { let r = rat(&a[0])?; Ok(Value::Int(if r.is_positive() { BigInt::one() } else if r.is_negative() { -BigInt::one() } else { BigInt::zero() })) },
    },
    Builtin {
        name: "floor", category: "number", signature: "floor(x) -> int", doc: "Largest integer not above x.",
        aliases: &["round down to integer"], example: "floor(7/2)", float_only: false,
        ty: |_, a| { arity("floor", a, 1)?; want_exact("floor", &a[0])?; Ok(Ty::Int) },
        run: |_, a| Ok(Value::Int(rat(&a[0])?.floor().to_integer())),
    },
    Builtin {
        name: "ceil", category: "number", signature: "ceil(x) -> int", doc: "Smallest integer not below x.",
        aliases: &["ceiling", "round up to integer"], example: "ceil(7/2)", float_only: false,
        ty: |_, a| { arity("ceil", a, 1)?; want_exact("ceil", &a[0])?; Ok(Ty::Int) },
        run: |_, a| Ok(Value::Int(rat(&a[0])?.ceil().to_integer())),
    },
    Builtin {
        name: "trunc", category: "number", signature: "trunc(x) -> int", doc: "Integer part of x, toward zero.",
        aliases: &["truncate", "integer part"], example: "trunc(-7/2)", float_only: false,
        ty: |_, a| { arity("trunc", a, 1)?; want_exact("trunc", &a[0])?; Ok(Ty::Int) },
        run: |_, a| Ok(Value::Int(rat(&a[0])?.trunc().to_integer())),
    },
    Builtin {
        name: "round", category: "number", signature: "round(x, scale, mode) -> decimal; money for money",
        doc: "Round to a number of decimal places with an explicit mode: half_even, half_up, half_down, up, down, floor or ceiling.",
        aliases: &["round to decimal places", "rounding", "round half even", "bankers rounding", "round currency"], example: "round(2/3, 4, \"half_even\")", float_only: false,
        ty: |_, a| { arity("round", a, 3)?; want_int("round", &a[1])?; want_mode("round", &a[2])?; match &a[0] { t if t.is_exact_num() => Ok(Ty::Decimal), Ty::Money(c) => Ok(Ty::Money(c.clone())), t => type_err(format!("round needs an exact number or money, got {}", t.name())) } },
        run: |_, a| round_value(&a[0], scale_arg(&a[1])?, mode_arg(&a[2])?),
    },
    Builtin {
        name: "min", category: "number", signature: "min(a, b) or min(vector)", doc: "Smaller of two comparable values. With one vector argument, its smallest item.",
        aliases: &["minimum", "smallest", "lowest"], example: "min(3, 1/2)", float_only: false,
        ty: |_, a| min_max_ty("min", a),
        run: |c, a| min_max(c, a, Ordering::Less),
    },
    Builtin {
        name: "max", category: "number", signature: "max(a, b) or max(vector)", doc: "Larger of two comparable values. With one vector argument, its largest item.",
        aliases: &["maximum", "largest", "highest"], example: "max([1, 5, 3])", float_only: false,
        ty: |_, a| min_max_ty("max", a),
        run: |c, a| min_max(c, a, Ordering::Greater),
    },
    Builtin {
        name: "numerator", category: "number", signature: "numerator(x) -> int", doc: "Numerator of the reduced fraction.",
        aliases: &["top of fraction"], example: "numerator(6/4)", float_only: false,
        ty: |_, a| { arity("numerator", a, 1)?; want_exact("numerator", &a[0])?; Ok(Ty::Int) },
        run: |_, a| Ok(Value::Int(rat(&a[0])?.numer().clone())),
    },
    Builtin {
        name: "denominator", category: "number", signature: "denominator(x) -> int", doc: "Denominator of the reduced fraction.",
        aliases: &["bottom of fraction"], example: "denominator(6/4)", float_only: false,
        ty: |_, a| { arity("denominator", a, 1)?; want_exact("denominator", &a[0])?; Ok(Ty::Int) },
        run: |_, a| Ok(Value::Int(rat(&a[0])?.denom().clone())),
    },
    Builtin {
        name: "rational", category: "number", signature: "rational(x) -> rational", doc: "Exact rational value of an int or decimal.",
        aliases: &["fraction", "to fraction"], example: "rational(0.125)", float_only: false,
        ty: |_, a| { arity("rational", a, 1)?; want_exact("rational", &a[0])?; Ok(Ty::Rational) },
        run: |_, a| Ok(Value::Rat(rat(&a[0])?)),
    },
    Builtin {
        name: "exact", category: "float", signature: "exact(f) -> rational", doc: "Exact rational value of a binary64 float. Use it to bring a float block result back.",
        aliases: &["float to rational"], example: "exact(float { 0.1 })", float_only: false,
        ty: |_, a| { arity("exact", a, 1)?; if a[0] == Ty::Float { Ok(Ty::Rational) } else { type_err("exact needs a float") } },
        run: |_, a| match &a[0] { Value::Float(x) => exact_of_float(*x), _ => type_err("exact needs a float") },
    },
    Builtin {
        name: "gcd", category: "number theory", signature: "gcd(a, b) -> int", doc: "Greatest common divisor.",
        aliases: &["greatest common divisor", "highest common factor"], example: "gcd(84, 36)", float_only: false,
        ty: |_, a| { arity("gcd", a, 2)?; want_int("gcd", &a[0])?; want_int("gcd", &a[1])?; Ok(Ty::Int) },
        run: |_, a| Ok(Value::Int(int(&a[0])?.gcd(&int(&a[1])?))),
    },
    Builtin {
        name: "lcm", category: "number theory", signature: "lcm(a, b) -> int", doc: "Least common multiple.",
        aliases: &["least common multiple", "lowest common multiple"], example: "lcm(4, 6)", float_only: false,
        ty: |_, a| { arity("lcm", a, 2)?; want_int("lcm", &a[0])?; want_int("lcm", &a[1])?; Ok(Ty::Int) },
        run: |_, a| Ok(Value::Int(int(&a[0])?.lcm(&int(&a[1])?))),
    },
    Builtin {
        name: "mod", category: "number theory", signature: "mod(a, b) -> int", doc: "Euclidean remainder, always between 0 and |b| - 1.",
        aliases: &["modulo", "remainder"], example: "mod(-7, 3)", float_only: false,
        ty: |_, a| { arity("mod", a, 2)?; want_int("mod", &a[0])?; want_int("mod", &a[1])?; Ok(Ty::Int) },
        run: |_, a| { let (x, y) = (int(&a[0])?, int(&a[1])?); if y.is_zero() { return Err(UcmError::DivisionByZero); } let r = x.mod_floor(&y.abs()); Ok(Value::Int(r)) },
    },
    Builtin {
        name: "quot", category: "number theory", signature: "quot(a, b) -> int", doc: "Floor division: floor(a / b).",
        aliases: &["integer division", "floor division"], example: "quot(-7, 2)", float_only: false,
        ty: |_, a| { arity("quot", a, 2)?; want_int("quot", &a[0])?; want_int("quot", &a[1])?; Ok(Ty::Int) },
        run: |_, a| { let (x, y) = (int(&a[0])?, int(&a[1])?); if y.is_zero() { return Err(UcmError::DivisionByZero); } Ok(Value::Int(x.div_floor(&y))) },
    },
    Builtin {
        name: "factorial", category: "number theory", signature: "factorial(n) -> int", doc: "Factorial of n, the product 1 * 2 * ... * n, for n from 0 to 20000.",
        aliases: &["n factorial", "permutations of n"], example: "factorial(20)", float_only: false,
        ty: |_, a| { arity("factorial", a, 1)?; want_int("factorial", &a[0])?; Ok(Ty::Int) },
        run: |c, a| { let n = small(&a[0], "n")?; if !(0..=20_000).contains(&n) { return domain_err("factorial needs 0 <= n <= 20000"); } let mut acc = BigInt::one(); for k in 2..=n { c.budget.step()?; acc *= k; c.budget.bits(acc.bits())?; } Ok(Value::Int(acc)) },
    },
    Builtin {
        name: "binomial", category: "number theory", signature: "binomial(n, k) -> int", doc: "Binomial coefficient n choose k.",
        aliases: &["n choose k", "combinations", "binomial coefficient"], example: "binomial(10, 3)", float_only: false,
        ty: |_, a| { arity("binomial", a, 2)?; want_int("binomial", &a[0])?; want_int("binomial", &a[1])?; Ok(Ty::Int) },
        run: |c, a| { let n = small(&a[0], "n")?; let k = small(&a[1], "k")?; if n < 0 || k < 0 || k > n { return Ok(Value::Int(BigInt::zero())); } let k = k.min(n - k); let mut acc = BigInt::one(); for i in 0..k { c.budget.step()?; acc = acc * BigInt::from(n - i) / BigInt::from(i + 1); c.budget.bits(acc.bits())?; } Ok(Value::Int(acc)) },
    },
    Builtin {
        name: "isqrt", category: "number theory", signature: "isqrt(n) -> int", doc: "Integer square root floor(sqrt(n)) for n >= 0.",
        aliases: &["integer square root"], example: "isqrt(99)", float_only: false,
        ty: |_, a| { arity("isqrt", a, 1)?; want_int("isqrt", &a[0])?; Ok(Ty::Int) },
        run: |_, a| { let n = int(&a[0])?; if n.is_negative() { return domain_err("isqrt of a negative number"); } Ok(Value::Int(isqrt(&n))) },
    },
    Builtin {
        name: "is_prime", category: "number theory", signature: "is_prime(n) -> bool", doc: "Deterministic primality test, exact below 3.1e23.",
        aliases: &["prime test", "primality"], example: "is_prime(1000003)", float_only: false,
        ty: |_, a| { arity("is_prime", a, 1)?; want_int("is_prime", &a[0])?; Ok(Ty::Bool) },
        run: |_, a| Ok(Value::Bool(miller_rabin(&int(&a[0])?)?)),
    },
    Builtin {
        name: "sqrt", category: "number", signature: "sqrt(x, scale, mode) -> decimal; sqrt(x) -> float inside float { }",
        doc: "Square root rounded to scale decimal places with an explicit mode. Inside a float block, sqrt(x) is the binary64 root.",
        aliases: &["square root", "root"], example: "sqrt(2, 10, \"half_even\")", float_only: false,
        ty: |c, a| { if a.len() == 1 { if c.float_mode { return float_fn("sqrt", a, 1); } return type_err("sqrt(x) needs a float block, use sqrt(x, scale, mode) for an exact result"); } arity("sqrt", a, 3)?; want_exact("sqrt", &a[0])?; want_int("sqrt", &a[1])?; want_mode("sqrt", &a[2])?; Ok(Ty::Decimal) },
        run: |_, a| { if a.len() == 1 { return Ok(Value::Float(f(&a[0])?.sqrt())); } Ok(Value::Dec(sqrt_round(&rat(&a[0])?, scale_arg(&a[1])?, mode_arg(&a[2])?)?)) },
    },
    fl1!("exp", f64::exp, "e to the power x, binary64.", &["exponential", "e to the x"]),
    fl1!("ln", f64::ln, "Natural logarithm, binary64.", &["natural log", "log e"]),
    fl1!("log10", f64::log10, "Base 10 logarithm, binary64.", &["common log", "decimal logarithm"]),
    fl1!("log2", f64::log2, "Base 2 logarithm, binary64.", &["binary logarithm"]),
    fl1!("sin", f64::sin, "Sine of an angle in radians, binary64.", &["sine"]),
    fl1!("cos", f64::cos, "Cosine of an angle in radians, binary64.", &["cosine"]),
    fl1!("tan", f64::tan, "Tangent of an angle in radians, binary64.", &["tangent"]),
    fl1!("asin", f64::asin, "Arcsine in radians, binary64.", &["arcsine", "inverse sine"]),
    fl1!("acos", f64::acos, "Arccosine in radians, binary64.", &["arccosine", "inverse cosine"]),
    fl1!("atan", f64::atan, "Arctangent in radians, binary64.", &["arctangent", "inverse tangent"]),
    Builtin {
        name: "atan2", category: "float", signature: "atan2(y, x) -> float, only inside float { }", doc: "Angle of the point (x, y) in radians, binary64.",
        aliases: &["two argument arctangent", "bearing angle"], example: "float { atan2(1, 1) }", float_only: true,
        ty: |_, a| float_fn("atan2", a, 2),
        run: |_, a| Ok(Value::Float(f(&a[0])?.atan2(f(&a[1])?))),
    },
    Builtin {
        name: "pi", category: "float", signature: "pi() -> float, only inside float { }", doc: "The binary64 value nearest to pi.",
        aliases: &["circle constant"], example: "float { pi() * 2 }", float_only: true,
        ty: |_, a| float_fn("pi", a, 0),
        run: |_, _| Ok(Value::Float(std::f64::consts::PI)),
    },
    // Money.
    Builtin {
        name: "money", category: "money", signature: "money(amount, \"CUR\") -> money[CUR]", doc: "Money amount in an ISO 4217 currency. The amount is exact.",
        aliases: &["currency amount", "price", "cash"], example: "money(\"12.50\", \"CHF\")", float_only: false,
        ty: |_, a| { arity("money", a, 2)?; if !(a[0].is_exact_num() || matches!(a[0], Ty::Text(_))) { return type_err("money needs an exact amount or amount text"); } let c = want_text("money", &a[1])?; Ok(Ty::Money(c.map(|x| check_currency(&x)).transpose()?)) },
        run: |_, a| { let amt = match &a[0] { Value::Text(t) => crate::num::parse_rat(t)?, other => rat(other)? }; Ok(Value::Money(amt, check_currency(&text(&a[1])?)?)) },
    },
    Builtin {
        name: "amount", category: "money", signature: "amount(m) -> rational", doc: "Exact amount of a money value without its currency.",
        aliases: &["value of money", "strip currency"], example: "amount(money(\"3.10\", \"EUR\"))", float_only: false,
        ty: |_, a| { arity("amount", a, 1)?; match a[0] { Ty::Money(_) => Ok(Ty::Rational), _ => type_err("amount needs money") } },
        run: |_, a| match &a[0] { Value::Money(r, _) => Ok(Value::Rat(r.clone())), _ => type_err("amount needs money") },
    },
    Builtin {
        name: "currency", category: "money", signature: "currency(m) -> text", doc: "ISO 4217 code of a money value.",
        aliases: &["currency code"], example: "currency(money(1, \"JPY\"))", float_only: false,
        ty: |_, a| { arity("currency", a, 1)?; match &a[0] { Ty::Money(c) => Ok(Ty::Text(c.clone())), _ => type_err("currency needs money") } },
        run: |_, a| match &a[0] { Value::Money(_, c) => Ok(Value::Text(c.clone())), _ => type_err("currency needs money") },
    },
    Builtin {
        name: "convert", category: "money", signature: "convert(m, \"CUR\", rate) -> money[CUR]", doc: "Convert money with a rate the caller supplies, in target units per source unit. UCM never fetches rates.",
        aliases: &["exchange rate", "currency conversion", "fx conversion"], example: "convert(money(100, \"USD\"), \"EUR\", 0.92)", float_only: false,
        ty: |_, a| { arity("convert", a, 3)?; if !matches!(a[0], Ty::Money(_)) { return type_err("convert needs money"); } want_exact("convert", &a[2])?; let c = want_text("convert", &a[1])?; Ok(Ty::Money(c.map(|x| check_currency(&x)).transpose()?)) },
        run: |_, a| { let r = rat(&a[2])?; if !r.is_positive() { return domain_err("rate must be positive"); } match &a[0] { Value::Money(m, _) => Ok(Value::Money(m * r, check_currency(&text(&a[1])?)?)), _ => type_err("convert needs money") } },
    },
    Builtin {
        name: "allocate", category: "money", signature: "allocate(m, parts_or_weights, scale) -> vector[money]",
        doc: "Split money into parts at a fixed scale so the parts add up exactly to the total. Leftover minor units go to the largest remainders, ties to the earlier part.",
        aliases: &["split bill", "divide money", "pro rata", "proportional split"], example: "allocate(money(\"100.00\", \"USD\"), 3, 2)", float_only: false,
        ty: |_, a| { arity("allocate", a, 3)?; let Ty::Money(c) = &a[0] else { return type_err("allocate needs money") }; match &a[1] { Ty::Int => {}, Ty::Vector(e) if e.is_exact_num() => {}, t => return type_err(format!("allocate needs a part count or weights, got {}", t.name())) } want_int("allocate", &a[2])?; Ok(Ty::Vector(Box::new(Ty::Money(c.clone())))) },
        run: |c, a| allocate(c, a),
    },
    // Quantities.
    Builtin {
        name: "q", category: "units", signature: "q(value, \"unit\") -> quantity", doc: "Quantity with a unit, stored exactly in SI base units. Units: SI with prefixes, min, h, day, L, t, bar, atm, eV, Wh, cal, in, ft, yd, mi, nmi, lb, oz, lbf, psi, gal, kn, mph.",
        aliases: &["quantity", "measurement", "with unit", "units"], example: "q(90, \"km/h\")", float_only: false,
        ty: |_, a| { arity("q", a, 2)?; want_exact("q", &a[0])?; let u = parse_unit(&lit_text("q", &a[1])?)?; Ok(qty_ty(u.dim)) },
        run: |_, a| { let u = parse_unit(&text(&a[1])?)?; Ok(qty(rat(&a[0])? * u.factor, u.dim)) },
    },
    Builtin {
        name: "to", category: "units", signature: "to(q, \"unit\") -> rational", doc: "Exact value of a quantity in the named unit. The dimensions must match.",
        aliases: &["convert units", "unit conversion", "in unit", "express in"], example: "to(q(1, \"mi\"), \"km\")", float_only: false,
        ty: |_, a| { arity("to", a, 2)?; let u = parse_unit(&lit_text("to", &a[1])?)?; let d = match &a[0] { Ty::Quantity(d) => *d, t if t.is_exact_num() => DIMLESS, t => return type_err(format!("to needs a quantity, got {}", t.name())) }; if d != u.dim { return Err(UcmError::Unit(format!("cannot express {} in {}", dim_render(&d), dim_render(&u.dim)))); } Ok(Ty::Rational) },
        run: |_, a| { let u = parse_unit(&text(&a[1])?)?; let (r, d) = match &a[0] { Value::Qty(r, d) => (r.clone(), *d), other => (rat(other)?, DIMLESS) }; if d != u.dim { return Err(UcmError::Unit("dimension mismatch".into())); } Ok(Value::Rat(r / u.factor)) },
    },
    Builtin {
        name: "dimension", category: "units", signature: "dimension(q) -> text", doc: "SI base dimension of a quantity, for example m*kg/s^2.",
        aliases: &["dimensions", "si dimension"], example: "dimension(q(1, \"N\"))", float_only: false,
        ty: |_, a| { arity("dimension", a, 1)?; match &a[0] { Ty::Quantity(d) => Ok(Ty::Text(Some(dim_render(d)))), t if t.is_exact_num() => Ok(Ty::Text(Some("1".into()))), _ => type_err("dimension needs a quantity") } },
        run: |_, a| Ok(Value::Text(match &a[0] { Value::Qty(_, d) => dim_render(d), _ => "1".into() })),
    },
    Builtin {
        name: "celsius", category: "units", signature: "celsius(x) -> quantity[K]", doc: "Temperature given in degrees Celsius, as kelvin: x + 273.15.",
        aliases: &["degrees celsius", "centigrade"], example: "celsius(21)", float_only: false,
        ty: |_, a| { arity("celsius", a, 1)?; want_exact("celsius", &a[0])?; Ok(Ty::Quantity(K_TEMP)) },
        run: |_, a| Ok(Value::Qty(rat(&a[0])? + crate::num::parse_rat("273.15")?, K_TEMP)),
    },
    Builtin {
        name: "fahrenheit", category: "units", signature: "fahrenheit(x) -> quantity[K]", doc: "Temperature given in degrees Fahrenheit, as kelvin: (x + 459.67) * 5/9.",
        aliases: &["degrees fahrenheit"], example: "fahrenheit(70)", float_only: false,
        ty: |_, a| { arity("fahrenheit", a, 1)?; want_exact("fahrenheit", &a[0])?; Ok(Ty::Quantity(K_TEMP)) },
        run: |_, a| Ok(Value::Qty((rat(&a[0])? + crate::num::parse_rat("459.67")?) * Rat::new(BigInt::from(5), BigInt::from(9)), K_TEMP)),
    },
    Builtin {
        name: "to_celsius", category: "units", signature: "to_celsius(t) -> rational", doc: "Degrees Celsius of a temperature quantity.",
        aliases: &["kelvin to celsius"], example: "to_celsius(q(300, \"K\"))", float_only: false,
        ty: |_, a| { arity("to_celsius", a, 1)?; if a[0] == Ty::Quantity(K_TEMP) { Ok(Ty::Rational) } else { type_err("to_celsius needs a temperature") } },
        run: |_, a| match &a[0] { Value::Qty(r, _) => Ok(Value::Rat(r - crate::num::parse_rat("273.15")?)), _ => type_err("to_celsius needs a temperature") },
    },
    Builtin {
        name: "to_fahrenheit", category: "units", signature: "to_fahrenheit(t) -> rational", doc: "Degrees Fahrenheit of a temperature quantity.",
        aliases: &["kelvin to fahrenheit", "celsius to fahrenheit"], example: "to_fahrenheit(celsius(100))", float_only: false,
        ty: |_, a| { arity("to_fahrenheit", a, 1)?; if a[0] == Ty::Quantity(K_TEMP) { Ok(Ty::Rational) } else { type_err("to_fahrenheit needs a temperature") } },
        run: |_, a| match &a[0] { Value::Qty(r, _) => Ok(Value::Rat(r * Rat::new(BigInt::from(9), BigInt::from(5)) - crate::num::parse_rat("459.67")?)), _ => type_err("to_fahrenheit needs a temperature") },
    },
    // Intervals.
    Builtin {
        name: "interval", category: "interval", signature: "interval(lo, hi) -> interval", doc: "Closed interval of exact numbers for error bounds. Arithmetic on intervals keeps every possible value inside.",
        aliases: &["range of values", "error bounds", "uncertainty", "tolerance"], example: "interval(9.7, 9.9) * 2", float_only: false,
        ty: |_, a| { arity("interval", a, 2)?; want_exact("interval", &a[0])?; want_exact("interval", &a[1])?; Ok(Ty::Interval) },
        run: |_, a| { let (lo, hi) = (rat(&a[0])?, rat(&a[1])?); if lo > hi { return domain_err("interval lo above hi"); } Ok(Value::Interval(lo, hi)) },
    },
    Builtin {
        name: "lo", category: "interval", signature: "lo(i) -> rational", doc: "Lower bound of an interval.",
        aliases: &["lower bound"], example: "lo(interval(1, 2))", float_only: false,
        ty: |_, a| { arity("lo", a, 1)?; if a[0] == Ty::Interval { Ok(Ty::Rational) } else { type_err("lo needs an interval") } },
        run: |_, a| match &a[0] { Value::Interval(l, _) => Ok(Value::Rat(l.clone())), _ => type_err("lo needs an interval") },
    },
    Builtin {
        name: "hi", category: "interval", signature: "hi(i) -> rational", doc: "Upper bound of an interval.",
        aliases: &["upper bound"], example: "hi(interval(1, 2))", float_only: false,
        ty: |_, a| { arity("hi", a, 1)?; if a[0] == Ty::Interval { Ok(Ty::Rational) } else { type_err("hi needs an interval") } },
        run: |_, a| match &a[0] { Value::Interval(_, h) => Ok(Value::Rat(h.clone())), _ => type_err("hi needs an interval") },
    },
    Builtin {
        name: "width", category: "interval", signature: "width(i) -> rational", doc: "Width hi - lo of an interval.",
        aliases: &["spread"], example: "width(interval(1, 5/2))", float_only: false,
        ty: |_, a| { arity("width", a, 1)?; if a[0] == Ty::Interval { Ok(Ty::Rational) } else { type_err("width needs an interval") } },
        run: |_, a| match &a[0] { Value::Interval(l, h) => Ok(Value::Rat(h - l)), _ => type_err("width needs an interval") },
    },
    Builtin {
        name: "contains", category: "interval", signature: "contains(i, x) -> bool", doc: "Whether an exact number lies inside a closed interval.",
        aliases: &["in range", "within bounds"], example: "contains(interval(1, 2), 3/2)", float_only: false,
        ty: |_, a| { arity("contains", a, 2)?; if a[0] != Ty::Interval { return type_err("contains needs an interval"); } want_exact("contains", &a[1])?; Ok(Ty::Bool) },
        run: |_, a| match &a[0] { Value::Interval(l, h) => { let x = rat(&a[1])?; Ok(Value::Bool(&x >= l && &x <= h)) } _ => type_err("contains needs an interval") },
    },
    // Vectors.
    Builtin {
        name: "len", category: "vector", signature: "len(v) -> int", doc: "Number of items.",
        aliases: &["length", "size", "count of items"], example: "len([1, 2, 3])", float_only: false,
        ty: |_, a| { arity("len", a, 1)?; elem("len", &a[0])?; Ok(Ty::Int) },
        run: |_, a| Ok(Value::Int(BigInt::from(vecv(&a[0])?.len()))),
    },
    Builtin {
        name: "at", category: "vector", signature: "at(v, i) -> item", doc: "Item at zero based index i.",
        aliases: &["index", "element", "nth"], example: "at([10, 20, 30], 1)", float_only: false,
        ty: |_, a| { arity("at", a, 2)?; want_int("at", &a[1])?; elem("at", &a[0]) },
        run: |_, a| { let v = vecv(&a[0])?; let i = small(&a[1], "index")?; usize::try_from(i).ok().and_then(|i| v.get(i)).cloned().ok_or_else(|| UcmError::Domain(format!("index {i} outside 0..{}", v.len()))) },
    },
    Builtin {
        name: "range", category: "vector", signature: "range(a, b) -> vector[int]", doc: "Integers a, a+1, ..., b-1.",
        aliases: &["sequence", "integers from to"], example: "range(0, 5)", float_only: false,
        ty: |_, a| { arity("range", a, 2)?; want_int("range", &a[0])?; want_int("range", &a[1])?; Ok(Ty::Vector(Box::new(Ty::Int))) },
        run: |c, a| { let (x, y) = (small(&a[0], "start")?, small(&a[1], "end")?); let n = (y - x).max(0) as u64; c.budget.len(n)?; c.budget.charge(n)?; Ok(Value::Vec((x..y).map(|i| Value::Int(BigInt::from(i))).collect())) },
    },
    Builtin {
        name: "concat", category: "vector", signature: "concat(a, b) -> vector", doc: "Items of a followed by items of b.",
        aliases: &["append", "join vectors"], example: "concat([1], [2, 3])", float_only: false,
        ty: |_, a| { arity("concat", a, 2)?; let (x, y) = (elem("concat", &a[0])?, elem("concat", &a[1])?); Ok(Ty::Vector(Box::new(crate::check::join(&x, &y)?))) },
        run: |c, a| { let mut v = vecv(&a[0])?.clone(); v.extend(vecv(&a[1])?.iter().cloned()); c.budget.len(v.len() as u64)?; Ok(Value::Vec(v)) },
    },
    Builtin {
        name: "reverse", category: "vector", signature: "reverse(v) -> vector", doc: "Items in reverse order.",
        aliases: &["flip"], example: "reverse([1, 2, 3])", float_only: false,
        ty: |_, a| { arity("reverse", a, 1)?; elem("reverse", &a[0])?; Ok(a[0].clone()) },
        run: |_, a| { let mut v = vecv(&a[0])?.clone(); v.reverse(); Ok(Value::Vec(v)) },
    },
    Builtin {
        name: "sort", category: "vector", signature: "sort(v) -> vector", doc: "Items in ascending order.",
        aliases: &["order", "ascending"], example: "sort([3, 1, 2])", float_only: false,
        ty: |_, a| { arity("sort", a, 1)?; elem("sort", &a[0])?; Ok(a[0].clone()) },
        run: |c, a| { let mut v = vecv(&a[0])?.clone(); let n = v.len() as u64; c.budget.charge(n.saturating_mul(64 - n.leading_zeros() as u64 + 1))?; let mut err = None; v.sort_by(|x, y| compare(x, y).unwrap_or_else(|e| { err = Some(e); Ordering::Equal })); if let Some(e) = err { return Err(e); } Ok(Value::Vec(v)) },
    },
    Builtin {
        name: "sum", category: "statistics", signature: "sum(v) -> number, money or quantity", doc: "Exact sum of the items. The sum of an empty vector is 0.",
        aliases: &["total", "add up", "summation"], example: "sum([1/3, 1/3, 1/3])", float_only: false,
        ty: |_, a| { arity("sum", a, 1)?; summable("sum", &elem("sum", &a[0])?) },
        run: |c, a| add_all(c, vecv(&a[0])?),
    },
    Builtin {
        name: "product", category: "statistics", signature: "product(v) -> number", doc: "Exact product of the items. The product of an empty vector is 1.",
        aliases: &["multiply all"], example: "product([2, 3, 4])", float_only: false,
        ty: |_, a| { arity("product", a, 1)?; let e = elem("product", &a[0])?; match e { Ty::Empty => Ok(Ty::Int), t if t.is_exact_num() => Ok(t), t => type_err(format!("product needs numbers, got {}", t.name())) } },
        run: |c, a| { let items = vecv(&a[0])?; let mut acc = Value::Int(BigInt::one()); for v in items { c.budget.step()?; acc = crate::ops::apply(crate::ast::Op::Mul, &[acc, v.clone()], false, false, 0)?; c.budget.bits(acc.bits())?; } Ok(acc) },
    },
    Builtin {
        name: "mean", category: "statistics", signature: "mean(v) -> rational, money or quantity", doc: "Exact arithmetic mean.",
        aliases: &["average", "arithmetic mean", "avg"], example: "mean([1, 2, 4])", float_only: false,
        ty: |_, a| { arity("mean", a, 1)?; meanable("mean", &elem("mean", &a[0])?) },
        run: |c, a| { let items = vecv(&a[0])?; if items.is_empty() { return domain_err("mean of an empty vector"); } c.budget.charge(items.len() as u64)?; let (rs, mk) = sorted_rats(items)?; Ok(mk(mean_rats(&rs))) },
    },
    Builtin {
        name: "median", category: "statistics", signature: "median(v) -> rational, money or quantity", doc: "Exact median; the mean of the two middle items when the count is even.",
        aliases: &["middle value", "50th percentile"], example: "median([5, 1, 4, 2])", float_only: false,
        ty: |_, a| { arity("median", a, 1)?; meanable("median", &elem("median", &a[0])?) },
        run: |c, a| { let items = vecv(&a[0])?; if items.is_empty() { return domain_err("median of an empty vector"); } c.budget.charge(items.len() as u64 * 8)?; let (rs, mk) = sorted_rats(items)?; let n = rs.len(); Ok(mk(if n % 2 == 1 { rs[n / 2].clone() } else { (&rs[n / 2 - 1] + &rs[n / 2]) / Rat::from_integer(BigInt::from(2)) })) },
    },
    Builtin {
        name: "variance", category: "statistics", signature: "variance(v) -> rational", doc: "Exact population variance (divide by n).",
        aliases: &["population variance"], example: "variance([2, 4, 4, 4, 5, 5, 7, 9])", float_only: false,
        ty: |_, a| { arity("variance", a, 1)?; var_ty("variance", a) },
        run: |c, a| { let items = vecv(&a[0])?; c.budget.charge(items.len() as u64 * 4)?; Ok(var_wrap(items, variance(items, false)?)) },
    },
    Builtin {
        name: "variance_sample", category: "statistics", signature: "variance_sample(v) -> rational", doc: "Exact sample variance (divide by n - 1).",
        aliases: &["sample variance", "unbiased variance"], example: "variance_sample([1, 2, 3, 4])", float_only: false,
        ty: |_, a| { arity("variance_sample", a, 1)?; var_ty("variance_sample", a) },
        run: |c, a| { let items = vecv(&a[0])?; c.budget.charge(items.len() as u64 * 4)?; Ok(var_wrap(items, variance(items, true)?)) },
    },
    Builtin {
        name: "stddev", category: "statistics", signature: "stddev(v, scale, mode) -> decimal", doc: "Population standard deviation of exact numbers, rounded to scale places with an explicit mode.",
        aliases: &["standard deviation", "population standard deviation", "sigma"], example: "stddev([2, 4, 4, 4, 5, 5, 7, 9], 6, \"half_even\")", float_only: false,
        ty: |_, a| { arity("stddev", a, 3)?; let e = elem("stddev", &a[0])?; if !(e.is_exact_num() || e == Ty::Empty) { return type_err("stddev needs exact numbers"); } want_int("stddev", &a[1])?; want_mode("stddev", &a[2])?; Ok(Ty::Decimal) },
        run: |c, a| { let items = vecv(&a[0])?; c.budget.charge(items.len() as u64 * 4)?; Ok(Value::Dec(sqrt_round(&variance(items, false)?, scale_arg(&a[1])?, mode_arg(&a[2])?)?)) },
    },
    Builtin {
        name: "stddev_sample", category: "statistics", signature: "stddev_sample(v, scale, mode) -> decimal", doc: "Sample standard deviation of exact numbers, rounded to scale places with an explicit mode.",
        aliases: &["sample standard deviation"], example: "stddev_sample([1, 2, 3, 4], 6, \"half_even\")", float_only: false,
        ty: |_, a| { arity("stddev_sample", a, 3)?; let e = elem("stddev_sample", &a[0])?; if !(e.is_exact_num() || e == Ty::Empty) { return type_err("stddev_sample needs exact numbers"); } want_int("stddev_sample", &a[1])?; want_mode("stddev_sample", &a[2])?; Ok(Ty::Decimal) },
        run: |c, a| { let items = vecv(&a[0])?; c.budget.charge(items.len() as u64 * 4)?; Ok(Value::Dec(sqrt_round(&variance(items, true)?, scale_arg(&a[1])?, mode_arg(&a[2])?)?)) },
    },
    Builtin {
        name: "percentile", category: "statistics", signature: "percentile(v, p, \"nearest_rank\" | \"linear\") -> rational",
        doc: "p-th percentile, p from 0 to 100. nearest_rank picks an item; linear interpolates between closest ranks (the same rule as Excel PERCENTILE.INC).",
        aliases: &["quantile", "quartile"], example: "percentile([15, 20, 35, 40, 50], 40, \"linear\")", float_only: false,
        ty: |_, a| { arity("percentile", a, 3)?; let e = elem("percentile", &a[0])?; if !(e.is_exact_num() || e == Ty::Empty) { return type_err("percentile needs exact numbers"); } want_exact("percentile", &a[1])?; if let Some(m) = want_text("percentile", &a[2])? { if m != "nearest_rank" && m != "linear" { return type_err("percentile method is nearest_rank or linear"); } } Ok(Ty::Rational) },
        run: |c, a| percentile(c, a),
    },
    Builtin {
        name: "dot", category: "linear algebra", signature: "dot(a, b) -> rational", doc: "Exact dot product of two equal length vectors.",
        aliases: &["scalar product", "inner product", "sumproduct"], example: "dot([1, 2], [3, 4])", float_only: false,
        ty: |_, a| { arity("dot", a, 2)?; let (x, y) = (elem("dot", &a[0])?, elem("dot", &a[1])?); if (x.is_exact_num() || x == Ty::Empty) && (y.is_exact_num() || y == Ty::Empty) { Ok(Ty::Rational) } else { type_err("dot needs exact number vectors") } },
        run: |c, a| { let (x, y) = (vecv(&a[0])?, vecv(&a[1])?); if x.len() != y.len() { return domain_err("dot needs equal lengths"); } c.budget.charge(x.len() as u64)?; let mut acc = Rat::zero(); for (p, q) in x.iter().zip(y) { acc += rat(p)? * rat(q)?; } c.budget.bits(crate::num::rat_bits(&acc))?; Ok(Value::Rat(acc)) },
    },
    Builtin {
        name: "identity", category: "linear algebra", signature: "identity(n) -> matrix", doc: "n by n identity matrix.",
        aliases: &["unit matrix"], example: "identity(3)", float_only: false,
        ty: |_, a| { arity("identity", a, 1)?; want_int("identity", &a[0])?; Ok(Ty::Vector(Box::new(Ty::Vector(Box::new(Ty::Rational))))) },
        run: |c, a| { let n = small(&a[0], "n")?; if n < 0 { return domain_err("negative size"); } c.budget.len((n * n) as u64)?; Ok(from_matrix((0..n).map(|i| (0..n).map(|j| if i == j { Rat::one() } else { Rat::zero() }).collect()).collect())) },
    },
    Builtin {
        name: "transpose", category: "linear algebra", signature: "transpose(m) -> matrix", doc: "Matrix transpose.",
        aliases: &["flip matrix"], example: "transpose([[1, 2], [3, 4]])", float_only: false,
        ty: |_, a| { arity("transpose", a, 1)?; matrix_ty("transpose", &a[0])?; Ok(Ty::Vector(Box::new(Ty::Vector(Box::new(Ty::Rational))))) },
        run: |_, a| { let m = to_matrix(&a[0])?; let w = m.first().map(|r| r.len()).unwrap_or(0); Ok(from_matrix((0..w).map(|j| m.iter().map(|r| r[j].clone()).collect()).collect())) },
    },
    Builtin {
        name: "matmul", category: "linear algebra", signature: "matmul(a, b) -> matrix", doc: "Exact matrix product.",
        aliases: &["matrix multiplication", "matrix product"], example: "matmul([[1, 2], [3, 4]], [[5], [6]])", float_only: false,
        ty: |_, a| { arity("matmul", a, 2)?; matrix_ty("matmul", &a[0])?; matrix_ty("matmul", &a[1])?; Ok(Ty::Vector(Box::new(Ty::Vector(Box::new(Ty::Rational))))) },
        run: |c, a| { let (x, y) = (to_matrix(&a[0])?, to_matrix(&a[1])?); let inner = x.first().map(|r| r.len()).unwrap_or(0); if inner != y.len() { return domain_err("matmul shapes do not fit"); } let w = y.first().map(|r| r.len()).unwrap_or(0); c.budget.charge((x.len() * w * inner) as u64)?; let out: Vec<Vec<Rat>> = x.iter().map(|r| (0..w).map(|j| r.iter().zip(&y).fold(Rat::zero(), |s, (p, row)| s + p * &row[j])).collect()).collect(); for r in &out { for v in r { c.budget.bits(crate::num::rat_bits(v))?; } } Ok(from_matrix(out)) },
    },
    Builtin {
        name: "det", category: "linear algebra", signature: "det(m) -> rational", doc: "Exact determinant of a square matrix.",
        aliases: &["determinant"], example: "det([[2, 1], [1, 3]])", float_only: false,
        ty: |_, a| { arity("det", a, 1)?; matrix_ty("det", &a[0])?; Ok(Ty::Rational) },
        run: |c, a| { let m = to_matrix(&a[0])?; let n = square(&m)?; let (_, _, d) = eliminate(c, m, n)?; Ok(Value::Rat(d)) },
    },
    Builtin {
        name: "rank", category: "linear algebra", signature: "rank(m) -> int", doc: "Exact rank of a matrix.",
        aliases: &["matrix rank"], example: "rank([[1, 2], [2, 4]])", float_only: false,
        ty: |_, a| { arity("rank", a, 1)?; matrix_ty("rank", &a[0])?; Ok(Ty::Int) },
        run: |c, a| { let m = to_matrix(&a[0])?; let w = m.first().map(|r| r.len()).unwrap_or(0); let (_, r, _) = eliminate(c, m, w)?; Ok(Value::Int(BigInt::from(r))) },
    },
    Builtin {
        name: "inverse", category: "linear algebra", signature: "inverse(m) -> matrix", doc: "Exact inverse of a square matrix. A singular matrix is a domain error.",
        aliases: &["matrix inverse", "invert matrix"], example: "inverse([[2, 1], [1, 1]])", float_only: false,
        ty: |_, a| { arity("inverse", a, 1)?; matrix_ty("inverse", &a[0])?; Ok(Ty::Vector(Box::new(Ty::Vector(Box::new(Ty::Rational))))) },
        run: |c, a| { let m = to_matrix(&a[0])?; let n = square(&m)?; let aug: Vec<Vec<Rat>> = m.into_iter().enumerate().map(|(i, mut r)| { r.extend((0..n).map(|j| if i == j { Rat::one() } else { Rat::zero() })); r }).collect(); let (red, rk, _) = eliminate(c, aug, n)?; if rk < n { return domain_err("matrix is singular"); } Ok(from_matrix(red.into_iter().map(|r| r[n..].to_vec()).collect())) },
    },
    Builtin {
        name: "solve", category: "linear algebra", signature: "solve(a, b) -> vector[rational]", doc: "Exact solution x of a * x = b for a square non singular matrix a.",
        aliases: &["linear system", "simultaneous equations", "system of equations"], example: "solve([[2, 1], [1, 3]], [3, 5])", float_only: false,
        ty: |_, a| { arity("solve", a, 2)?; matrix_ty("solve", &a[0])?; let e = elem("solve", &a[1])?; if !(e.is_exact_num() || e == Ty::Empty) { return type_err("solve needs a vector of exact numbers"); } Ok(Ty::Vector(Box::new(Ty::Rational))) },
        run: |c, a| { let m = to_matrix(&a[0])?; let n = square(&m)?; let b = vecv(&a[1])?.iter().map(rat).collect::<Result<Vec<_>>>()?; if b.len() != n { return domain_err("solve shapes do not fit"); } let aug: Vec<Vec<Rat>> = m.into_iter().zip(b).map(|(mut r, x)| { r.push(x); r }).collect(); let (red, rk, _) = eliminate(c, aug, n)?; if rk < n { return domain_err("matrix is singular"); } Ok(Value::Vec(red.into_iter().map(|r| Value::Rat(r[n].clone())).collect())) },
    },
    // Time.
    Builtin {
        name: "date", category: "time", signature: "date(\"YYYY-MM-DD\") or date(y, m, d) -> date", doc: "Calendar date in the proleptic Gregorian calendar.",
        aliases: &["calendar date", "day"], example: "date(\"2026-11-07\")", float_only: false,
        ty: |_, a| { if a.len() == 1 { want_text("date", &a[0])?; return Ok(Ty::Date); } arity("date", a, 3)?; for t in a { want_int("date", t)?; } Ok(Ty::Date) },
        run: |_, a| Ok(Value::Date(if a.len() == 1 { crate::time::parse_date(&text(&a[0])?)? } else { crate::time::date_from_ymd(small(&a[0], "year")?, small(&a[1], "month")?, small(&a[2], "day")?)? })),
    },
    Builtin {
        name: "year", category: "time", signature: "year(d) -> int", doc: "Year of a date.",
        aliases: &[], example: "year(date(\"2026-11-07\"))", float_only: false,
        ty: |_, a| { arity("year", a, 1)?; if a[0] == Ty::Date { Ok(Ty::Int) } else { type_err("year needs a date") } },
        run: |_, a| match &a[0] { Value::Date(d) => Ok(Value::Int(BigInt::from(chrono::Datelike::year(d)))), _ => type_err("year needs a date") },
    },
    Builtin {
        name: "month", category: "time", signature: "month(d) -> int", doc: "Month 1 to 12 of a date.",
        aliases: &[], example: "month(date(\"2026-11-07\"))", float_only: false,
        ty: |_, a| { arity("month", a, 1)?; if a[0] == Ty::Date { Ok(Ty::Int) } else { type_err("month needs a date") } },
        run: |_, a| match &a[0] { Value::Date(d) => Ok(Value::Int(BigInt::from(chrono::Datelike::month(d)))), _ => type_err("month needs a date") },
    },
    Builtin {
        name: "day", category: "time", signature: "day(d) -> int", doc: "Day of the month of a date.",
        aliases: &["day of month"], example: "day(date(\"2026-11-07\"))", float_only: false,
        ty: |_, a| { arity("day", a, 1)?; if a[0] == Ty::Date { Ok(Ty::Int) } else { type_err("day needs a date") } },
        run: |_, a| match &a[0] { Value::Date(d) => Ok(Value::Int(BigInt::from(chrono::Datelike::day(d)))), _ => type_err("day needs a date") },
    },
    Builtin {
        name: "weekday", category: "time", signature: "weekday(d) -> int", doc: "ISO weekday: Monday 1 to Sunday 7.",
        aliases: &["day of week"], example: "weekday(date(\"2026-11-07\"))", float_only: false,
        ty: |_, a| { arity("weekday", a, 1)?; if a[0] == Ty::Date { Ok(Ty::Int) } else { type_err("weekday needs a date") } },
        run: |_, a| match &a[0] { Value::Date(d) => Ok(Value::Int(BigInt::from(chrono::Datelike::weekday(d).number_from_monday()))), _ => type_err("weekday needs a date") },
    },
    Builtin {
        name: "day_of_year", category: "time", signature: "day_of_year(d) -> int", doc: "Ordinal day 1 to 366.",
        aliases: &["ordinal date", "julian day of year"], example: "day_of_year(date(\"2026-12-31\"))", float_only: false,
        ty: |_, a| { arity("day_of_year", a, 1)?; if a[0] == Ty::Date { Ok(Ty::Int) } else { type_err("day_of_year needs a date") } },
        run: |_, a| match &a[0] { Value::Date(d) => Ok(Value::Int(BigInt::from(chrono::Datelike::ordinal(d)))), _ => type_err("day_of_year needs a date") },
    },
    Builtin {
        name: "add_days", category: "time", signature: "add_days(d, n) -> date", doc: "Date n days later (n may be negative).",
        aliases: &["date plus days", "days later"], example: "add_days(date(\"2026-11-07\"), 30)", float_only: false,
        ty: |_, a| { arity("add_days", a, 2)?; want_int("add_days", &a[1])?; if a[0] == Ty::Date { Ok(Ty::Date) } else { type_err("add_days needs a date") } },
        run: |_, a| match &a[0] { Value::Date(d) => Ok(Value::Date(crate::time::add_days(d, small(&a[1], "days")?)?)), _ => type_err("add_days needs a date") },
    },
    Builtin {
        name: "add_months", category: "time", signature: "add_months(d, n) -> date", doc: "Date n calendar months later. A day past the end of the target month clamps to its last day.",
        aliases: &["date plus months", "months later"], example: "add_months(date(\"2026-01-31\"), 1)", float_only: false,
        ty: |_, a| { arity("add_months", a, 2)?; want_int("add_months", &a[1])?; if a[0] == Ty::Date { Ok(Ty::Date) } else { type_err("add_months needs a date") } },
        run: |_, a| match &a[0] { Value::Date(d) => Ok(Value::Date(crate::time::add_months(d, small(&a[1], "months")?)?)), _ => type_err("add_months needs a date") },
    },
    Builtin {
        name: "days_between", category: "time", signature: "days_between(a, b) -> int", doc: "Whole days from date a to date b (negative when b is earlier).",
        aliases: &["date difference", "days until", "number of days"], example: "days_between(date(\"2026-01-01\"), date(\"2026-11-07\"))", float_only: false,
        ty: |_, a| { arity("days_between", a, 2)?; if a[0] == Ty::Date && a[1] == Ty::Date { Ok(Ty::Int) } else { type_err("days_between needs two dates") } },
        run: |_, a| match (&a[0], &a[1]) { (Value::Date(x), Value::Date(y)) => Ok(Value::Int(BigInt::from(crate::time::days_from_epoch(y) - crate::time::days_from_epoch(x)))), _ => type_err("days_between needs two dates") },
    },
    Builtin {
        name: "is_leap_year", category: "time", signature: "is_leap_year(y) -> bool", doc: "Gregorian leap year test.",
        aliases: &["leap year"], example: "is_leap_year(2028)", float_only: false,
        ty: |_, a| { arity("is_leap_year", a, 1)?; want_int("is_leap_year", &a[0])?; Ok(Ty::Bool) },
        run: |_, a| Ok(Value::Bool(crate::time::is_leap(small(&a[0], "year")?))),
    },
    Builtin {
        name: "instant", category: "time", signature: "instant(\"YYYY-MM-DDTHH:MM[:SS]\", \"Zone/Name\") -> instant", doc: "Point in time from a local wall clock time in an IANA time zone. Ambiguous and skipped local times are errors.",
        aliases: &["timestamp", "local time", "time zone", "timezone"], example: "instant(\"2026-11-07T09:30\", \"Europe/Zurich\")", float_only: false,
        ty: |_, a| { arity("instant", a, 2)?; want_text("instant", &a[0])?; want_text("instant", &a[1])?; Ok(Ty::Instant) },
        run: |_, a| Ok(Value::Instant(crate::time::instant_in_zone(&text(&a[0])?, &text(&a[1])?)?)),
    },
    Builtin {
        name: "instant_utc", category: "time", signature: "instant_utc(\"RFC 3339 with offset\") -> instant", doc: "Point in time from an RFC 3339 timestamp with an explicit offset.",
        aliases: &["utc timestamp", "iso timestamp"], example: "instant_utc(\"2026-11-07T08:30:00Z\")", float_only: false,
        ty: |_, a| { arity("instant_utc", a, 1)?; want_text("instant_utc", &a[0])?; Ok(Ty::Instant) },
        run: |_, a| Ok(Value::Instant(crate::time::parse_instant_utc(&text(&a[0])?)?)),
    },
    Builtin {
        name: "local_date", category: "time", signature: "local_date(i, \"Zone/Name\") -> date", doc: "Calendar date of an instant in a time zone.",
        aliases: &["date in time zone"], example: "local_date(instant_utc(\"2026-11-07T23:30:00Z\"), \"Asia/Tokyo\")", float_only: false,
        ty: |_, a| { arity("local_date", a, 2)?; want_text("local_date", &a[1])?; if a[0] == Ty::Instant { Ok(Ty::Date) } else { type_err("local_date needs an instant") } },
        run: |_, a| match &a[0] { Value::Instant(s) => Ok(Value::Date(crate::time::local_date(s, &text(&a[1])?)?)), _ => type_err("local_date needs an instant") },
    },
    Builtin {
        name: "local_text", category: "time", signature: "local_text(i, \"Zone/Name\") -> text", doc: "RFC 3339 text of an instant in a time zone.",
        aliases: &["format time", "time in zone"], example: "local_text(instant_utc(\"2026-11-07T08:30:00Z\"), \"America/New_York\")", float_only: false,
        ty: |_, a| { arity("local_text", a, 2)?; want_text("local_text", &a[1])?; if a[0] == Ty::Instant { Ok(Ty::Text(None)) } else { type_err("local_text needs an instant") } },
        run: |_, a| match &a[0] { Value::Instant(s) => Ok(Value::Text(crate::time::local_text(s, &text(&a[1])?)?)), _ => type_err("local_text needs an instant") },
    },
    // Library.
    Builtin {
        name: "const", category: "library", signature: "const(\"id\") -> number or quantity", doc: "Named constant from the cited constants library, for example c, h, k_B, N_A, G or g_n.",
        aliases: &["physical constant", "constant"], example: "const(\"c\")", float_only: false,
        ty: |c, a| { arity("const", a, 1)?; let id = lit_text("const", &a[0])?; c.lib.constant(&id).map(|k| qty_ty(k.dim)).ok_or_else(|| UcmError::Unbound(format!("constant {id}"))) },
        run: |c, a| { let id = text(&a[0])?; c.library_used = true; let k = c.lib.constant(&id).ok_or_else(|| UcmError::Unbound(format!("constant {id}")))?; Ok(qty(k.value.clone(), k.dim)) },
    },
    // Higher order functions: typed by the checker and run by the evaluator.
    Builtin { name: "map", category: "vector", signature: "map(v, x => expr) -> vector", doc: "Apply an expression to every item.", aliases: &["transform each", "for each"], example: "map([1, 2, 3], x => x * x)", float_only: false, ty: catalog_only_ty, run: catalog_only_run },
    Builtin { name: "filter", category: "vector", signature: "filter(v, x => bool) -> vector", doc: "Items for which the condition holds.", aliases: &["select where", "keep if"], example: "filter([1, 2, 3, 4], x => mod(x, 2) == 0)", float_only: false, ty: catalog_only_ty, run: catalog_only_run },
    Builtin { name: "fold", category: "vector", signature: "fold(v, init, (acc, x) => expr) -> value", doc: "Reduce a vector left to right with an accumulator.", aliases: &["reduce", "accumulate", "running total"], example: "fold([1, 2, 3], 0, (acc, x) => acc + x)", float_only: false, ty: catalog_only_ty, run: catalog_only_run },
    Builtin { name: "any", category: "vector", signature: "any(v, x => bool) -> bool", doc: "Whether the condition holds for at least one item.", aliases: &["exists", "some"], example: "any([1, 2, 3], x => x > 2)", float_only: false, ty: catalog_only_ty, run: catalog_only_run },
    Builtin { name: "all", category: "vector", signature: "all(v, x => bool) -> bool", doc: "Whether the condition holds for every item.", aliases: &["every", "for all"], example: "all([1, 2, 3], x => x > 0)", float_only: false, ty: catalog_only_ty, run: catalog_only_run },
    Builtin { name: "count", category: "vector", signature: "count(v, x => bool) -> int", doc: "Number of items for which the condition holds.", aliases: &["count if", "how many"], example: "count([1, 2, 3, 4], x => x > 2)", float_only: false, ty: catalog_only_ty, run: catalog_only_run },
    Builtin { name: "formula", category: "library", signature: "formula(\"id\", args...) -> value", doc: "Run a reviewed formula from the cited formula library with positional arguments.", aliases: &["library formula", "standard formula"], example: "formula(\"finance.compound_amount\", money(\"1000\", \"EUR\"), 5/100, 10)", float_only: false, ty: catalog_only_ty, run: catalog_only_run },
];

fn min_max_ty(name: &str, a: &[Ty]) -> Result<Ty> {
    if a.len() == 1 {
        let e = elem(name, &a[0])?;
        if e == Ty::Empty {
            return type_err(format!("{name} of an empty vector"));
        }
        return Ok(e);
    }
    arity(name, a, 2)?;
    if let Some(t) = num_join(&a[0], &a[1]) {
        return Ok(t);
    }
    crate::ops::op_ty(crate::ast::Op::Lt, a, false, None)?;
    Ok(crate::check::join(&a[0], &a[1])?)
}

fn min_max(c: &mut Ctx, a: &[Value], want: Ordering) -> Result<Value> {
    let items: Vec<Value> = if a.len() == 1 { vecv(&a[0])?.clone() } else { a.to_vec() };
    let mut best = items.first().cloned().ok_or_else(|| UcmError::Domain("empty vector".into()))?;
    for v in &items[1..] {
        c.budget.step()?;
        if compare(v, &best)? == want {
            best = v.clone();
        }
    }
    // Two argument form returns the joined numeric type, like the static rule.
    if a.len() == 2 {
        if let (Some(t), Some(r)) = (num_join(&a[0].ty(), &a[1].ty()), best.as_rat()) {
            return Ok(match (t, &best) {
                (Ty::Rational, _) => Value::Rat(r),
                (Ty::Decimal, Value::Int(i)) => Value::Dec(Decimal::from_int(i)),
                _ => best,
            });
        }
    }
    Ok(best)
}

fn percentile(c: &mut Ctx, a: &[Value]) -> Result<Value> {
    let items = vecv(&a[0])?;
    if items.is_empty() {
        return domain_err("percentile of an empty vector");
    }
    c.budget.charge(items.len() as u64 * 8)?;
    let p = rat(&a[1])?;
    let hundred = Rat::from_integer(BigInt::from(100));
    if p.is_negative() || p > hundred {
        return domain_err("p must be between 0 and 100");
    }
    let mut rs = items.iter().map(rat).collect::<Result<Vec<_>>>()?;
    rs.sort();
    let n = rs.len();
    match text(&a[2])?.as_str() {
        "nearest_rank" => {
            // Rank ceil(p/100 * n), at least 1.
            let k = (p / hundred * Rat::from_integer(BigInt::from(n)))
                .ceil()
                .to_integer()
                .to_usize()
                .unwrap_or(1)
                .max(1);
            Ok(Value::Rat(rs[k.min(n) - 1].clone()))
        }
        "linear" => {
            let h = p / hundred * Rat::from_integer(BigInt::from(n - 1));
            let lo = h.floor().to_integer().to_usize().unwrap_or(0);
            let frac = &h - Rat::from_integer(BigInt::from(lo));
            let hi = (lo + 1).min(n - 1);
            Ok(Value::Rat(&rs[lo] + frac * (&rs[hi] - &rs[lo])))
        }
        other => domain_err(format!("unknown percentile method {other}")),
    }
}

fn allocate(c: &mut Ctx, a: &[Value]) -> Result<Value> {
    let (total, cur) = match &a[0] {
        Value::Money(r, c) => (r.clone(), c.clone()),
        _ => return type_err("allocate needs money"),
    };
    let scale = scale_arg(&a[2])?;
    let unit = Rat::new(BigInt::one(), crate::num::pow10(scale));
    let units = &total / &unit;
    if !units.is_integer() {
        return domain_err("the total does not fit the scale exactly; round it first");
    }
    let units = units.to_integer();
    let weights: Vec<Rat> = match &a[1] {
        Value::Int(n) => {
            let n = n.to_usize().ok_or_else(|| UcmError::Domain("part count out of range".into()))?;
            vec![Rat::one(); n]
        }
        Value::Vec(w) => w.iter().map(rat).collect::<Result<Vec<_>>>()?,
        _ => return type_err("allocate needs a part count or weights"),
    };
    if weights.is_empty() || weights.iter().any(|w| w.is_negative()) {
        return domain_err("allocate needs at least one non-negative weight");
    }
    c.budget.len(weights.len() as u64)?;
    c.budget.charge(weights.len() as u64 * 4)?;
    let wsum = weights.iter().fold(Rat::zero(), |s, w| s + w);
    if wsum.is_zero() {
        return domain_err("weights add up to zero");
    }
    let shares: Vec<Rat> = weights.iter().map(|w| Rat::from_integer(units.clone()) * w / &wsum).collect();
    let mut base: Vec<BigInt> = shares.iter().map(|s| round_rat_to_int(s, RoundMode::Floor)).collect();
    let assigned = base.iter().fold(BigInt::zero(), |s, b| s + b);
    let mut left = (&units - assigned).to_usize().unwrap_or(0);
    let mut order: Vec<usize> = (0..shares.len()).collect();
    order.sort_by(|&i, &j| {
        let ri = &shares[i] - Rat::from_integer(base[i].clone());
        let rj = &shares[j] - Rat::from_integer(base[j].clone());
        rj.cmp(&ri).then(i.cmp(&j))
    });
    for i in order {
        if left == 0 {
            break;
        }
        base[i] += 1;
        left -= 1;
    }
    Ok(Value::Vec(
        base.into_iter()
            .map(|b| Value::Money(Rat::from_integer(b) * &unit, cur.clone()))
            .collect(),
    ))
}

pub fn lookup(name: &str) -> Option<&'static Builtin> {
    BUILTINS.iter().find(|b| b.name == name)
}

/// Shorthand used by checks that only need to know a name is a builtin.
pub fn is_builtin(name: &str) -> bool {
    lookup(name).is_some()
}

pub fn round_mode_names() -> &'static [&'static str] {
    &RoundMode::NAMES
}

#[allow(dead_code)]
fn _time_dim() -> Dim {
    K_TIME
}
