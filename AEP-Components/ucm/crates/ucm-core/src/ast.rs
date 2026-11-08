//! UCM-IR abstract syntax and its JSON form (schema ucm-program-v1).

use crate::error::{Result, UcmError};
use crate::num::{parse_decimal, Decimal};
use num_bigint::BigInt;
use serde_json::{json, Map, Value as J};

#[derive(Debug, Clone, PartialEq)]
pub enum Lit {
    Int(BigInt),
    Dec(Decimal),
    Text(String),
    Bool(bool),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    Add,
    Sub,
    Mul,
    Div,
    Pow,
    Neg,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    And,
    Or,
    Not,
}

impl Op {
    pub fn symbol(self) -> &'static str {
        match self {
            Op::Add => "+",
            Op::Sub => "-",
            Op::Mul => "*",
            Op::Div => "/",
            Op::Pow => "^",
            Op::Neg => "neg",
            Op::Eq => "==",
            Op::Ne => "!=",
            Op::Lt => "<",
            Op::Le => "<=",
            Op::Gt => ">",
            Op::Ge => ">=",
            Op::And => "and",
            Op::Or => "or",
            Op::Not => "not",
        }
    }

    pub fn from_symbol(s: &str) -> Option<Op> {
        Some(match s {
            "+" => Op::Add,
            "-" => Op::Sub,
            "*" => Op::Mul,
            "/" => Op::Div,
            "^" => Op::Pow,
            "neg" => Op::Neg,
            "==" => Op::Eq,
            "!=" => Op::Ne,
            "<" => Op::Lt,
            "<=" => Op::Le,
            ">" => Op::Gt,
            ">=" => Op::Ge,
            "and" => Op::And,
            "or" => Op::Or,
            "not" => Op::Not,
            _ => return None,
        })
    }

    pub fn arity(self) -> usize {
        match self {
            Op::Neg | Op::Not => 1,
            _ => 2,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    Lit(Lit),
    Var(String),
    Op(Op, Vec<Expr>),
    Call(String, Vec<Expr>),
    If(Box<Expr>, Box<Expr>, Box<Expr>),
    Let(String, Box<Expr>, Box<Expr>),
    Lambda(Vec<String>, Box<Expr>),
    Vec(Vec<Expr>),
    Float(Box<Expr>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct InputDecl {
    pub name: String,
    pub ty: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Program {
    pub inputs: Vec<InputDecl>,
    pub body: Expr,
}

pub const PROGRAM_SCHEMA: &str = "ucm-program-v1";

/// Deepest expression nesting the parser and the JSON decoder accept. Bounds stack use on
/// hostile input; evaluation of an accepted program fits a 2 MiB thread stack.
pub const MAX_DEPTH: usize = 64;

impl Expr {
    pub fn to_json(&self) -> J {
        match self {
            Expr::Lit(Lit::Int(i)) => json!({ "int": i.to_string() }),
            Expr::Lit(Lit::Dec(d)) => json!({ "dec": d.render() }),
            Expr::Lit(Lit::Text(t)) => json!({ "text": t }),
            Expr::Lit(Lit::Bool(b)) => json!({ "bool": if *b { "true" } else { "false" } }),
            Expr::Var(v) => json!({ "var": v }),
            Expr::Op(op, args) => json!({ "op": op.symbol(), "args": args.iter().map(|a| a.to_json()).collect::<Vec<_>>() }),
            Expr::Call(f, args) => json!({ "call": f, "args": args.iter().map(|a| a.to_json()).collect::<Vec<_>>() }),
            Expr::If(c, a, b) => json!({ "if": [c.to_json(), a.to_json(), b.to_json()] }),
            Expr::Let(n, v, body) => json!({ "let": n, "value": v.to_json(), "in": body.to_json() }),
            Expr::Lambda(ps, body) => json!({ "lambda": ps, "body": body.to_json() }),
            Expr::Vec(items) => json!({ "vec": items.iter().map(|a| a.to_json()).collect::<Vec<_>>() }),
            Expr::Float(e) => json!({ "float": e.to_json() }),
        }
    }

    pub fn from_json(v: &J) -> Result<Expr> {
        Self::from_json_depth(v, 0)
    }

    fn from_json_depth(v: &J, depth: usize) -> Result<Expr> {
        if depth > MAX_DEPTH {
            return Err(UcmError::Form("program nesting too deep".into()));
        }
        let o = v.as_object().ok_or_else(|| UcmError::Form("expression must be an object".into()))?;
        let s = |k: &str| -> Result<String> {
            o.get(k)
                .and_then(|x| x.as_str())
                .map(|x| x.to_string())
                .ok_or_else(|| UcmError::Form(format!("field {k} must be a string")))
        };
        let list = |k: &str| -> Result<Vec<Expr>> {
            o.get(k)
                .and_then(|x| x.as_array())
                .ok_or_else(|| UcmError::Form(format!("field {k} must be an array")))?
                .iter()
                .map(|x| Self::from_json_depth(x, depth + 1))
                .collect()
        };
        let sub = |k: &str| -> Result<Expr> {
            Self::from_json_depth(o.get(k).ok_or_else(|| UcmError::Form(format!("missing field {k}")))?, depth + 1)
        };
        let only = |keys: &[&str]| -> Result<()> {
            if o.keys().all(|k| keys.contains(&k.as_str())) {
                Ok(())
            } else {
                Err(UcmError::Form(format!("unexpected fields, allowed: {}", keys.join(", "))))
            }
        };
        if o.contains_key("int") {
            only(&["int"])?;
            let t = s("int")?;
            let i: BigInt = t.parse().map_err(|_| UcmError::Form(format!("bad int {t}")))?;
            return Ok(Expr::Lit(Lit::Int(i)));
        }
        if o.contains_key("dec") {
            only(&["dec"])?;
            return Ok(Expr::Lit(Lit::Dec(
                parse_decimal(&s("dec")?).map_err(|e| UcmError::Form(e.to_string()))?,
            )));
        }
        if o.contains_key("text") {
            only(&["text"])?;
            return Ok(Expr::Lit(Lit::Text(s("text")?)));
        }
        if o.contains_key("bool") {
            only(&["bool"])?;
            return match s("bool")?.as_str() {
                "true" => Ok(Expr::Lit(Lit::Bool(true))),
                "false" => Ok(Expr::Lit(Lit::Bool(false))),
                other => Err(UcmError::Form(format!("bad bool {other}"))),
            };
        }
        if o.contains_key("var") {
            only(&["var"])?;
            return Ok(Expr::Var(s("var")?));
        }
        if o.contains_key("op") {
            only(&["op", "args"])?;
            let sym = s("op")?;
            let op = Op::from_symbol(&sym).ok_or_else(|| UcmError::Form(format!("unknown op {sym}")))?;
            let args = list("args")?;
            if args.len() != op.arity() {
                return Err(UcmError::Form(format!("op {sym} takes {} arguments", op.arity())));
            }
            return Ok(Expr::Op(op, args));
        }
        if o.contains_key("call") {
            only(&["call", "args"])?;
            return Ok(Expr::Call(s("call")?, list("args")?));
        }
        if o.contains_key("if") {
            only(&["if"])?;
            let mut parts = list("if")?;
            if parts.len() != 3 {
                return Err(UcmError::Form("if takes three parts".into()));
            }
            let b = parts.pop().map(Box::new);
            let a = parts.pop().map(Box::new);
            let c = parts.pop().map(Box::new);
            return match (c, a, b) {
                (Some(c), Some(a), Some(b)) => Ok(Expr::If(c, a, b)),
                _ => Err(UcmError::Form("if takes three parts".into())),
            };
        }
        if o.contains_key("let") {
            only(&["let", "value", "in"])?;
            return Ok(Expr::Let(s("let")?, Box::new(sub("value")?), Box::new(sub("in")?)));
        }
        if o.contains_key("lambda") {
            only(&["lambda", "body"])?;
            let ps = o
                .get("lambda")
                .and_then(|x| x.as_array())
                .ok_or_else(|| UcmError::Form("lambda params must be an array".into()))?
                .iter()
                .map(|p| {
                    p.as_str()
                        .map(|x| x.to_string())
                        .ok_or_else(|| UcmError::Form("lambda param must be a string".into()))
                })
                .collect::<Result<Vec<_>>>()?;
            return Ok(Expr::Lambda(ps, Box::new(sub("body")?)));
        }
        if o.contains_key("vec") {
            only(&["vec"])?;
            return Ok(Expr::Vec(list("vec")?));
        }
        if o.contains_key("float") {
            only(&["float"])?;
            return Ok(Expr::Float(Box::new(sub("float")?)));
        }
        Err(UcmError::Form("unknown expression kind".into()))
    }

    /// Readable text form. It parses back to the same tree and adds parentheses only where the
    /// grammar needs them, so the printed program nests no deeper than the parsed one.
    pub fn to_text(&self) -> String {
        self.text_at(0)
    }

    /// Binding strength in the grammar of spec section 3, weakest first: `if` 0, `or` 1,
    /// `and` 2, `not` 3, comparison 4, sum 5, product 6, unary minus 7, power 8 and primary 9.
    fn prec(&self) -> u8 {
        match self {
            Expr::If(..) | Expr::Let(..) | Expr::Lambda(..) => 0,
            Expr::Op(op, _) => match op {
                Op::Or => 1,
                Op::And => 2,
                Op::Not => 3,
                Op::Eq | Op::Ne | Op::Lt | Op::Le | Op::Gt | Op::Ge => 4,
                Op::Add | Op::Sub => 5,
                Op::Mul | Op::Div => 6,
                Op::Neg => 7,
                Op::Pow => 8,
            },
            // A negative literal reads as a unary minus on a number.
            Expr::Lit(Lit::Int(i)) if i.sign() == num_bigint::Sign::Minus => 7,
            Expr::Lit(Lit::Dec(d)) if d.unscaled.sign() == num_bigint::Sign::Minus => 7,
            _ => 9,
        }
    }

    /// Print in a context that needs binding strength `ctx` or more.
    fn text_at(&self, ctx: u8) -> String {
        let t = self.text_bare();
        if self.prec() < ctx {
            format!("({t})")
        } else {
            t
        }
    }

    fn text_bare(&self) -> String {
        let bin = |a: &[Expr], sym: &str, l: u8, r: u8| format!("{} {} {}", a[0].text_at(l), sym, a[1].text_at(r));
        match self {
            Expr::Lit(Lit::Int(i)) => i.to_string(),
            Expr::Lit(Lit::Dec(d)) => {
                let mut r = d.render();
                // A decimal of scale 0 keeps its point, so it reads back as a decimal, not an int.
                if d.scale == 0 {
                    r.push('.');
                }
                r
            }
            Expr::Lit(Lit::Text(t)) => format!("\"{}\"", t.replace('\\', "\\\\").replace('"', "\\\"")),
            Expr::Lit(Lit::Bool(b)) => b.to_string(),
            Expr::Var(v) => v.clone(),
            Expr::Op(Op::Neg, a) => format!("-{}", a[0].text_at(7)),
            Expr::Op(Op::Not, a) => format!("not {}", a[0].text_at(3)),
            Expr::Op(op @ (Op::Or | Op::And), a) => {
                let p = if *op == Op::Or { 1 } else { 2 };
                bin(a, op.symbol(), p, p + 1)
            }
            Expr::Op(op @ (Op::Eq | Op::Ne | Op::Lt | Op::Le | Op::Gt | Op::Ge), a) => bin(a, op.symbol(), 5, 5),
            Expr::Op(op @ (Op::Add | Op::Sub), a) => bin(a, op.symbol(), 5, 6),
            Expr::Op(op @ (Op::Mul | Op::Div), a) => bin(a, op.symbol(), 6, 7),
            Expr::Op(Op::Pow, a) => bin(a, "^", 9, 7),
            Expr::Call(f, args) => format!("{}({})", f, args.iter().map(|a| a.text_at(0)).collect::<Vec<_>>().join(", ")),
            Expr::If(c, a, b) => format!("if {} then {} else {}", c.text_at(0), a.text_at(0), b.text_at(0)),
            Expr::Let(n, v, body) => format!("let {} = {};\n{}", n, v.text_at(0), body.text_at(0)),
            Expr::Lambda(ps, body) => {
                if ps.len() == 1 {
                    format!("{} => {}", ps[0], body.text_at(0))
                } else {
                    format!("({}) => {}", ps.join(", "), body.text_at(0))
                }
            }
            Expr::Vec(items) => format!("[{}]", items.iter().map(|a| a.text_at(0)).collect::<Vec<_>>().join(", ")),
            Expr::Float(e) => format!("float {{ {} }}", e.text_at(0)),
        }
    }

    /// Every function name the expression calls, for the explain view and library digests.
    pub fn calls(&self, out: &mut Vec<String>) {
        match self {
            Expr::Call(f, args) => {
                if !out.contains(f) {
                    out.push(f.clone());
                }
                args.iter().for_each(|a| a.calls(out));
            }
            Expr::Op(_, a) | Expr::Vec(a) => a.iter().for_each(|x| x.calls(out)),
            Expr::If(c, a, b) => {
                c.calls(out);
                a.calls(out);
                b.calls(out);
            }
            Expr::Let(_, v, b) => {
                v.calls(out);
                b.calls(out);
            }
            Expr::Lambda(_, b) | Expr::Float(b) => b.calls(out),
            Expr::Lit(_) | Expr::Var(_) => {}
        }
    }
}

impl Program {
    pub fn to_json(&self) -> J {
        let inputs: Vec<J> = self.inputs.iter().map(|i| json!({ "name": i.name, "type": i.ty })).collect();
        let mut m = Map::new();
        m.insert("ucm".into(), J::String(PROGRAM_SCHEMA.into()));
        m.insert("inputs".into(), J::Array(inputs));
        m.insert("body".into(), self.body.to_json());
        J::Object(m)
    }

    pub fn from_json(v: &J) -> Result<Program> {
        let o = v.as_object().ok_or_else(|| UcmError::Form("program must be an object".into()))?;
        if o.get("ucm").and_then(|x| x.as_str()) != Some(PROGRAM_SCHEMA) {
            return Err(UcmError::Form(format!("field ucm must be {PROGRAM_SCHEMA}")));
        }
        if o.keys().any(|k| !["ucm", "inputs", "body"].contains(&k.as_str())) {
            return Err(UcmError::Form("unexpected program field".into()));
        }
        let mut inputs = Vec::new();
        if let Some(arr) = o.get("inputs") {
            for i in arr.as_array().ok_or_else(|| UcmError::Form("inputs must be an array".into()))? {
                let name = i
                    .get("name")
                    .and_then(|x| x.as_str())
                    .ok_or_else(|| UcmError::Form("input name".into()))?;
                let ty = i
                    .get("type")
                    .and_then(|x| x.as_str())
                    .ok_or_else(|| UcmError::Form("input type".into()))?;
                inputs.push(InputDecl {
                    name: name.into(),
                    ty: ty.into(),
                });
            }
        }
        let body = Expr::from_json(o.get("body").ok_or_else(|| UcmError::Form("missing body".into()))?)?;
        Ok(Program { inputs, body })
    }

    pub fn to_text(&self) -> String {
        let mut s = String::new();
        for i in &self.inputs {
            s.push_str(&format!("input {}: {};\n", i.name, i.ty));
        }
        s.push_str(&self.body.to_text());
        s.push('\n');
        s
    }
}
