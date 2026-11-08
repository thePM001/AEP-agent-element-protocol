//! Exact evaluator. Runs only checked programs, under a budget, with no IO.

use crate::ast::{Expr, Lit, Op};
use crate::builtins::{lookup, Ctx};
use crate::error::{type_err, Result, UcmError};
use crate::num::{rat_to_f64, Decimal};
use crate::ops::apply;
use crate::value::{Ty, Value};

pub struct Evaluator<'a, 'b> {
    pub ctx: &'b mut Ctx<'a>,
    scopes: Vec<(String, Value)>,
}

/// Bring a value to its static type: int to rational or decimal, decimal to rational,
/// recursively through vectors. Any other difference is an engine fault.
pub fn coerce(v: Value, t: &Ty) -> Result<Value> {
    Ok(match (v, t) {
        (Value::Int(i), Ty::Rational) => Value::Rat(crate::num::Rat::from_integer(i)),
        (Value::Int(i), Ty::Decimal) => Value::Dec(Decimal::from_int(&i)),
        (Value::Dec(d), Ty::Rational) => Value::Rat(d.to_rat()),
        (Value::Vec(items), Ty::Vector(el)) => Value::Vec(items.into_iter().map(|x| coerce(x, el)).collect::<Result<Vec<_>>>()?),
        (v, t) => {
            if v.ty().conforms(t) || *t == Ty::Empty {
                v
            } else {
                return type_err(format!(
                    "engine fault: value of type {} where {} was checked",
                    v.ty().name(),
                    t.name()
                ));
            }
        }
    })
}

impl<'a, 'b> Evaluator<'a, 'b> {
    pub fn new(ctx: &'b mut Ctx<'a>) -> Self {
        Evaluator { ctx, scopes: Vec::new() }
    }

    pub fn bind(&mut self, n: &str, v: Value) {
        self.scopes.push((n.to_string(), v));
    }

    fn var(&self, n: &str) -> Result<Value> {
        self.scopes
            .iter()
            .rev()
            .find(|(k, _)| k == n)
            .map(|(_, v)| v.clone())
            .ok_or_else(|| UcmError::Unbound(n.to_string()))
    }

    fn charge(&mut self, v: &Value) -> Result<()> {
        self.ctx.budget.bits(v.bits())?;
        if let Value::Vec(items) = v {
            self.ctx.budget.len(items.len() as u64)?;
        }
        Ok(())
    }

    fn items(&mut self, e: &Expr) -> Result<Vec<Value>> {
        match self.run_expr(e)? {
            Value::Vec(v) => Ok(v),
            _ => type_err("expected a vector"),
        }
    }

    fn apply_lambda(&mut self, ps: &[String], vals: Vec<Value>, body: &Expr) -> Result<Value> {
        let saved_len = self.scopes.len();
        for (p, v) in ps.iter().zip(vals) {
            self.bind(p, v);
        }
        let r = self.run_expr(body);
        self.scopes.truncate(saved_len);
        r
    }

    fn lambda_parts<'e>(e: &'e Expr) -> Result<(&'e [String], &'e Expr)> {
        match e {
            Expr::Lambda(ps, body) => Ok((ps, body)),
            _ => type_err("expected a lambda"),
        }
    }

    fn truth(v: Value) -> Result<bool> {
        match v {
            Value::Bool(b) => Ok(b),
            _ => type_err("expected bool"),
        }
    }

    fn higher_order(&mut self, f: &str, args: &[Expr]) -> Result<Value> {
        if f == "formula" {
            return self.formula(args);
        }
        let items = self.items(&args[0])?;
        match f {
            "map" => {
                let (ps, body) = Self::lambda_parts(&args[1])?;
                let mut out = Vec::with_capacity(items.len());
                for x in items {
                    self.ctx.budget.step()?;
                    out.push(self.apply_lambda(ps, vec![x], body)?);
                }
                Ok(Value::Vec(out))
            }
            "filter" => {
                let (ps, body) = Self::lambda_parts(&args[1])?;
                let mut out = Vec::new();
                for x in items {
                    self.ctx.budget.step()?;
                    if Self::truth(self.apply_lambda(ps, vec![x.clone()], body)?)? {
                        out.push(x);
                    }
                }
                Ok(Value::Vec(out))
            }
            "any" | "all" | "count" => {
                let (ps, body) = Self::lambda_parts(&args[1])?;
                let mut n = 0usize;
                for x in items {
                    self.ctx.budget.step()?;
                    let t = Self::truth(self.apply_lambda(ps, vec![x], body)?)?;
                    match (f, t) {
                        ("any", true) => return Ok(Value::Bool(true)),
                        ("all", false) => return Ok(Value::Bool(false)),
                        (_, true) => n += 1,
                        _ => {}
                    }
                }
                Ok(match f {
                    "any" => Value::Bool(false),
                    "all" => Value::Bool(true),
                    _ => Value::Int(n.into()),
                })
            }
            "fold" => {
                let mut acc = self.run_expr(&args[1])?;
                let (ps, body) = Self::lambda_parts(&args[2])?;
                for x in items {
                    self.ctx.budget.step()?;
                    acc = self.apply_lambda(ps, vec![acc, x], body)?;
                    self.charge(&acc)?;
                }
                Ok(acc)
            }
            _ => Err(UcmError::UnknownFunction(f.to_string())),
        }
    }

    fn formula(&mut self, args: &[Expr]) -> Result<Value> {
        let id = match args.first() {
            Some(Expr::Lit(Lit::Text(s))) => s.clone(),
            _ => return type_err("formula needs a text literal id"),
        };
        let lib = self.ctx.lib;
        let fm = lib.formula(&id).ok_or_else(|| UcmError::Unbound(format!("formula {id}")))?;
        let mut vals = Vec::new();
        for (a, t) in args[1..].iter().zip(&fm.input_types) {
            let v = self.run_expr(a)?;
            vals.push(coerce(v, t)?);
        }
        self.ctx.library_used = true;
        let saved_scopes = std::mem::take(&mut self.scopes);
        let saved_float = self.ctx.float_mode;
        self.ctx.float_mode = false;
        for (decl, v) in fm.program.inputs.iter().zip(vals) {
            self.bind(&decl.name, v);
        }
        let r = self.run_expr(&fm.program.body);
        self.scopes = saved_scopes;
        self.ctx.float_mode = saved_float;
        coerce(r?, &fm.result_ty)
    }

    pub fn run_expr(&mut self, e: &Expr) -> Result<Value> {
        self.ctx.budget.step()?;
        let v = match e {
            Expr::Lit(Lit::Int(i)) => Value::Int(i.clone()),
            Expr::Lit(Lit::Dec(d)) => Value::Dec(d.clone()),
            Expr::Lit(Lit::Text(s)) => Value::Text(s.clone()),
            Expr::Lit(Lit::Bool(b)) => Value::Bool(*b),
            Expr::Var(n) => return self.var(n),
            Expr::Op(Op::And, a) => {
                if !Self::truth(self.run_expr(&a[0])?)? {
                    return Ok(Value::Bool(false));
                }
                Value::Bool(Self::truth(self.run_expr(&a[1])?)?)
            }
            Expr::Op(Op::Or, a) => {
                if Self::truth(self.run_expr(&a[0])?)? {
                    return Ok(Value::Bool(true));
                }
                Value::Bool(Self::truth(self.run_expr(&a[1])?)?)
            }
            Expr::Op(op, a) => {
                let vals = a.iter().map(|x| self.run_expr(x)).collect::<Result<Vec<_>>>()?;
                let lit_nonneg = matches!((op, a.get(1)), (Op::Pow, Some(Expr::Lit(Lit::Int(i)))) if i.sign() != num_bigint::Sign::Minus);
                if *op == Op::Pow {
                    // Bound the result size before computing: bits(base) * |exp| must fit.
                    if let (Some(b), Value::Int(n)) = (vals.first().map(|v| v.bits()), &vals[1]) {
                        let n = num_traits::ToPrimitive::to_u64(&num_traits::Signed::abs(n)).unwrap_or(u64::MAX);
                        if b.saturating_mul(n) > self.ctx.budget.limits.bits {
                            return Err(UcmError::BudgetExceeded {
                                what: format!("number size above {} bits", self.ctx.budget.limits.bits),
                            });
                        }
                    }
                }
                apply(*op, &vals, self.ctx.float_mode, lit_nonneg, self.ctx.budget.max_exponent())?
            }
            Expr::Call(f, args) => {
                if crate::builtins::HIGHER_ORDER.contains(&f.as_str()) {
                    self.higher_order(f, args)?
                } else {
                    let b = lookup(f).ok_or_else(|| UcmError::UnknownFunction(f.clone()))?;
                    let vals = args.iter().map(|x| self.run_expr(x)).collect::<Result<Vec<_>>>()?;
                    (b.run)(self.ctx, &vals)?
                }
            }
            Expr::If(c, a, b) => {
                if Self::truth(self.run_expr(c)?)? {
                    self.run_expr(a)?
                } else {
                    self.run_expr(b)?
                }
            }
            Expr::Let(n, v, body) => {
                let x = self.run_expr(v)?;
                let saved_len = self.scopes.len();
                self.bind(n, x);
                let r = self.run_expr(body);
                self.scopes.truncate(saved_len);
                r?
            }
            Expr::Lambda(..) => return type_err("lambda outside a higher order call"),
            Expr::Vec(items) => {
                self.ctx.budget.len(items.len() as u64)?;
                Value::Vec(items.iter().map(|x| self.run_expr(x)).collect::<Result<Vec<_>>>()?)
            }
            Expr::Float(inner) => {
                self.ctx.float_used = true;
                let saved = self.ctx.float_mode;
                self.ctx.float_mode = true;
                let r = self.run_expr(inner);
                self.ctx.float_mode = saved;
                match r? {
                    Value::Bool(b) => Value::Bool(b),
                    Value::Float(x) => Value::Float(x),
                    other => match other.as_rat() {
                        Some(q) => Value::Float(rat_to_f64(&q)),
                        None => return type_err("a float block gives a number or bool"),
                    },
                }
            }
        };
        self.charge(&v)?;
        Ok(v)
    }
}
