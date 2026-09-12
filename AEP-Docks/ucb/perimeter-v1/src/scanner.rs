//! @PAD: gaplune-creation-pad emit ( zero-LLM )
//! @GCDE: gaplune.policy.v1

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ScannerId {
    Secrets,
    Injection,
    Pii,
    DestructiveShell,
    PromptOverride,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScannerFinding {
    pub scanner_id: ScannerId,
    pub reason: &'static str,
}

pub trait ScannerPack {
    fn scan(&self, text: &str) -> Result<(), ScannerFinding>;
}

pub struct DefaultScannerPack;

impl ScannerPack for DefaultScannerPack {
    fn scan(&self, text: &str) -> Result<(), ScannerFinding> {
        let t = text.to_ascii_lowercase();
        if t.contains("begin private key")
            || t.contains("aws_secret_access_key")
            || t.contains("-----begin rsa")
        {
            return Err(ScannerFinding { scanner_id: ScannerId::Secrets, reason: "secrets" });
        }
        if t.contains("union select") || t.contains("; wget ") || t.contains("&& curl ") {
            return Err(ScannerFinding { scanner_id: ScannerId::Injection, reason: "injection" });
        }
        if t.contains("ssn:") || t.contains("social security") {
            return Err(ScannerFinding { scanner_id: ScannerId::Pii, reason: "pii" });
        }
        if t.contains("rm -rf") || t.contains("drop table") || t.contains(":(){:|:&};:") {
            return Err(ScannerFinding { scanner_id: ScannerId::DestructiveShell, reason: "destructive-shell" });
        }
        if t.contains("ignore all previous") || t.contains("system prompt override") {
            return Err(ScannerFinding { scanner_id: ScannerId::PromptOverride, reason: "prompt-override" });
        }
        Ok(())
    }
}
