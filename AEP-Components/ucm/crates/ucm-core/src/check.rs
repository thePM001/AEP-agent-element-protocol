//! Static typechecker. A program that passes runs without a type error. Its result
//! has the static type the checker reports.

use crate::ast::{Expr, Lit, Op, Program};
use crate::builtins::{lookup, TyCtx, HIGHER_ORDER};
use crate::error::{type_err, Result, UcmError};
use crate::library::Library;
use crate::ops::{num_join, op_ty};
use crate::value::Ty;

/// Least type that holds both, used for if branches, vector items and fold accumulators.
pub fn join(a: &Ty, b: &Ty) -> Result<Ty> {
    if a == b {
        return Ok(a.clone());
    }
    match (a, b) {
        (Ty::Empty, x) | (x, Ty::Empty) => Ok(x.clone()),
        (Ty::Money(x), Ty::Money(y)) => match (x, y) {
            (Some(p), Some(q)) if p != q => type_err(format!("money in {p} and {q} do not mix")),
            (Some(p), _) | (_, Some(p)) => Ok(Ty::Money(Some(p.clone()))),
            _ => Ok(Ty::Money(None)),
        },
        (Ty::Text(_), Ty::Text(_)) => Ok(Ty::Text(None)),
        (Ty::Vector(x), Ty::Vector(y)) => Ok(Ty::Vector(Box::new(join(x, y)?))),
        _ => num_join(a, b).ok_or_else(|| UcmError::Type(format!("{} and {} do not join", a.name(), b.name()))),
    }
}

pub struct Checker<'a> {
    pub lib: &'a Library,
    pub float_mode: bool,
    pub scopes: Vec<(String, Ty)>,
    /// Library formulas may not call formula(), so no formula can reach itself.
    pub no_formula: bool,
}

impl<'a> Checker<'a> {
    pub fn new(lib: &'a Library) -> Self {
        Checker {
            lib,
            float_mode: false,
            scopes: Vec::new(),
            no_formula: false,
        }
    }

    fn var(&self, n: &str) -> Result<Ty> {
        self.scopes
            .iter()
            .rev()
            .find(|(k, _)| k == n)
            .map(|(_, t)| t.clone())
            .ok_or_else(|| UcmError::Unbound(n.to_string()))
    }

    fn bind(&mut self, n: &str, t: Ty) -> Result<()> {
        // Calls and names never collide: a call is always written name(...).
        self.scopes.push((n.to_string(), t));
        Ok(())
    }

    fn lambda<'e>(&self, e: &'e Expr, n: usize, f: &str) -> Result<(&'e [String], &'e Expr)> {
        match e {
            Expr::Lambda(ps, body) if ps.len() == n => Ok((ps, body)),
            _ => type_err(format!("{f} needs a lambda with {n} parameter(s)")),
        }
    }

    fn body_with(&mut self, ps: &[String], tys: &[Ty], body: &Expr) -> Result<Ty> {
        let saved_len = self.scopes.len();
        for (p, t) in ps.iter().zip(tys) {
            self.bind(p, t.clone())?;
        }
        let r = self.check(body);
        self.scopes.truncate(saved_len);
        r
    }

    fn higher_order(&mut self, f: &str, args: &[Expr]) -> Result<Ty> {
        let want = |n: usize| -> Result<()> {
            if args.len() == n {
                Ok(())
            } else {
                type_err(format!("{f} takes {n} arguments"))
            }
        };
        if f == "formula" {
            if self.no_formula {
                return type_err("a library formula cannot call formula()");
            }
            let id = match args.first() {
                Some(Expr::Lit(Lit::Text(s))) => s.clone(),
                _ => return type_err("formula needs a text literal id as its first argument"),
            };
            let fm = self.lib.formula(&id).ok_or_else(|| UcmError::Unbound(format!("formula {id}")))?;
            if args.len() != fm.input_types.len() + 1 {
                return type_err(format!("formula {id} takes {} arguments after the id", fm.input_types.len()));
            }
            for (i, (a, want_ty)) in args[1..].iter().zip(&fm.input_types).enumerate() {
                let t = self.check(a)?;
                let ok = t.conforms(want_ty) || (t.is_exact_num() && num_join(&t, want_ty).as_ref() == Some(want_ty));
                if !ok {
                    return type_err(format!(
                        "formula {id} argument {} needs {}, got {}",
                        i + 1,
                        want_ty.name(),
                        t.name()
                    ));
                }
            }
            return Ok(fm.result_ty.clone());
        }
        let v = self.check(args.first().ok_or_else(|| UcmError::Type(format!("{f} needs a vector")))?)?;
        let el = match &v {
            Ty::Vector(e) => (**e).clone(),
            t => return type_err(format!("{f} needs a vector, got {}", t.name())),
        };
        match f {
            "map" => {
                want(2)?;
                let (ps, body) = self.lambda(&args[1], 1, f)?;
                if el == Ty::Empty {
                    return Ok(Ty::Vector(Box::new(Ty::Empty)));
                }
                Ok(Ty::Vector(Box::new(self.body_with(ps, &[el], body)?)))
            }
            "filter" | "any" | "all" | "count" => {
                want(2)?;
                let (ps, body) = self.lambda(&args[1], 1, f)?;
                if el != Ty::Empty && self.body_with(ps, &[el], body)? != Ty::Bool {
                    return type_err(format!("{f} needs a condition that gives bool"));
                }
                Ok(match f {
                    "filter" => v,
                    "count" => Ty::Int,
                    _ => Ty::Bool,
                })
            }
            "fold" => {
                want(3)?;
                let init = self.check(&args[1])?;
                let (ps, body) = self.lambda(&args[2], 2, f)?;
                if el == Ty::Empty {
                    return Ok(init);
                }
                let b = self.body_with(ps, &[init.clone(), el.clone()], body)?;
                let acc = join(&init, &b)?;
                let b2 = self.body_with(ps, &[acc.clone(), el], body)?;
                if join(&acc, &b2)? != acc {
                    return type_err("fold accumulator type does not settle");
                }
                Ok(acc)
            }
            _ => type_err(format!("unknown function {f}")),
        }
    }

    pub fn check(&mut self, e: &Expr) -> Result<Ty> {
        match e {
            Expr::Lit(Lit::Int(_)) => Ok(Ty::Int),
            Expr::Lit(Lit::Dec(_)) => Ok(Ty::Decimal),
            Expr::Lit(Lit::Text(s)) => Ok(Ty::Text(Some(s.clone()))),
            Expr::Lit(Lit::Bool(_)) => Ok(Ty::Bool),
            Expr::Var(n) => self.var(n),
            Expr::Op(op, args) => {
                let tys = args.iter().map(|a| self.check(a)).collect::<Result<Vec<_>>>()?;
                let pow_lit = match (op, args.get(1)) {
                    (Op::Pow, Some(Expr::Lit(Lit::Int(i)))) => {
                        Some(num_traits::ToPrimitive::to_i64(i).ok_or_else(|| UcmError::Type("exponent literal out of range".into()))?)
                    }
                    _ => None,
                };
                op_ty(*op, &tys, self.float_mode, pow_lit)
            }
            Expr::Call(f, args) => {
                if HIGHER_ORDER.contains(&f.as_str()) {
                    return self.higher_order(f, args);
                }
                let b = lookup(f).ok_or_else(|| UcmError::UnknownFunction(f.clone()))?;
                if b.float_only && !self.float_mode {
                    return type_err(format!("{f} is a binary64 function, call it inside float {{ }}"));
                }
                let mut tys = Vec::with_capacity(args.len());
                for a in args {
                    if matches!(a, Expr::Lambda(..)) {
                        return type_err(format!("{f} does not take a lambda"));
                    }
                    tys.push(self.check(a)?);
                }
                (b.ty)(
                    &TyCtx {
                        float_mode: self.float_mode,
                        lib: self.lib,
                    },
                    &tys,
                )
            }
            Expr::If(c, a, b) => {
                if self.check(c)? != Ty::Bool {
                    return type_err("if needs a bool condition");
                }
                let (x, y) = (self.check(a)?, self.check(b)?);
                join(&x, &y)
            }
            Expr::Let(n, v, body) => {
                let t = self.check(v)?;
                let saved_len = self.scopes.len();
                self.bind(n, t)?;
                let r = self.check(body);
                self.scopes.truncate(saved_len);
                r
            }
            Expr::Lambda(..) => type_err("a lambda is only allowed as an argument of map, filter, fold, any, all or count"),
            Expr::Vec(items) => {
                let mut t = Ty::Empty;
                for i in items {
                    if matches!(i, Expr::Lambda(..)) {
                        return type_err("a vector cannot hold a lambda");
                    }
                    t = join(&t, &self.check(i)?)?;
                }
                Ok(Ty::Vector(Box::new(t)))
            }
            Expr::Float(inner) => {
                let saved = self.float_mode;
                self.float_mode = true;
                let t = self.check(inner);
                self.float_mode = saved;
                match t? {
                    t if t.is_exact_num() || t == Ty::Float => Ok(Ty::Float),
                    Ty::Bool => Ok(Ty::Bool),
                    other => type_err(format!("a float block gives a number or bool, got {}", other.name())),
                }
            }
        }
    }
}

/// Check a whole program. Returns the input types and the result type.
pub fn check_program(p: &Program, lib: &Library, no_formula: bool) -> Result<(Vec<(String, Ty)>, Ty)> {
    let mut c = Checker::new(lib);
    c.no_formula = no_formula;
    let mut inputs = Vec::new();
    for i in &p.inputs {
        let t = Ty::parse(&i.ty)?;
        c.bind(&i.name, t.clone())?;
        inputs.push((i.name.clone(), t));
    }
    let t = c.check(&p.body)?;
    if t == Ty::Lambda {
        return type_err("a program cannot return a lambda");
    }
    Ok((inputs, t))
}
