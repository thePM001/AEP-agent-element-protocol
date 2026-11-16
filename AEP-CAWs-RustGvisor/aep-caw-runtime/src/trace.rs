//! Wire format of the gVisor `remote` trace sink.
//!
//! The sentry of gVisor connects to a Unix socket of the type `SOCK_SEQPACKET`. Both
//! sides first exchange one handshake message. After that every packet is one trace
//! point: a header of eight bytes followed by one protobuf message.
//!
//! ```text
//! 0 --------- 16 ---------- 32 ----------- 64 -----------+
//! | HeaderSize | MessageType | DroppedCount | Payload... |
//! +---- 16 ----+---- 16 -----+----- 32 -----+------------+
//! ```
//!
//! The layout follows `pkg/sentry/seccheck` of the pinned gVisor release. Only the
//! fields the CAW reads are decoded. Unknown fields are skipped, so a newer gVisor
//! that adds fields does not break the reader.

/// Version of the wire format that this reader speaks.
pub const WIRE_VERSION: u32 = 1;

/// Size of the fixed part of the packet header in bytes.
pub const HEADER_SIZE: usize = 8;

/// Message type of the point that fires when a new program image is loaded.
pub const MESSAGE_SENTRY_EXEC: u16 = 3;
/// Message type of an open, openat or creat call.
pub const MESSAGE_SYSCALL_OPEN: u16 = 7;
/// Message type of a connect call.
pub const MESSAGE_SYSCALL_CONNECT: u16 = 10;
/// Message type of an execve or execveat call.
pub const MESSAGE_SYSCALL_EXECVE: u16 = 11;

/// What went wrong while a packet was read.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum TraceError {
    /// The packet is shorter than its header says.
    #[error("trace packet of {got} bytes is shorter than its header of {want} bytes")]
    ShortPacket {
        /// Bytes in the packet.
        got: usize,
        /// Bytes the header needs.
        want: usize,
    },
    /// A protobuf field runs past the end of its message.
    #[error("trace message is cut off inside a field")]
    Truncated,
    /// A varint is longer than ten bytes.
    #[error("trace message holds a varint that is too long")]
    VarintTooLong,
    /// The protobuf wire type is not one this reader knows.
    #[error("trace message holds the unknown protobuf wire type {0}")]
    WireType(u8),
    /// The other side speaks another version of the wire format.
    #[error("trace sink speaks wire version {0}, this reader speaks version 1")]
    Version(u32),
    /// A socket call failed.
    #[error("trace socket: {0}")]
    Socket(String),
}

/// The fixed header of one packet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Header {
    /// Size of the header in bytes. The payload starts right after it.
    pub header_size: u16,
    /// Type of the payload.
    pub message_type: u16,
    /// Number of points the sentry dropped so far. It wraps around.
    pub dropped_count: u32,
}

impl Header {
    /// Reads the header of a packet. The sentry writes it in the byte order of the
    /// host, which is little endian on every platform gVisor supports.
    pub fn parse(packet: &[u8]) -> Result<Self, TraceError> {
        if packet.len() < HEADER_SIZE {
            return Err(TraceError::ShortPacket {
                got: packet.len(),
                want: HEADER_SIZE,
            });
        }
        let header = Self {
            header_size: u16::from_le_bytes([packet[0], packet[1]]),
            message_type: u16::from_le_bytes([packet[2], packet[3]]),
            dropped_count: u32::from_le_bytes([packet[4], packet[5], packet[6], packet[7]]),
        };
        let want = usize::from(header.header_size);
        if want < HEADER_SIZE || packet.len() < want {
            return Err(TraceError::ShortPacket {
                got: packet.len(),
                want: want.max(HEADER_SIZE),
            });
        }
        Ok(header)
    }
}

/// The kind of call a trace event reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TraceKind {
    /// open, openat or creat.
    Open,
    /// execve or execveat as a system call. gVisor reports errno zero on the exit
    /// point of this call even when the program does not exist, so a failed exec is
    /// an `Execve` point with no `ExecDone` point for the same path.
    Execve,
    /// A new program image was loaded. Only a successful exec reaches this point.
    ExecDone,
    /// connect.
    Connect,
    /// A point the CAW does not read. The value is the message type.
    Other(u16),
}

impl TraceKind {
    /// Short name for logs and audit lines.
    pub fn name(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Execve => "execve",
            Self::ExecDone => "exec-done",
            Self::Connect => "connect",
            Self::Other(_) => "other",
        }
    }
}

/// Result of a call, present on exit points only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TraceExit {
    /// Return value of the call.
    pub result: i64,
    /// Linux errno of a failed call, zero on success.
    pub errno: i64,
}

/// One decoded trace point.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraceEvent {
    /// Kind of the call.
    pub kind: TraceKind,
    /// Points the sentry dropped so far.
    pub dropped_count: u32,
    /// Result of the call. `None` on an enter point.
    pub exit: Option<TraceExit>,
    /// Number of the system call.
    pub sysno: u64,
    /// Path argument of an open or execve call, or the loaded program of `ExecDone`.
    pub pathname: String,
    /// Path of the file descriptor argument, when the point asked for it.
    pub fd_path: String,
    /// Raw socket address of a connect call.
    pub address: Vec<u8>,
    /// Name of the calling process.
    pub process_name: String,
    /// Id of the container of the calling process.
    pub container_id: String,
    /// Thread group id of the calling process.
    pub thread_group_id: i32,
}

impl TraceEvent {
    /// True when the point is an exit point of a call that failed.
    pub fn failed(&self) -> bool {
        self.exit.is_some_and(|e| e.errno != 0)
    }
}

/// One protobuf field value.
enum Field<'a> {
    Varint(u64),
    Bytes(&'a [u8]),
    Skipped,
}

/// Reader over the fields of one protobuf message.
struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    fn varint(&mut self) -> Result<u64, TraceError> {
        let mut value: u64 = 0;
        for i in 0..10 {
            let byte = *self.buf.get(self.pos).ok_or(TraceError::Truncated)?;
            self.pos += 1;
            value |= u64::from(byte & 0x7f) << (7 * i);
            if byte & 0x80 == 0 {
                return Ok(value);
            }
        }
        Err(TraceError::VarintTooLong)
    }

    fn take(&mut self, len: usize) -> Result<&'a [u8], TraceError> {
        let end = self.pos.checked_add(len).ok_or(TraceError::Truncated)?;
        let slice = self.buf.get(self.pos..end).ok_or(TraceError::Truncated)?;
        self.pos = end;
        Ok(slice)
    }

    /// Reads the next field. `None` at the end of the message.
    fn next(&mut self) -> Result<Option<(u64, Field<'a>)>, TraceError> {
        if self.pos >= self.buf.len() {
            return Ok(None);
        }
        let key = self.varint()?;
        let number = key >> 3;
        let field = match (key & 0x7) as u8 {
            0 => Field::Varint(self.varint()?),
            1 => {
                self.take(8)?;
                Field::Skipped
            }
            2 => {
                let len = usize::try_from(self.varint()?).map_err(|_| TraceError::Truncated)?;
                Field::Bytes(self.take(len)?)
            }
            5 => {
                self.take(4)?;
                Field::Skipped
            }
            other => return Err(TraceError::WireType(other)),
        };
        Ok(Some((number, field)))
    }
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn decode_exit(buf: &[u8]) -> Result<TraceExit, TraceError> {
    let mut exit = TraceExit {
        result: 0,
        errno: 0,
    };
    let mut reader = Reader::new(buf);
    while let Some((number, field)) = reader.next()? {
        match (number, field) {
            (1, Field::Varint(v)) => exit.result = v as i64,
            (2, Field::Varint(v)) => exit.errno = v as i64,
            _ => {}
        }
    }
    Ok(exit)
}

fn decode_context(buf: &[u8], event: &mut TraceEvent) -> Result<(), TraceError> {
    let mut reader = Reader::new(buf);
    while let Some((number, field)) = reader.next()? {
        match (number, field) {
            (4, Field::Varint(v)) => event.thread_group_id = v as i32,
            (6, Field::Bytes(b)) => event.container_id = text(b),
            (9, Field::Bytes(b)) => event.process_name = text(b),
            _ => {}
        }
    }
    Ok(())
}

/// Decodes one packet of the trace sink.
///
/// The message of the point `sentry/execve` carries its context in field one and the
/// path of the loaded program in field two.
///
/// The messages Open, Execve and Connect share their first five fields: context,
/// exit, sysno, fd and fd_path. Field six is the path of Open and Execve and the raw
/// address of Connect. Every other message type comes back as [`TraceKind::Other`]
/// with its header values only.
pub fn decode_packet(packet: &[u8]) -> Result<TraceEvent, TraceError> {
    let header = Header::parse(packet)?;
    let kind = match header.message_type {
        MESSAGE_SYSCALL_OPEN => TraceKind::Open,
        MESSAGE_SYSCALL_EXECVE => TraceKind::Execve,
        MESSAGE_SENTRY_EXEC => TraceKind::ExecDone,
        MESSAGE_SYSCALL_CONNECT => TraceKind::Connect,
        other => TraceKind::Other(other),
    };
    let mut event = TraceEvent {
        kind,
        dropped_count: header.dropped_count,
        exit: None,
        sysno: 0,
        pathname: String::new(),
        fd_path: String::new(),
        address: Vec::new(),
        process_name: String::new(),
        container_id: String::new(),
        thread_group_id: 0,
    };
    if matches!(kind, TraceKind::Other(_)) {
        return Ok(event);
    }
    let payload = &packet[usize::from(header.header_size)..];
    let mut reader = Reader::new(payload);
    if kind == TraceKind::ExecDone {
        while let Some((number, field)) = reader.next()? {
            match (number, field) {
                (1, Field::Bytes(b)) => decode_context(b, &mut event)?,
                (2, Field::Bytes(b)) => event.pathname = text(b),
                _ => {}
            }
        }
        return Ok(event);
    }
    while let Some((number, field)) = reader.next()? {
        match (number, field) {
            (1, Field::Bytes(b)) => decode_context(b, &mut event)?,
            (2, Field::Bytes(b)) => event.exit = Some(decode_exit(b)?),
            (3, Field::Varint(v)) => event.sysno = v,
            (5, Field::Bytes(b)) => event.fd_path = text(b),
            (6, Field::Bytes(b)) => {
                if kind == TraceKind::Connect {
                    event.address = b.to_vec();
                } else {
                    event.pathname = text(b);
                }
            }
            _ => {}
        }
    }
    Ok(event)
}

/// Encodes the handshake message with the given wire version.
pub fn encode_handshake(version: u32) -> Vec<u8> {
    let mut out = vec![0x08];
    let mut value = version;
    loop {
        let byte = (value & 0x7f) as u8;
        value >>= 7;
        if value == 0 {
            out.push(byte);
            return out;
        }
        out.push(byte | 0x80);
    }
}

/// Decodes a handshake message and returns the wire version of the sender.
pub fn decode_handshake(buf: &[u8]) -> Result<u32, TraceError> {
    let mut version: u32 = 0;
    let mut reader = Reader::new(buf);
    while let Some((number, field)) = reader.next()? {
        if let (1, Field::Varint(v)) = (number, field) {
            version = u32::try_from(v).map_err(|_| TraceError::Version(u32::MAX))?;
        }
    }
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn varint(mut value: u64, out: &mut Vec<u8>) {
        loop {
            let byte = (value & 0x7f) as u8;
            value >>= 7;
            if value == 0 {
                out.push(byte);
                return;
            }
            out.push(byte | 0x80);
        }
    }

    fn field_varint(number: u64, value: u64, out: &mut Vec<u8>) {
        varint(number << 3, out);
        varint(value, out);
    }

    fn field_bytes(number: u64, value: &[u8], out: &mut Vec<u8>) {
        varint((number << 3) | 2, out);
        varint(value.len() as u64, out);
        out.extend_from_slice(value);
    }

    fn packet(message_type: u16, dropped: u32, payload: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&(HEADER_SIZE as u16).to_le_bytes());
        out.extend_from_slice(&message_type.to_le_bytes());
        out.extend_from_slice(&dropped.to_le_bytes());
        out.extend_from_slice(payload);
        out
    }

    fn failed_call(path_or_address: &[u8], errno: u64) -> Vec<u8> {
        let mut context = Vec::new();
        field_varint(4, 42, &mut context);
        field_bytes(6, b"caw-1", &mut context);
        field_bytes(9, b"cat", &mut context);
        let mut exit = Vec::new();
        field_varint(1, (-1i64) as u64, &mut exit);
        field_varint(2, errno, &mut exit);
        let mut payload = Vec::new();
        field_bytes(1, &context, &mut payload);
        field_bytes(2, &exit, &mut payload);
        field_varint(3, 257, &mut payload);
        field_bytes(6, path_or_address, &mut payload);
        payload
    }

    #[test]
    fn a_failed_open_carries_its_path_and_errno() {
        let event = decode_packet(&packet(
            MESSAGE_SYSCALL_OPEN,
            3,
            &failed_call(b"/etc/shadow", 2),
        ))
        .expect("decode");
        assert_eq!(event.kind, TraceKind::Open);
        assert_eq!(event.dropped_count, 3);
        assert_eq!(event.pathname, "/etc/shadow");
        assert_eq!(event.sysno, 257);
        assert_eq!(
            event.exit,
            Some(TraceExit {
                result: -1,
                errno: 2
            })
        );
        assert_eq!(event.process_name, "cat");
        assert_eq!(event.container_id, "caw-1");
        assert_eq!(event.thread_group_id, 42);
        assert!(event.failed());
    }

    #[test]
    fn a_failed_execve_carries_its_path() {
        let event = decode_packet(&packet(
            MESSAGE_SYSCALL_EXECVE,
            0,
            &failed_call(b"/opt/tool", 2),
        ))
        .expect("decode");
        assert_eq!(event.kind, TraceKind::Execve);
        assert_eq!(event.pathname, "/opt/tool");
        assert!(event.failed());
    }

    #[test]
    fn a_loaded_program_carries_its_path_and_no_exit() {
        let mut context = Vec::new();
        field_bytes(9, b"true", &mut context);
        let mut payload = Vec::new();
        field_bytes(1, &context, &mut payload);
        field_bytes(2, b"/usr/bin/true", &mut payload);
        field_bytes(3, b"true", &mut payload);
        let event = decode_packet(&packet(MESSAGE_SENTRY_EXEC, 0, &payload)).expect("decode");
        assert_eq!(event.kind, TraceKind::ExecDone);
        assert_eq!(event.pathname, "/usr/bin/true");
        assert_eq!(event.process_name, "true");
        assert_eq!(event.exit, None);
        assert!(!event.failed());
    }

    #[test]
    fn a_connect_keeps_field_six_as_the_raw_address() {
        let address = [2u8, 0, 0, 80, 192, 0, 2, 1];
        let event = decode_packet(&packet(
            MESSAGE_SYSCALL_CONNECT,
            0,
            &failed_call(&address, 101),
        ))
        .expect("decode");
        assert_eq!(event.kind, TraceKind::Connect);
        assert_eq!(event.address, address);
        assert!(event.pathname.is_empty());
        assert_eq!(event.exit.map(|e| e.errno), Some(101));
    }

    #[test]
    fn an_enter_point_has_no_exit_and_did_not_fail() {
        let mut payload = Vec::new();
        field_bytes(6, b"/work/a", &mut payload);
        let event = decode_packet(&packet(MESSAGE_SYSCALL_OPEN, 0, &payload)).expect("decode");
        assert_eq!(event.exit, None);
        assert!(!event.failed());
    }

    #[test]
    fn a_successful_call_did_not_fail() {
        let mut exit = Vec::new();
        field_varint(1, 5, &mut exit);
        let mut payload = Vec::new();
        field_bytes(2, &exit, &mut payload);
        let event = decode_packet(&packet(MESSAGE_SYSCALL_OPEN, 0, &payload)).expect("decode");
        assert_eq!(
            event.exit,
            Some(TraceExit {
                result: 5,
                errno: 0
            })
        );
        assert!(!event.failed());
    }

    #[test]
    fn another_message_type_is_kept_without_its_payload() {
        let event = decode_packet(&packet(5, 9, &[0xff, 0xff, 0xff])).expect("decode");
        assert_eq!(event.kind, TraceKind::Other(5));
        assert_eq!(event.dropped_count, 9);
    }

    #[test]
    fn unknown_fields_and_fixed_width_fields_are_skipped() {
        let mut payload = Vec::new();
        field_varint(40, 7, &mut payload);
        varint((41 << 3) | 1, &mut payload);
        payload.extend_from_slice(&[0; 8]);
        varint((42 << 3) | 5, &mut payload);
        payload.extend_from_slice(&[0; 4]);
        field_bytes(6, b"/work/b", &mut payload);
        let event = decode_packet(&packet(MESSAGE_SYSCALL_OPEN, 0, &payload)).expect("decode");
        assert_eq!(event.pathname, "/work/b");
    }

    #[test]
    fn a_longer_header_moves_the_payload() {
        let mut payload = Vec::new();
        field_bytes(6, b"/work/c", &mut payload);
        let mut raw = Vec::new();
        raw.extend_from_slice(&12u16.to_le_bytes());
        raw.extend_from_slice(&MESSAGE_SYSCALL_OPEN.to_le_bytes());
        raw.extend_from_slice(&0u32.to_le_bytes());
        raw.extend_from_slice(&[0xaa; 4]);
        raw.extend_from_slice(&payload);
        let event = decode_packet(&raw).expect("decode");
        assert_eq!(event.pathname, "/work/c");
    }

    #[test]
    fn a_short_packet_is_refused() {
        assert_eq!(
            decode_packet(&[8, 0, 7]),
            Err(TraceError::ShortPacket { got: 3, want: 8 })
        );
        let mut raw = packet(MESSAGE_SYSCALL_OPEN, 0, &[]);
        raw[0] = 20;
        assert_eq!(
            decode_packet(&raw),
            Err(TraceError::ShortPacket { got: 8, want: 20 })
        );
        raw[0] = 4;
        assert_eq!(
            decode_packet(&raw),
            Err(TraceError::ShortPacket { got: 8, want: 8 })
        );
    }

    #[test]
    fn a_field_that_runs_past_the_end_is_refused() {
        let mut payload = Vec::new();
        varint((6 << 3) | 2, &mut payload);
        varint(50, &mut payload);
        payload.extend_from_slice(b"short");
        assert_eq!(
            decode_packet(&packet(MESSAGE_SYSCALL_OPEN, 0, &payload)),
            Err(TraceError::Truncated)
        );
    }

    #[test]
    fn a_varint_of_eleven_bytes_is_refused() {
        let payload = [0x80u8; 11];
        assert_eq!(
            decode_packet(&packet(MESSAGE_SYSCALL_OPEN, 0, &payload)),
            Err(TraceError::VarintTooLong)
        );
    }

    #[test]
    fn a_group_wire_type_is_refused() {
        let payload = [(1 << 3) | 3];
        assert_eq!(
            decode_packet(&packet(MESSAGE_SYSCALL_OPEN, 0, &payload)),
            Err(TraceError::WireType(3))
        );
    }

    #[test]
    fn the_handshake_round_trips() {
        assert_eq!(encode_handshake(1), vec![0x08, 0x01]);
        assert_eq!(decode_handshake(&encode_handshake(1)), Ok(1));
        assert_eq!(decode_handshake(&encode_handshake(300)), Ok(300));
        assert_eq!(decode_handshake(&[]), Ok(0));
    }
}
