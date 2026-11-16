//! What a program needs to start: its loader and its shared libraries.
//!
//! The root file system of a sandbox holds only the programs of the toolset. A
//! program that is linked against shared libraries does not start without them, so
//! the CAW reads the dynamic section of every program and library and brings exactly
//! the named files. It never runs a program to learn this.
//!
//! Only ELF files of 64 bit in little endian byte order are read. Every offset is
//! checked against the size of the file, so a broken file is refused and never read
//! past its end.

const PT_LOAD: u32 = 1;
const PT_DYNAMIC: u32 = 2;
const PT_INTERP: u32 = 3;
const DT_NULL: u64 = 0;
const DT_NEEDED: u64 = 1;
const DT_STRTAB: u64 = 5;
const DT_RPATH: u64 = 15;
const DT_RUNPATH: u64 = 29;

/// Most entries the reader takes from one table. A real program has far fewer.
const MAX_ENTRIES: usize = 4096;

/// Why a file is not a program the CAW can place in a sandbox.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ElfError {
    /// The file does not start with the ELF magic. A script is such a file.
    #[error("the file is not an ELF program")]
    NotElf,
    /// The file is ELF of another class or byte order.
    #[error("the file is not a 64 bit little endian ELF program")]
    Unsupported,
    /// A table or a text of the file runs past its end.
    #[error("the ELF file is cut off or broken")]
    Broken,
}

/// The start needs of one ELF file.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ElfNeeds {
    /// Path of the loader, absent for a static program and for most libraries.
    pub interpreter: Option<String>,
    /// Names of the shared libraries the file names, in their order.
    pub needed: Vec<String>,
    /// Folders the file adds to the library search, from DT_RUNPATH or DT_RPATH.
    pub run_paths: Vec<String>,
}

/// The `len` bytes at `at`. An offset near the end of the address space is a
/// broken file, not an overflow.
fn bytes_at(data: &[u8], at: usize, len: usize) -> Result<&[u8], ElfError> {
    let end = at.checked_add(len).ok_or(ElfError::Broken)?;
    data.get(at..end).ok_or(ElfError::Broken)
}

fn plus(at: usize, more: usize) -> Result<usize, ElfError> {
    at.checked_add(more).ok_or(ElfError::Broken)
}

fn u16_at(data: &[u8], at: usize) -> Result<u16, ElfError> {
    let bytes = bytes_at(data, at, 2)?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn u32_at(data: &[u8], at: usize) -> Result<u32, ElfError> {
    let bytes = bytes_at(data, at, 4)?;
    Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn u64_at(data: &[u8], at: usize) -> Result<u64, ElfError> {
    let bytes = bytes_at(data, at, 8)?;
    let mut raw = [0u8; 8];
    raw.copy_from_slice(bytes);
    Ok(u64::from_le_bytes(raw))
}

fn offset(value: u64) -> Result<usize, ElfError> {
    usize::try_from(value).map_err(|_| ElfError::Broken)
}

/// The text that starts at `at` and ends before the next zero byte.
fn text_at(data: &[u8], at: usize) -> Result<String, ElfError> {
    let rest = data.get(at..).ok_or(ElfError::Broken)?;
    let end = rest.iter().position(|b| *b == 0).ok_or(ElfError::Broken)?;
    String::from_utf8(rest[..end].to_vec()).map_err(|_| ElfError::Broken)
}

struct Segment {
    kind: u32,
    file_offset: u64,
    address: u64,
    file_size: u64,
}

/// Reads the loader, the needed libraries and the search folders of an ELF file.
pub fn read_needs(data: &[u8]) -> Result<ElfNeeds, ElfError> {
    if data.get(..4) != Some(b"\x7fELF") {
        return Err(ElfError::NotElf);
    }
    if data.get(4) != Some(&2) || data.get(5) != Some(&1) {
        return Err(ElfError::Unsupported);
    }
    let table = offset(u64_at(data, 0x20)?)?;
    let entry_size = usize::from(u16_at(data, 0x36)?);
    let count = usize::from(u16_at(data, 0x38)?);
    if count > 0 && entry_size < 56 {
        return Err(ElfError::Broken);
    }
    let mut segments = Vec::new();
    for i in 0..count.min(MAX_ENTRIES) {
        let at = table
            .checked_add(i.checked_mul(entry_size).ok_or(ElfError::Broken)?)
            .ok_or(ElfError::Broken)?;
        segments.push(Segment {
            kind: u32_at(data, at)?,
            file_offset: u64_at(data, plus(at, 8)?)?,
            address: u64_at(data, plus(at, 16)?)?,
            file_size: u64_at(data, plus(at, 32)?)?,
        });
    }

    let mut needs = ElfNeeds::default();
    if let Some(segment) = segments.iter().find(|s| s.kind == PT_INTERP) {
        needs.interpreter = Some(text_at(data, offset(segment.file_offset)?)?);
    }
    let Some(dynamic) = segments.iter().find(|s| s.kind == PT_DYNAMIC) else {
        return Ok(needs);
    };

    let start = offset(dynamic.file_offset)?;
    let entries = (offset(dynamic.file_size)? / 16).min(MAX_ENTRIES);
    let mut string_table: Option<u64> = None;
    let mut needed = Vec::new();
    let mut run_path = None;
    let mut r_path = None;
    for i in 0..entries {
        let at = start.checked_add(i * 16).ok_or(ElfError::Broken)?;
        let tag = u64_at(data, at)?;
        let value = u64_at(data, plus(at, 8)?)?;
        match tag {
            DT_NULL => break,
            DT_NEEDED => needed.push(value),
            DT_STRTAB => string_table = Some(value),
            DT_RUNPATH => run_path = Some(value),
            DT_RPATH => r_path = Some(value),
            _ => {}
        }
    }
    if needed.is_empty() && run_path.is_none() && r_path.is_none() {
        return Ok(needs);
    }
    // The string table is given as an address. The load segment that holds the
    // address says where it lies in the file.
    let address = string_table.ok_or(ElfError::Broken)?;
    let strings = segments
        .iter()
        .filter(|s| s.kind == PT_LOAD)
        .find(|s| address >= s.address && address - s.address < s.file_size)
        .map(|s| s.file_offset.checked_add(address - s.address))
        .ok_or(ElfError::Broken)?
        .ok_or(ElfError::Broken)?;
    let text = |value: u64| -> Result<String, ElfError> {
        text_at(
            data,
            offset(strings.checked_add(value).ok_or(ElfError::Broken)?)?,
        )
    };
    for value in needed {
        needs.needed.push(text(value)?);
    }
    if let Some(value) = run_path.or(r_path) {
        needs.run_paths = text(value)?
            .split(':')
            .filter(|p| !p.is_empty())
            .map(str::to_string)
            .collect();
    }
    Ok(needs)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Builds a small ELF file with one load segment that starts at address 0x1000
    /// of the file offset 0, a loader, the given libraries and a run path.
    pub(crate) fn build(
        interpreter: Option<&str>,
        needed: &[&str],
        run_path: Option<&str>,
    ) -> Vec<u8> {
        let header = 64usize;
        let segments = 3usize;
        let mut strings = vec![0u8];
        let mut offsets = Vec::new();
        for name in needed {
            offsets.push(strings.len() as u64);
            strings.extend_from_slice(name.as_bytes());
            strings.push(0);
        }
        let run_path_at = run_path.map(|path| {
            let at = strings.len() as u64;
            strings.extend_from_slice(path.as_bytes());
            strings.push(0);
            at
        });
        let interp_at = header + segments * 56;
        let interp_bytes: Vec<u8> = interpreter
            .map(|p| [p.as_bytes(), &[0]].concat())
            .unwrap_or_default();
        let strings_at = interp_at + interp_bytes.len();
        let dynamic_at = strings_at + strings.len();
        let mut dynamic: Vec<(u64, u64)> = offsets.iter().map(|o| (DT_NEEDED, *o)).collect();
        if let Some(at) = run_path_at {
            dynamic.push((DT_RUNPATH, at));
        }
        dynamic.push((DT_STRTAB, 0x1000 + strings_at as u64));
        dynamic.push((DT_NULL, 0));
        let total = dynamic_at + dynamic.len() * 16;

        let mut file = vec![0u8; header];
        file[..4].copy_from_slice(b"\x7fELF");
        file[4] = 2;
        file[5] = 1;
        file[0x20..0x28].copy_from_slice(&(header as u64).to_le_bytes());
        file[0x36..0x38].copy_from_slice(&56u16.to_le_bytes());
        file[0x38..0x3a].copy_from_slice(&(segments as u16).to_le_bytes());
        let mut segment = |kind: u32, at: usize, address: u64, size: usize| {
            let mut entry = vec![0u8; 56];
            entry[..4].copy_from_slice(&kind.to_le_bytes());
            entry[8..16].copy_from_slice(&(at as u64).to_le_bytes());
            entry[16..24].copy_from_slice(&address.to_le_bytes());
            entry[32..40].copy_from_slice(&(size as u64).to_le_bytes());
            file.extend_from_slice(&entry);
        };
        segment(PT_LOAD, 0, 0x1000, total);
        if interpreter.is_some() {
            segment(
                PT_INTERP,
                interp_at,
                0x1000 + interp_at as u64,
                interp_bytes.len(),
            );
        } else {
            segment(0, 0, 0, 0);
        }
        segment(
            PT_DYNAMIC,
            dynamic_at,
            0x1000 + dynamic_at as u64,
            dynamic.len() * 16,
        );
        file.extend_from_slice(&interp_bytes);
        file.extend_from_slice(&strings);
        for (tag, value) in dynamic {
            file.extend_from_slice(&tag.to_le_bytes());
            file.extend_from_slice(&value.to_le_bytes());
        }
        file
    }

    #[test]
    fn a_dynamic_program_names_its_loader_libraries_and_run_path() {
        let file = build(
            Some("/lib64/ld-linux-x86-64.so.2"),
            &["libselinux.so.1", "libc.so.6"],
            Some("$ORIGIN/../lib:/opt/app/lib"),
        );
        assert_eq!(
            read_needs(&file),
            Ok(ElfNeeds {
                interpreter: Some("/lib64/ld-linux-x86-64.so.2".to_string()),
                needed: vec!["libselinux.so.1".to_string(), "libc.so.6".to_string()],
                run_paths: vec!["$ORIGIN/../lib".to_string(), "/opt/app/lib".to_string()],
            })
        );
    }

    #[test]
    fn a_library_has_no_loader() {
        let file = build(None, &["libc.so.6"], None);
        let needs = read_needs(&file).expect("reads");
        assert_eq!(needs.interpreter, None);
        assert_eq!(needs.needed, vec!["libc.so.6".to_string()]);
        assert!(needs.run_paths.is_empty());
    }

    #[test]
    fn a_static_program_needs_nothing() {
        let mut file = vec![0u8; 64];
        file[..4].copy_from_slice(b"\x7fELF");
        file[4] = 2;
        file[5] = 1;
        assert_eq!(read_needs(&file), Ok(ElfNeeds::default()));
    }

    #[test]
    fn a_script_and_other_files_are_not_elf() {
        assert_eq!(read_needs(b"#!/bin/sh\necho hi\n"), Err(ElfError::NotElf));
        assert_eq!(read_needs(b""), Err(ElfError::NotElf));
        assert_eq!(read_needs(b"\x7fEL"), Err(ElfError::NotElf));
    }

    #[test]
    fn another_class_or_byte_order_is_not_supported() {
        let mut file = build(None, &["libc.so.6"], None);
        file[4] = 1;
        assert_eq!(read_needs(&file), Err(ElfError::Unsupported));
        file[4] = 2;
        file[5] = 2;
        assert_eq!(read_needs(&file), Err(ElfError::Unsupported));
    }

    #[test]
    fn every_cut_of_a_file_is_refused_or_read_and_never_a_panic() {
        let file = build(
            Some("/lib64/ld-linux-x86-64.so.2"),
            &["libc.so.6"],
            Some("/opt/lib"),
        );
        for end in 0..file.len() {
            let _ = read_needs(&file[..end]);
        }
        assert_eq!(read_needs(&file[..file.len() - 20]), Err(ElfError::Broken));
        let mut far = file.clone();
        far[0x20..0x28].copy_from_slice(&u64::MAX.to_le_bytes());
        assert_eq!(read_needs(&far), Err(ElfError::Broken));
    }

    #[test]
    fn a_string_table_outside_every_load_segment_is_broken() {
        let mut file = build(None, &["libc.so.6"], None);
        let at = file.len() - 32 + 8;
        file[at..at + 8].copy_from_slice(&0x9000_0000u64.to_le_bytes());
        assert_eq!(read_needs(&file), Err(ElfError::Broken));
    }
}
