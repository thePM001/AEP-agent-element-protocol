// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:a7f4fd0175e90de2ce241d72f4f523844d5b2bfbaf2d0a8855aeb3da0e2d5aa0
// crate: aep-no-sequential-ts-deny
// tokens: 0
use std::fs;
use std::path::PathBuf;
pub fn scan_live(src: &str) -> Result<String, String> {
    if src.contains("runEnvelopeAdmit") == false { return Err(String::from("never calls runEnvelopeAdmit")); }
    if src.contains("Admit collect-all walls then Apply") == false { return Err(String::from("missing collect-all copy")); }
    let compact: String = src.chars().filter(|c| !c.is_whitespace()).collect();
    if compact.contains("temporalValidator.validate") { return Err(String::from("still calls TemporalValidator.validate")); }
    if compact.contains("causalEngine.process(") { return Err(String::from("still calls CausalOrderingEngine.process")); }
    if compact.contains("regoEvaluator.evaluate") { return Err(String::from("still calls UnifiedRegoEvaluator.evaluate")); }
    if compact.contains("contentScanner.scan") { return Err(String::from("still calls UnifiedScanner.scan")); }
    if compact.contains("forecastSidecar.checkAnomalySync") { return Err(String::from("still calls ForecastSidecar.checkAnomalySync")); }
    Ok(String::from("ok no sequential TypeScript deny after Admit"))
}
pub fn run_gate() -> Result<i32, String> {
    let live = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../AEP-SDKs/typescript/dynaep/src").join(concat!("brid","ge.ts"));
    if live.is_file() == false { return Err(String::from("live source missing")); }
    let src = fs::read_to_string(&live).map_err(|e| e.to_string())?;
    let proof = scan_live(&src)?;
    println!("aep-no-sequential-ts-deny ok proof={}", proof);
    Ok(0)
}
