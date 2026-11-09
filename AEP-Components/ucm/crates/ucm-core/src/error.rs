//! Typed errors. Every error has a stable code that vectors and receipts use.

use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum UcmError {
    #[error("parse error at {line}:{col}: {msg}")]
    Parse {
        line: usize,
        col: usize,
        msg: String,
    },
    #[error("type error: {0}")]
    Type(String),
    #[error("unknown name: {0}")]
    Unbound(String),
    #[error("unknown function: {0}")]
    UnknownFunction(String),
    #[error("input error: {0}")]
    Input(String),
    #[error("division by zero")]
    DivisionByZero,
    #[error("domain error: {0}")]
    Domain(String),
    #[error("unit error: {0}")]
    Unit(String),
    #[error("budget exceeded: {what}")]
    BudgetExceeded { what: String },
    #[error("program form error: {0}")]
    Form(String),
}

impl UcmError {
    /// Stable machine code. Never reworded once published.
    pub fn code(&self) -> &'static str {
        match self {
            UcmError::Parse { .. } => "parse_error",
            UcmError::Type(_) => "type_error",
            UcmError::Unbound(_) => "unbound_name",
            UcmError::UnknownFunction(_) => "unknown_function",
            UcmError::Input(_) => "input_error",
            UcmError::DivisionByZero => "division_by_zero",
            UcmError::Domain(_) => "domain_error",
            UcmError::Unit(_) => "unit_error",
            UcmError::BudgetExceeded { .. } => "budget_exceeded",
            UcmError::Form(_) => "form_error",
        }
    }
}

pub type Result<T> = std::result::Result<T, UcmError>;

pub(crate) fn type_err<T>(msg: impl Into<String>) -> Result<T> {
    Err(UcmError::Type(msg.into()))
}

pub(crate) fn domain_err<T>(msg: impl Into<String>) -> Result<T> {
    Err(UcmError::Domain(msg.into()))
}
