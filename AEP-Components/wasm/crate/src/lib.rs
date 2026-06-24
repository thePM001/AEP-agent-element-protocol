//! WASM sandbox execution with memory and fuel limits.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;
use wasmtime::*;

pub const DEFAULT_MAX_MEMORY_PAGES: u32 = 64;
pub const DEFAULT_TIMEOUT_MS: u64 = 250;

#[derive(Debug, Error)]
pub enum SandboxError {
    #[error("timeout after {0}ms")]
    Timeout(u64),
    #[error("sandbox violation: {0}")]
    Violation(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxLimits {
    pub max_memory_pages: u32,
    pub timeout_ms: u64,
}

impl Default for SandboxLimits {
    fn default() -> Self {
        Self {
            max_memory_pages: DEFAULT_MAX_MEMORY_PAGES,
            timeout_ms: DEFAULT_TIMEOUT_MS,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxResult {
    pub ok: bool,
    pub output: i32,
    pub fuel_consumed: u64,
}

struct SandboxStoreState {
    limiter: MemoryLimiter,
}

struct MemoryLimiter {
    max_memory_bytes: usize,
}

impl ResourceLimiter for MemoryLimiter {
    fn memory_growing(
        &mut self,
        _current: usize,
        desired: usize,
        _maximum: Option<usize>,
    ) -> Result<bool> {
        Ok(desired <= self.max_memory_bytes)
    }

    fn table_growing(
        &mut self,
        _current: usize,
        _desired: usize,
        _maximum: Option<usize>,
    ) -> Result<bool> {
        Ok(true)
    }
}

pub struct WasmSandbox {
    engine: Engine,
    limits: SandboxLimits,
}

impl WasmSandbox {
    pub fn new(limits: SandboxLimits) -> Result<Self, SandboxError> {
        let mut config = Config::new();
        config.consume_fuel(true);
        config.max_wasm_stack(256 * 1024);
        let engine = Engine::new(&config).map_err(|e| SandboxError::Violation(e.to_string()))?;
        Ok(Self { engine, limits })
    }

    pub fn evaluate_wat(&self, wat: &str, input: i32) -> Result<SandboxResult, SandboxError> {
        let module = Module::new(&self.engine, wat)
            .map_err(|e| SandboxError::Violation(format!("invalid WAT: {e}")))?;

        let max_memory_bytes = (self.limits.max_memory_pages as usize).saturating_mul(65536);
        let mut store = Store::new(
            &self.engine,
            SandboxStoreState {
                limiter: MemoryLimiter { max_memory_bytes },
            },
        );
        store.limiter(|state| &mut state.limiter);
        store
            .set_fuel(1_000_000)
            .map_err(|e| SandboxError::Violation(e.to_string()))?;

        let instance = Instance::new(&mut store, &module, &[])
            .map_err(|e| SandboxError::Violation(e.to_string()))?;

        let func = instance
            .get_typed_func::<i32, i32>(&mut store, "evaluate")
            .map_err(|e| SandboxError::Violation(format!("missing evaluate export: {e}")))?;

        let deadline = Duration::from_millis(self.limits.timeout_ms);
        let started = std::time::Instant::now();

        let output = func
            .call(&mut store, input)
            .map_err(|e| {
                if started.elapsed() > deadline {
                    SandboxError::Timeout(self.limits.timeout_ms)
                } else {
                    SandboxError::Violation(e.to_string())
                }
            })?;

        let fuel_left = store.get_fuel().unwrap_or(0);
        Ok(SandboxResult {
            ok: true,
            output,
            fuel_consumed: 1_000_000_u64.saturating_sub(fuel_left),
        })
    }
}

pub const POLICY_WAT_TEMPLATE: &str = r#"
(module
  (memory (export "memory") 1)
  (func (export "evaluate") (param $x i32) (result i32)
    local.get $x
    i32.const 1
    i32.add)
)
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evaluates_simple_policy_module() {
        let sandbox = WasmSandbox::new(SandboxLimits::default()).expect("sandbox");
        let result = sandbox
            .evaluate_wat(POLICY_WAT_TEMPLATE, 41)
            .expect("eval");
        assert!(result.ok);
        assert_eq!(result.output, 42);
    }
}