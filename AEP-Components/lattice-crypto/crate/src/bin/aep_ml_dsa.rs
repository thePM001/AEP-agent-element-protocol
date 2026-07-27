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
#[command(name = "aep-ml-dsa", about = "AEP ML-DSA-65 detached sign/verify (real PQ)")]
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

fn main() {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Keygen => {
            let kp = generate_sign_keypair();
            let out = KeygenOut {
                algorithm: SIGNATURE_LABEL.into(),
                public_hex: hex::encode(&kp.public),
                secret_hex: hex::encode(&kp.secret),
            };
            println!("{}", serde_json::to_string(&out).expect("json"));
        }
        Cmd::Sign {
            secret_hex,
            message,
            message_hex,
            public_hex,
        } => {
            let secret_hex = secret_hex
                .or_else(|| std::env::var("AEP_ML_DSA_SECRET_HEX").ok())
                .expect("provide --secret-hex or AEP_ML_DSA_SECRET_HEX");
            let secret = hex::decode(secret_hex.trim()).expect("secret-hex");
            let public = public_hex
                .as_ref()
                .map(|p| hex::decode(p.trim()).expect("public-hex"))
                .unwrap_or_default();
            let msg = message_bytes(message, message_hex).expect("message");
            let kp = SignKeypair { public, secret };
            let sig = mldsa65_sign_detached(&msg, &kp).expect("sign");
            let out = SignOut {
                algorithm: SIGNATURE_LABEL.into(),
                signature_hex: hex::encode(&sig),
                public_hex: public_hex,
            };
            println!("{}", serde_json::to_string(&out).expect("json"));
        }
        Cmd::Verify {
            public_hex,
            signature_hex,
            message,
            message_hex,
        } => {
            let public = hex::decode(public_hex.trim()).expect("public-hex");
            let signature = hex::decode(signature_hex.trim()).expect("signature-hex");
            let msg = message_bytes(message, message_hex).expect("message");
            let valid = mldsa65_verify_detached(&msg, &signature, &public).is_ok();
            let out = VerifyOut {
                algorithm: SIGNATURE_LABEL.into(),
                valid,
            };
            println!("{}", serde_json::to_string(&out).expect("json"));
            if !valid {
                std::process::exit(1);
            }
        }
    }
}
