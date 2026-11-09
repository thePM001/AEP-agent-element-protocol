//! CLI for real ML-DSA-65 (FIPS 204 via pqcrypto-mldsa) used by evidence-ledger TS bridge.
//!
//! Commands:
//!   aep-ml-dsa keygen
//!   aep-ml-dsa sign --secret-hex <hex> --message <utf8> | --message-hex <hex>
//!   aep-ml-dsa verify --public-hex <hex> --signature-hex <hex> --message <utf8> | --message-hex <hex>

use aep_lattice_crypto::{
    generate_sign_keypair, mldsa65_sign_detached, mldsa65_verify_detached, SignKeypair,
    SIGNATURE_LABEL,
};
use clap::{Parser, Subcommand};
use serde::Serialize;

#[derive(Parser, Debug)]
#[command(
    name = "aep-ml-dsa",
    about = "AEP ML-DSA-65 detached sign/verify (real PQ)"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand, Debug)]
enum Cmd {
    /// Generate ML-DSA-65 keypair (hex).
    Keygen,
    /// Sign a message with a secret key (hex).
    Sign {
        #[arg(long)]
        secret_hex: Option<String>,
        #[arg(long, conflicts_with = "message_hex")]
        message: Option<String>,
        #[arg(long)]
        message_hex: Option<String>,
        /// Optional public key hex to embed in JSON output (must match secret).
        #[arg(long)]
        public_hex: Option<String>,
    },
    /// Verify a detached signature with a public key (hex). Exit 0 on success.
    Verify {
        #[arg(long)]
        public_hex: String,
        #[arg(long)]
        signature_hex: String,
        #[arg(long, conflicts_with = "message_hex")]
        message: Option<String>,
        #[arg(long)]
        message_hex: Option<String>,
    },
}

#[derive(Serialize)]
struct KeygenOut {
    algorithm: String,
    public_hex: String,
    secret_hex: String,
}

#[derive(Serialize)]
struct SignOut {
    algorithm: String,
    signature_hex: String,
    public_hex: Option<String>,
}

#[derive(Serialize)]
struct VerifyOut {
    algorithm: String,
    valid: bool,
}

fn message_bytes(message: Option<String>, message_hex: Option<String>) -> Result<Vec<u8>, String> {
    if let Some(h) = message_hex {
        return hex::decode(h.trim()).map_err(|e| format!("message-hex: {e}"));
    }
    if let Some(m) = message {
        return Ok(m.into_bytes());
    }
    Err("provide --message or --message-hex".into())
}

/// Failure of one CLI run. The process prints it on stderr and exits 2, so it
/// never reads as a verify result (exit 0 valid, exit 1 invalid).
#[derive(Debug, thiserror::Error)]
enum CliError {
    #[error("provide --secret-hex or AEP_ML_DSA_SECRET_HEX")]
    SecretMissing,
    #[error("{0}: {1}")]
    Hex(&'static str, hex::FromHexError),
    #[error("{0}")]
    Message(String),
    #[error("sign: {0}")]
    Sign(aep_lattice_crypto::CryptoError),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

fn decode(label: &'static str, text: &str) -> Result<Vec<u8>, CliError> {
    hex::decode(text.trim()).map_err(|e| CliError::Hex(label, e))
}

/// Run one command. Returns the JSON line and the exit code.
fn run(cmd: Cmd) -> Result<(String, i32), CliError> {
    match cmd {
        Cmd::Keygen => {
            let kp = generate_sign_keypair();
            let out = KeygenOut {
                algorithm: SIGNATURE_LABEL.into(),
                public_hex: hex::encode(&kp.public),
                secret_hex: hex::encode(&kp.secret),
            };
            Ok((serde_json::to_string(&out)?, 0))
        }
        Cmd::Sign {
            secret_hex,
            message,
            message_hex,
            public_hex,
        } => {
            let secret_hex = secret_hex
                .or_else(|| std::env::var("AEP_ML_DSA_SECRET_HEX").ok())
                .ok_or(CliError::SecretMissing)?;
            let secret = decode("secret-hex", &secret_hex)?;
            let public = match public_hex.as_ref() {
                Some(p) => decode("public-hex", p)?,
                None => Vec::new(),
            };
            let msg = message_bytes(message, message_hex).map_err(CliError::Message)?;
            let kp = SignKeypair { public, secret };
            let sig = mldsa65_sign_detached(&msg, &kp).map_err(CliError::Sign)?;
            let out = SignOut {
                algorithm: SIGNATURE_LABEL.into(),
                signature_hex: hex::encode(&sig),
                public_hex,
            };
            Ok((serde_json::to_string(&out)?, 0))
        }
        Cmd::Verify {
            public_hex,
            signature_hex,
            message,
            message_hex,
        } => {
            let public = decode("public-hex", &public_hex)?;
            let signature = decode("signature-hex", &signature_hex)?;
            let msg = message_bytes(message, message_hex).map_err(CliError::Message)?;
            let valid = mldsa65_verify_detached(&msg, &signature, &public).is_ok();
            let out = VerifyOut {
                algorithm: SIGNATURE_LABEL.into(),
                valid,
            };
            Ok((serde_json::to_string(&out)?, if valid { 0 } else { 1 }))
        }
    }
}

fn main() {
    let cli = Cli::parse();
    match run(cli.cmd) {
        Ok((line, code)) => {
            println!("{line}");
            if code != 0 {
                std::process::exit(code);
            }
        }
        Err(err) => {
            eprintln!("aep-ml-dsa: {err}");
            std::process::exit(2);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bad_hex_is_an_error_not_a_panic() {
        let cmd = Cmd::Verify {
            public_hex: String::from("zz"),
            signature_hex: String::from("00"),
            message: Some(String::from("m")),
            message_hex: None,
        };
        assert!(matches!(run(cmd), Err(CliError::Hex("public-hex", _))));
    }

    #[test]
    fn sign_then_verify_round_trips() {
        let kp = generate_sign_keypair();
        let (line, code) = run(Cmd::Sign {
            secret_hex: Some(hex::encode(&kp.secret)),
            message: Some(String::from("aep")),
            message_hex: None,
            public_hex: None,
        })
        .unwrap();
        assert_eq!(code, 0);
        let sig: serde_json::Value = serde_json::from_str(&line).unwrap();
        let signature_hex = sig["signature_hex"].as_str().unwrap().to_string();
        let verify = |message: &str| {
            run(Cmd::Verify {
                public_hex: hex::encode(&kp.public),
                signature_hex: signature_hex.clone(),
                message: Some(String::from(message)),
                message_hex: None,
            })
            .unwrap()
            .1
        };
        assert_eq!(verify("aep"), 0);
        assert_eq!(verify("other"), 1);
    }
}
// AEP 2.9 release line.
