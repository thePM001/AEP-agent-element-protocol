//! AEP Universal Computation Module core.
//!
//! UCM-IR programs are typed, total and exact. A program reads only its declared inputs,
//! touches no file, network or process and terminates inside its budget.
//! The normative text is AEP-Components/ucm/spec/UCM-SPEC.md.

#![forbid(unsafe_code)]

pub mod ast;
pub mod budget;
pub mod builtins;
pub mod canon;
pub mod check;
pub mod error;
pub mod interp;
pub mod library;
pub mod num;
pub mod ops;
pub mod parse;
pub mod time;
pub mod units;
pub mod value;

pub use ast::Program;
pub use budget::{Budget, Limits};
pub use error::{Result, UcmError};
pub use library::Library;
pub use value::{Ty, Value};

use serde_json::{json, Map, Value as J};

/// Engine identity that goes into receipts. A replay must use the same engine build.
pub const ENGINE_NAME: &str = "aep-ucm";
pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Bumped whenever an evaluation rule changes, so old receipts name the rules they used.
pub const RULES_VERSION: &str = "ucm-rules-1";

pub fn engine_build() -> String {
    format!("{ENGINE_NAME}/{ENGINE_VERSION}/{RULES_VERSION}/tzdb-{}", time::tzdb_version())
}

/// Parse a program from its text form or its JSON form.
pub fn load_program(text: Option<&str>, json_form: Option<&J>) -> Result<Program> {
    match (text, json_form) {
        (Some(t), None) => parse::parse_program(t),
        (None, Some(j)) => Program::from_json(j),
        _ => Err(UcmError::Form("give exactly one of program text or program JSON".into())),
    }
}

pub fn program_hash(p: &Program) -> Result<String> {
    canon::digest(&p.to_json())
}

/// Digest of the input object exactly as given (names and string values).
pub fn input_digest(inputs: &J) -> Result<String> {
    canon::digest(inputs)
}

#[derive(Debug, Clone)]
pub struct Outcome {
    pub result: Value,
    pub result_ty: Ty,
    pub float_used: bool,
    pub library_used: bool,
    pub budget_used: J,
    pub limits: Limits,
    pub calls: Vec<String>,
}

impl Outcome {
    pub fn result_json(&self) -> J {
        self.result.to_json()
    }
}

/// Typecheck and evaluate a program against JSON inputs.
pub fn evaluate(p: &Program, inputs: &J, limits: Limits, lib: &Library) -> Result<Outcome> {
    let (decls, result_ty) = check::check_program(p, lib, false)?;
    let empty = Map::new();
    let given = match inputs {
        J::Object(o) => o,
        J::Null => &empty,
        _ => return Err(UcmError::Input("inputs must be an object".into())),
    };
    for k in given.keys() {
        if !decls.iter().any(|(n, _)| n == k) {
            return Err(UcmError::Input(format!("input {k} is not declared")));
        }
    }
    let mut budget = Budget::new(limits);
    let mut ctx = builtins::Ctx {
        budget: &mut budget,
        lib,
        float_mode: false,
        float_used: false,
        library_used: false,
    };
    let mut ev = interp::Evaluator::new(&mut ctx);
    for (n, t) in &decls {
        let raw = given.get(n).ok_or_else(|| UcmError::Input(format!("input {n} is missing")))?;
        let v = value::parse_input(t, raw)?;
        ev.bind(n, v);
    }
    let v = ev.run_expr(&p.body)?;
    let v = interp::coerce(v, &result_ty)?;
    let (float_used, library_used) = (ctx.float_used, ctx.library_used);
    let mut calls = Vec::new();
    p.body.calls(&mut calls);
    Ok(Outcome {
        result: v,
        result_ty,
        float_used,
        library_used,
        budget_used: budget.used_json(),
        limits,
        calls,
    })
}

/// Check a program without running it. Returns the input and result types.
pub fn explain(p: &Program, lib: &Library) -> Result<J> {
    let (decls, result_ty) = check::check_program(p, lib, false)?;
    let mut calls = Vec::new();
    p.body.calls(&mut calls);
    let used: Vec<J> = calls
        .iter()
        .filter_map(|c| builtins::lookup(c))
        .map(|b| json!({ "name": b.name, "signature": b.signature, "description": b.doc }))
        .collect();
    Ok(json!({
        "program_hash": program_hash(p)?,
        "text": p.to_text(),
        "inputs": decls.iter().map(|(n, t)| json!({ "name": n, "type": t.name() })).collect::<Vec<_>>(),
        "result_type": result_ty.name(),
        "functions": used,
    }))
}

/// The catalog as one document (schema ucm-catalog-v1).
pub fn catalog_document(lib: &Library) -> J {
    json!({ "ucm": "ucm-catalog-v1", "engine_build": engine_build(), "library_digest": lib.digest, "entries": catalog(lib) })
}

/// Every catalog entry the System-1 lookup indexes: functions, units, constants and formulas.
pub fn catalog(lib: &Library) -> Vec<J> {
    let mut out = Vec::new();
    for b in builtins::BUILTINS {
        out.push(json!({
            "id": format!("fn.{}", b.name),
            "kind": "function",
            "name": b.name,
            "category": b.category,
            "signature": b.signature,
            "description": b.doc,
            "aliases": b.aliases,
            "example": b.example,
        }));
    }
    for (sym, name, dim, factor) in units::unit_catalog() {
        out.push(json!({
            "id": format!("unit.{sym}"),
            "kind": "unit",
            "name": sym,
            "category": "units",
            "signature": format!("q(value, \"{sym}\") or to(quantity, \"{sym}\")"),
            "description": format!("{name}, dimension {dim}, {factor} in SI base units"),
            "aliases": [name],
            "example": format!("to(q(1, \"{sym}\"), \"{}\")", if dim == "1" { "1".to_string() } else { dim.clone() }),
        }));
    }
    for c in &lib.constants {
        out.push(json!({
            "id": format!("const.{}", c.id),
            "kind": "constant",
            "name": c.id,
            "category": "constants",
            "signature": format!("const(\"{}\") -> {}", c.id, c.unit),
            "description": format!("{}: {} {}{}", c.name, c.value_text, c.unit, if c.exact { ", exact".to_string() } else { format!(", standard uncertainty {}", c.uncertainty.clone().unwrap_or_default()) }),
            "aliases": c.aliases,
            "example": format!("const(\"{}\")", c.id),
            "citation": c.citation,
            "library_digest": lib.digest,
        }));
    }
    for f in &lib.formulas {
        let args: Vec<String> = f.program.inputs.iter().map(|i| format!("{}: {}", i.name, i.ty)).collect();
        out.push(json!({
            "id": format!("formula.{}", f.id),
            "kind": "formula",
            "name": f.id,
            "category": "formulas",
            "signature": format!("formula(\"{}\", {}) -> {}", f.id, args.join(", "), f.result_ty.name()),
            "description": format!("{}. {}", f.name, f.description),
            "aliases": f.aliases,
            "example": f.program_text,
            "citation": f.citation,
            "library_digest": lib.digest,
        }));
    }
    out
}
