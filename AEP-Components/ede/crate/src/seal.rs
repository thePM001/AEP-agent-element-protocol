//! The EDE key and its seals.
//!
//! Every record of aep-ede that proves something (a draft record, a scan statement, a
//! ledger entry) carries hmac-sha256:<hex> under the EDE key of the operator folder.
//! Digests are taken in process: no helper program, no exit status to forget, no empty
//! digest (finding CRYPTO 04).

use crate::operator::Operator;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};

pub const SEAL_PREFIX: &str = "hmac-sha256:";

pub fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

/// SHA-1 of `data` (FIPS 180-4), in process. Git names its objects with it; aep-ede uses
/// it only to check that a blob read from a git folder holds the bytes its id names.
pub fn sha1(data: &[u8]) -> [u8; 20] {
    let mut msg = data.to_vec();
    let bit_len = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());
    let mut h: [u32; 5] = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 80];
        for (i, word) in w.iter_mut().take(16).enumerate() {
            *word = u32::from_be_bytes([
                chunk[4 * i],
                chunk[4 * i + 1],
                chunk[4 * i + 2],
                chunk[4 * i + 3],
            ]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let (mut a, mut b, mut c, mut d, mut e) = (h[0], h[1], h[2], h[3], h[4]);
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5A827999u32),
                20..=39 => (b ^ c ^ d, 0x6ED9EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1BBCDC),
                _ => (b ^ c ^ d, 0xCA62C1D6),
            };
            let t = a
                .rotate_left(5)
                .wrapping_add(f)
                .wrapping_add(e)
                .wrapping_add(k)
                .wrapping_add(*wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = t;
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
    }
    let mut out = [0u8; 20];
    for (i, v) in h.iter().enumerate() {
        out[4 * i..4 * i + 4].copy_from_slice(&v.to_be_bytes());
    }
    out
}

/// The git id of a blob with these bytes (object format sha1).
pub fn git_blob_id(data: &[u8]) -> String {
    let mut obj = format!("blob {}\0", data.len()).into_bytes();
    obj.extend_from_slice(data);
    hex::encode(sha1(&obj))
}

/// Equal over every byte, so the time does not tell where two values differ.
pub fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b.iter())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
}

/// The EDE key of the operator folder, made on first use with 32 bytes of the kernel.
pub fn key(op: &Operator) -> Result<Vec<u8>, String> {
    use std::os::unix::fs::OpenOptionsExt;
    let _r = crate::privilege::raise();
    let p = op.key_path();
    if let Ok(k) = fs::read(&p) {
        if k.len() >= 32 {
            return Ok(k);
        }
        return Err(format!("{} is shorter than 32 bytes", p.display()));
    }
    let mut k = vec![0u8; 32];
    fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut k))
        .map_err(|e| format!("EDE key: {}", e))?;
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&p)
    {
        Ok(mut f) => {
            f.write_all(&k)
                .and_then(|_| f.sync_all())
                .map_err(|e| format!("EDE key: {}", e))?;
            Ok(k)
        }
        Err(_) => fs::read(&p).map_err(|e| format!("EDE key: {}", e)),
    }
}

/// hmac-sha256:<hex> of a body under the EDE key.
pub fn seal(op: &Operator, body: &[u8]) -> Result<String, String> {
    let mut mac = Hmac::<Sha256>::new_from_slice(&key(op)?).map_err(|e| e.to_string())?;
    mac.update(body);
    Ok(format!(
        "{}{}",
        SEAL_PREFIX,
        hex::encode(mac.finalize().into_bytes())
    ))
}

pub fn verify(op: &Operator, body: &[u8], seal_line: &str) -> bool {
    match seal(op, body) {
        Ok(want) => same(want.as_bytes(), seal_line.trim().as_bytes()),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digests_match_the_standard_vectors() {
        assert_eq!(
            hex::encode(sha1(b"abc")),
            "a9993e364706816aba3e25717850c26c9cd0d89d"
        );
        assert_eq!(
            git_blob_id(b"hello\n"),
            "ce013625030ba8dba906f756967f9e9ca394464a"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
