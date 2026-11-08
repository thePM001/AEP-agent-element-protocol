//! The formula and constants library. It is JSON (schema ucm-library-v1), content addressed,
//! and its digest goes into every receipt whose program reads it.

use crate::ast::Program;
use crate::check::check_program;
use crate::error::{Result, UcmError};
use crate::num::{parse_rat, Rat};
use crate::units::{parse_unit, Dim};
use crate::value::Ty;
use serde_json::Value as J;

pub const LIBRARY_SCHEMA: &str = "ucm-library-v1";
pub const BUILTIN_LIBRARY: &str = include_str!("../../../library/ucm-library-v1.json");

#[derive(Debug, Clone)]
pub struct Constant {
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub value: Rat,
    pub value_text: String,
    pub unit: String,
    pub dim: Dim,
    pub exact: bool,
    pub uncertainty: Option<String>,
    pub citation: String,
}

#[derive(Debug, Clone)]
pub struct Formula {
    pub id: String,
    pub name: String,
    pub aliases: Vec<String>,
    pub description: String,
    pub citation: String,
    pub program_text: String,
    pub program: Program,
    pub input_types: Vec<Ty>,
    pub result_ty: Ty,
    pub vectors: Vec<J>,
}

#[derive(Debug, Clone)]
pub struct Library {
    pub version: String,
    pub digest: String,
    pub constants: Vec<Constant>,
    pub formulas: Vec<Formula>,
}

fn s(o: &J, k: &str) -> Result<String> {
    o.get(k)
        .and_then(|x| x.as_str())
        .map(|x| x.to_string())
        .ok_or_else(|| UcmError::Form(format!("library field {k} must be a string")))
}

fn list(o: &J, k: &str) -> Vec<String> {
    o.get(k)
        .and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(|y| y.to_string())).collect())
        .unwrap_or_default()
}

impl Library {
    pub fn empty() -> Library {
        Library {
            version: "empty".into(),
            digest: String::new(),
            constants: Vec::new(),
            formulas: Vec::new(),
        }
    }

    pub fn builtin() -> Result<Library> {
        Library::from_json_text(BUILTIN_LIBRARY)
    }

    pub fn from_json_text(text: &str) -> Result<Library> {
        let v: J = serde_json::from_str(text).map_err(|e| UcmError::Form(format!("library is not JSON: {e}")))?;
        if v.get("ucm").and_then(|x| x.as_str()) != Some(LIBRARY_SCHEMA) {
            return Err(UcmError::Form(format!("library field ucm must be {LIBRARY_SCHEMA}")));
        }
        let digest = crate::canon::digest(&v)?;
        let mut lib = Library {
            version: s(&v, "version")?,
            digest,
            constants: Vec::new(),
            formulas: Vec::new(),
        };
        for c in v.get("constants").and_then(|x| x.as_array()).cloned().unwrap_or_default() {
            let unit = s(&c, "unit")?;
            let u = parse_unit(&unit)?;
            let value_text = s(&c, "value")?;
            let id = s(&c, "id")?;
            if lib.constants.iter().any(|k| k.id == id) {
                return Err(UcmError::Form(format!("constant {id} listed twice")));
            }
            lib.constants.push(Constant {
                value: parse_rat(&value_text)? * u.factor,
                id,
                name: s(&c, "name")?,
                aliases: list(&c, "aliases"),
                value_text,
                unit,
                dim: u.dim,
                exact: s(&c, "exact")? == "true",
                uncertainty: c.get("uncertainty").and_then(|x| x.as_str()).map(|x| x.to_string()),
                citation: s(&c, "citation")?,
            });
        }
        let mut formulas = Vec::new();
        for f in v.get("formulas").and_then(|x| x.as_array()).cloned().unwrap_or_default() {
            let id = s(&f, "id")?;
            let program_text = s(&f, "program")?;
            let program = crate::parse::parse_program(&program_text).map_err(|e| UcmError::Form(format!("formula {id}: {e}")))?;
            let (inputs, result_ty) = check_program(&program, &lib, true).map_err(|e| UcmError::Form(format!("formula {id}: {e}")))?;
            if formulas.iter().any(|x: &Formula| x.id == id) {
                return Err(UcmError::Form(format!("formula {id} listed twice")));
            }
            formulas.push(Formula {
                id,
                name: s(&f, "name")?,
                aliases: list(&f, "aliases"),
                description: s(&f, "description")?,
                citation: s(&f, "citation")?,
                program_text,
                program,
                input_types: inputs.into_iter().map(|(_, t)| t).collect(),
                result_ty,
                vectors: f.get("vectors").and_then(|x| x.as_array()).cloned().unwrap_or_default(),
            });
        }
        lib.formulas = formulas;
        Ok(lib)
    }

    pub fn constant(&self, id: &str) -> Option<&Constant> {
        self.constants.iter().find(|c| c.id == id)
    }

    pub fn formula(&self, id: &str) -> Option<&Formula> {
        self.formulas.iter().find(|f| f.id == id)
    }
}
