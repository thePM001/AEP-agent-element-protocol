//! Text form parser for UCM-IR. The grammar is in spec/UCM-SPEC.md section 3.

use crate::ast::{Expr, InputDecl, Lit, Op, Program, MAX_DEPTH};
use crate::error::{Result, UcmError};
use crate::num::parse_decimal;
use num_bigint::BigInt;

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Num(String),
    Str(String),
    Ident(String),
    Sym(&'static str),
    Eof,
}

#[derive(Debug, Clone)]
struct Token {
    tok: Tok,
    start: usize,
    line: usize,
    col: usize,
}

/// Longest program text the parser accepts, in bytes.
pub const MAX_SOURCE: usize = 1 << 20;

const SYMS: [&str; 22] = [
    "=>", "==", "!=", "<=", ">=", "+", "-", "*", "/", "^", "(", ")", "[", "]", "{", "}", ",", ";",
    ":", "=", "<", ">",
];

fn lex(src: &str) -> Result<Vec<Token>> {
    let b = src.as_bytes();
    let mut i = 0usize;
    let mut line = 1usize;
    let mut col = 1usize;
    let mut out = Vec::new();
    let err = |line: usize, col: usize, msg: String| UcmError::Parse { line, col, msg };
    while i < b.len() {
        let c = b[i] as char;
        if c == '\n' {
            i += 1;
            line += 1;
            col = 1;
            continue;
        }
        if c.is_ascii_whitespace() {
            i += 1;
            col += 1;
            continue;
        }
        if c == '#' {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        let (sl, sc, start) = (line, col, i);
        if c.is_ascii_digit()
            || (c == '.' && i + 1 < b.len() && (b[i + 1] as char).is_ascii_digit())
        {
            while i < b.len() && ((b[i] as char).is_ascii_digit() || b[i] == b'.' || b[i] == b'_') {
                i += 1;
            }
            if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
                let save = i;
                i += 1;
                if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
                    i += 1;
                }
                if i < b.len() && (b[i] as char).is_ascii_digit() {
                    while i < b.len() && (b[i] as char).is_ascii_digit() {
                        i += 1;
                    }
                } else {
                    i = save;
                }
            }
            let text: String = src[start..i].chars().filter(|c| *c != '_').collect();
            col += i - start;
            out.push(Token {
                tok: Tok::Num(text),
                start,
                line: sl,
                col: sc,
            });
            continue;
        }
        if c == '"' {
            i += 1;
            let mut s = String::new();
            loop {
                if i >= b.len() {
                    return Err(err(sl, sc, "unterminated string".into()));
                }
                let ch = src[i..].chars().next().unwrap_or('"');
                if ch == '"' {
                    i += 1;
                    break;
                }
                if ch == '\n' {
                    return Err(err(sl, sc, "newline in string".into()));
                }
                if ch == '\\' {
                    let nx = src[i + 1..]
                        .chars()
                        .next()
                        .ok_or_else(|| err(sl, sc, "bad escape".into()))?;
                    match nx {
                        '"' => s.push('"'),
                        '\\' => s.push('\\'),
                        _ => return Err(err(sl, sc, "bad escape".into())),
                    }
                    i += 2;
                    continue;
                }
                s.push(ch);
                i += ch.len_utf8();
            }
            col += src[start..i].chars().count();
            out.push(Token {
                tok: Tok::Str(s),
                start,
                line: sl,
                col: sc,
            });
            continue;
        }
        if c.is_ascii_alphabetic() || c == '_' {
            while i < b.len()
                && ((b[i] as char).is_ascii_alphanumeric() || b[i] == b'_' || b[i] == b'.')
            {
                i += 1;
            }
            col += i - start;
            out.push(Token {
                tok: Tok::Ident(src[start..i].to_string()),
                start,
                line: sl,
                col: sc,
            });
            continue;
        }
        let rest = &src[i..];
        if let Some(sym) = SYMS.iter().find(|s| rest.starts_with(**s)) {
            i += sym.len();
            col += sym.len();
            out.push(Token {
                tok: Tok::Sym(sym),
                start,
                line: sl,
                col: sc,
            });
            continue;
        }
        return Err(err(sl, sc, format!("unexpected character {c:?}")));
    }
    out.push(Token {
        tok: Tok::Eof,
        start: b.len(),
        line,
        col,
    });
    Ok(out)
}

const KEYWORDS: [&str; 11] = [
    "input", "let", "if", "then", "else", "and", "or", "not", "true", "false", "float",
];

struct Parser<'a> {
    src: &'a str,
    toks: Vec<Token>,
    pos: usize,
    depth: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> &Tok {
        &self.toks[self.pos].tok
    }

    fn peek_at(&self, n: usize) -> &Tok {
        let i = (self.pos + n).min(self.toks.len() - 1);
        &self.toks[i].tok
    }

    fn here(&self) -> &Token {
        &self.toks[self.pos]
    }

    fn err<T>(&self, msg: impl Into<String>) -> Result<T> {
        let t = self.here();
        Err(UcmError::Parse {
            line: t.line,
            col: t.col,
            msg: msg.into(),
        })
    }

    fn bump(&mut self) -> Token {
        let t = self.toks[self.pos].clone();
        if self.pos < self.toks.len() - 1 {
            self.pos += 1;
        }
        t
    }

    fn is_sym(&self, s: &str) -> bool {
        matches!(self.peek(), Tok::Sym(x) if *x == s)
    }

    fn is_kw(&self, s: &str) -> bool {
        matches!(self.peek(), Tok::Ident(x) if x == s)
    }

    fn expect_sym(&mut self, s: &str) -> Result<()> {
        if self.is_sym(s) {
            self.bump();
            Ok(())
        } else {
            self.err(format!("expected {s}"))
        }
    }

    fn expect_kw(&mut self, s: &str) -> Result<()> {
        if self.is_kw(s) {
            self.bump();
            Ok(())
        } else {
            self.err(format!("expected {s}"))
        }
    }

    fn ident(&mut self) -> Result<String> {
        match self.peek().clone() {
            Tok::Ident(s) if !KEYWORDS.contains(&s.as_str()) => {
                if s.contains('.') {
                    return self.err(format!("name {s} may not contain a dot"));
                }
                self.bump();
                Ok(s)
            }
            _ => self.err("expected a name"),
        }
    }

    fn enter(&mut self) -> Result<()> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return self.err("program nesting too deep");
        }
        Ok(())
    }

    fn program(&mut self) -> Result<Program> {
        let mut inputs = Vec::new();
        let mut lets: Vec<(String, Expr)> = Vec::new();
        loop {
            if self.is_kw("input") {
                if !lets.is_empty() {
                    return self.err("input declarations come before let bindings");
                }
                self.bump();
                let name = self.ident()?;
                self.expect_sym(":")?;
                let start = self.here().start;
                while !self.is_sym(";") {
                    if matches!(self.peek(), Tok::Eof) {
                        return self.err("expected ; after input type");
                    }
                    self.bump();
                }
                let end = self.here().start;
                let ty: String = self.src[start..end]
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join("");
                if ty.is_empty() {
                    return self.err("missing input type");
                }
                self.bump();
                if inputs.iter().any(|i: &InputDecl| i.name == name) {
                    return self.err(format!("input {name} declared twice"));
                }
                inputs.push(InputDecl { name, ty });
                continue;
            }
            if self.is_kw("let") {
                self.bump();
                let name = self.ident()?;
                self.expect_sym("=")?;
                let v = self.expr()?;
                self.expect_sym(";")?;
                lets.push((name, v));
                continue;
            }
            break;
        }
        let mut body = self.expr()?;
        if self.is_sym(";") {
            self.bump();
        }
        if !matches!(self.peek(), Tok::Eof) {
            return self.err("unexpected text after the result expression");
        }
        while let Some((n, v)) = lets.pop() {
            body = Expr::Let(n, Box::new(v), Box::new(body));
        }
        Ok(Program { inputs, body })
    }

    fn expr(&mut self) -> Result<Expr> {
        self.enter()?;
        let e = if self.is_kw("if") {
            self.bump();
            let c = self.expr()?;
            self.expect_kw("then")?;
            let a = self.expr()?;
            self.expect_kw("else")?;
            let b = self.expr()?;
            Expr::If(Box::new(c), Box::new(a), Box::new(b))
        } else {
            self.or()?
        };
        self.depth -= 1;
        Ok(e)
    }

    fn or(&mut self) -> Result<Expr> {
        let mut l = self.and()?;
        while self.is_kw("or") {
            self.bump();
            let r = self.and()?;
            l = Expr::Op(Op::Or, vec![l, r]);
        }
        Ok(l)
    }

    fn and(&mut self) -> Result<Expr> {
        let mut l = self.not()?;
        while self.is_kw("and") {
            self.bump();
            let r = self.not()?;
            l = Expr::Op(Op::And, vec![l, r]);
        }
        Ok(l)
    }

    fn not(&mut self) -> Result<Expr> {
        if self.is_kw("not") {
            self.bump();
            self.enter()?;
            let e = self.not()?;
            self.depth -= 1;
            return Ok(Expr::Op(Op::Not, vec![e]));
        }
        self.cmp()
    }

    fn cmp(&mut self) -> Result<Expr> {
        let l = self.add()?;
        let op = match self.peek() {
            Tok::Sym("==") => Op::Eq,
            Tok::Sym("!=") => Op::Ne,
            Tok::Sym("<") => Op::Lt,
            Tok::Sym("<=") => Op::Le,
            Tok::Sym(">") => Op::Gt,
            Tok::Sym(">=") => Op::Ge,
            _ => return Ok(l),
        };
        self.bump();
        let r = self.add()?;
        if matches!(self.peek(), Tok::Sym("==" | "!=" | "<" | "<=" | ">" | ">=")) {
            return self.err("comparisons do not chain, use and");
        }
        Ok(Expr::Op(op, vec![l, r]))
    }

    fn add(&mut self) -> Result<Expr> {
        let mut l = self.mul()?;
        loop {
            let op = if self.is_sym("+") {
                Op::Add
            } else if self.is_sym("-") {
                Op::Sub
            } else {
                return Ok(l);
            };
            self.bump();
            let r = self.mul()?;
            l = Expr::Op(op, vec![l, r]);
        }
    }

    fn mul(&mut self) -> Result<Expr> {
        let mut l = self.unary()?;
        loop {
            let op = if self.is_sym("*") {
                Op::Mul
            } else if self.is_sym("/") {
                Op::Div
            } else {
                return Ok(l);
            };
            self.bump();
            let r = self.unary()?;
            l = Expr::Op(op, vec![l, r]);
        }
    }

    fn unary(&mut self) -> Result<Expr> {
        if self.is_sym("-") {
            self.bump();
            self.enter()?;
            let e = self.unary()?;
            self.depth -= 1;
            return Ok(match e {
                Expr::Lit(Lit::Int(i)) => Expr::Lit(Lit::Int(-i)),
                Expr::Lit(Lit::Dec(mut d)) => {
                    d.unscaled = -d.unscaled;
                    Expr::Lit(Lit::Dec(d))
                }
                other => Expr::Op(Op::Neg, vec![other]),
            });
        }
        self.pow()
    }

    fn pow(&mut self) -> Result<Expr> {
        let base = self.primary()?;
        if self.is_sym("^") {
            self.bump();
            self.enter()?;
            let e = self.unary()?;
            self.depth -= 1;
            return Ok(Expr::Op(Op::Pow, vec![base, e]));
        }
        Ok(base)
    }

    fn args(&mut self, close: &str) -> Result<Vec<Expr>> {
        let mut out = Vec::new();
        if self.is_sym(close) {
            self.bump();
            return Ok(out);
        }
        loop {
            out.push(self.arg()?);
            if self.is_sym(",") {
                self.bump();
                continue;
            }
            self.expect_sym(close)?;
            return Ok(out);
        }
    }

    fn arg(&mut self) -> Result<Expr> {
        // x => body
        if let (Tok::Ident(_), Tok::Sym("=>")) = (self.peek().clone(), self.peek_at(1).clone()) {
            let p = self.ident()?;
            self.bump();
            let body = self.expr()?;
            return Ok(Expr::Lambda(vec![p], Box::new(body)));
        }
        // (a, b) => body
        if self.is_sym("(") {
            let mut k = 1;
            let mut ok = true;
            loop {
                match self.peek_at(k) {
                    Tok::Ident(_) => {}
                    _ => {
                        ok = false;
                        break;
                    }
                }
                match self.peek_at(k + 1) {
                    Tok::Sym(",") => k += 2,
                    Tok::Sym(")") => {
                        k += 2;
                        break;
                    }
                    _ => {
                        ok = false;
                        break;
                    }
                }
            }
            if ok && matches!(self.peek_at(k), Tok::Sym("=>")) {
                self.bump();
                let mut ps = Vec::new();
                loop {
                    ps.push(self.ident()?);
                    if self.is_sym(",") {
                        self.bump();
                        continue;
                    }
                    self.expect_sym(")")?;
                    break;
                }
                self.expect_sym("=>")?;
                let body = self.expr()?;
                return Ok(Expr::Lambda(ps, Box::new(body)));
            }
        }
        self.expr()
    }

    fn primary(&mut self) -> Result<Expr> {
        match self.peek().clone() {
            Tok::Num(t) => {
                self.bump();
                if t.contains('.') || t.contains('e') || t.contains('E') {
                    let d = parse_decimal(&t).map_err(|e| UcmError::Parse {
                        line: 0,
                        col: 0,
                        msg: e.to_string(),
                    })?;
                    Ok(Expr::Lit(Lit::Dec(d)))
                } else {
                    let i: BigInt = t.parse().map_err(|_| UcmError::Parse {
                        line: 0,
                        col: 0,
                        msg: format!("bad number {t}"),
                    })?;
                    Ok(Expr::Lit(Lit::Int(i)))
                }
            }
            Tok::Str(s) => {
                self.bump();
                Ok(Expr::Lit(Lit::Text(s)))
            }
            Tok::Sym("(") => {
                self.bump();
                let e = self.expr()?;
                self.expect_sym(")")?;
                Ok(e)
            }
            Tok::Sym("[") => {
                self.bump();
                self.enter()?;
                let items = self.args("]")?;
                self.depth -= 1;
                Ok(Expr::Vec(items))
            }
            Tok::Ident(w) if w == "true" => {
                self.bump();
                Ok(Expr::Lit(Lit::Bool(true)))
            }
            Tok::Ident(w) if w == "false" => {
                self.bump();
                Ok(Expr::Lit(Lit::Bool(false)))
            }
            Tok::Ident(w) if w == "float" => {
                self.bump();
                self.expect_sym("{")?;
                let e = self.expr()?;
                self.expect_sym("}")?;
                Ok(Expr::Float(Box::new(e)))
            }
            Tok::Ident(w) if KEYWORDS.contains(&w.as_str()) => {
                self.err(format!("unexpected keyword {w}"))
            }
            Tok::Ident(w) => {
                self.bump();
                if self.is_sym("(") {
                    self.bump();
                    self.enter()?;
                    let args = self.args(")")?;
                    self.depth -= 1;
                    Ok(Expr::Call(w, args))
                } else {
                    if w.contains('.') {
                        return self.err(format!("name {w} may not contain a dot"));
                    }
                    Ok(Expr::Var(w))
                }
            }
            Tok::Eof => self.err("unexpected end of program"),
            Tok::Sym(s) => self.err(format!("unexpected {s}")),
        }
    }
}

/// Parse the UCM-IR text form.
pub fn parse_program(src: &str) -> Result<Program> {
    if src.len() > MAX_SOURCE {
        return Err(UcmError::Parse {
            line: 1,
            col: 1,
            msg: "program text too long".into(),
        });
    }
    let toks = lex(src)?;
    let mut p = Parser {
        src,
        toks,
        pos: 0,
        depth: 0,
    };
    p.program()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_round_trips() {
        let src = "input p: money[USD];\ninput r: rational;\nlet m = r / 12; # monthly\np * m / (1 - (1 + m) ^ -360)";
        let p = parse_program(src).expect("parse");
        assert_eq!(p.inputs.len(), 2);
        let again = parse_program(&p.to_text()).expect("reparse");
        assert_eq!(p, again);
        let j = p.to_json();
        assert_eq!(Program::from_json(&j).expect("json"), p);
    }

    #[test]
    fn lambdas_and_vectors() {
        let p = parse_program("fold([1, 2, 3], 0, (acc, x) => acc + x * x)").expect("parse");
        match p.body {
            Expr::Call(ref f, ref a) => {
                assert_eq!(f, "fold");
                assert!(matches!(a[2], Expr::Lambda(ref ps, _) if ps.len() == 2));
            }
            _ => panic!("expected call"),
        }
        assert!(parse_program("map(xs, x => x + 1)").is_ok());
    }

    #[test]
    fn scale_zero_decimal_round_trips() {
        // Found by the parse_text fuzz target: "2." printed as "2" and read back as an int.
        for src in ["1 +  2.", "2E3", "-5.", "(-0.)"] {
            let p = parse_program(src).expect("parse");
            let again = parse_program(&p.to_text()).expect("reparse");
            assert_eq!(p, again, "{src} printed as {}", p.to_text());
        }
    }

    #[test]
    fn errors_have_positions() {
        match parse_program("1 +\n* 2") {
            Err(UcmError::Parse { line, .. }) => assert_eq!(line, 2),
            other => panic!("expected parse error, got {other:?}"),
        }
        assert!(parse_program("1 < 2 < 3").is_err());
        assert!(parse_program(&"(".repeat(5000)).is_err());
    }
}
