// Dock line reader must not read one byte per await up to 4MiB.
// The source gate that proves the Base Node dock reads its lines with this crate is
// tests/source_gate.rs.
use tokio::io::{AsyncBufRead, AsyncBufReadExt};

pub const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;
pub const READ_CHUNK: usize = 64 * 1024;

fn from_utf8_line(buf: Vec<u8>) -> std::io::Result<String> {
    String::from_utf8(buf).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

/// Read one dock line with fill_buf and consume. Cap at max_bytes.
/// Do not await one byte per loop up to 4MiB.
pub async fn read_line_limited<R>(
    reader: &mut R,
    max_bytes: usize,
) -> std::io::Result<Option<String>>
where
    R: AsyncBufRead + Unpin,
{
    let mut buf = Vec::with_capacity(256.min(max_bytes.saturating_add(1)));
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return if buf.is_empty() {
                Ok(None)
            } else {
                Ok(Some(from_utf8_line(buf)?))
            };
        }
        if let Some(pos) = available.iter().position(|&b| b == b'\n') {
            if buf.len().saturating_add(pos) > max_bytes {
                reader.consume(pos.saturating_add(1));
                return Ok(None);
            }
            buf.extend_from_slice(&available[..pos]);
            reader.consume(pos.saturating_add(1));
            return Ok(Some(from_utf8_line(buf)?));
        }
        let n = available.len();
        if buf.len().saturating_add(n) > max_bytes {
            let room = max_bytes.saturating_sub(buf.len());
            let take = room.saturating_add(1).min(n);
            reader.consume(take);
            return Ok(None);
        }
        buf.extend_from_slice(available);
        reader.consume(n);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::pin::Pin;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::task::{Context, Poll};
    use tokio::io::ReadBuf;

    struct CountFill {
        data: Vec<u8>,
        pos: usize,
        fills: AtomicUsize,
        chunk: usize,
    }

    impl CountFill {
        fn new(data: Vec<u8>, chunk: usize) -> Self {
            Self {
                data,
                pos: 0,
                fills: AtomicUsize::new(0),
                chunk,
            }
        }
    }

    impl tokio::io::AsyncRead for CountFill {
        fn poll_read(
            self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
            buf: &mut ReadBuf<'_>,
        ) -> Poll<std::io::Result<()>> {
            let this = self.get_mut();
            if this.pos >= this.data.len() {
                return Poll::Ready(Ok(()));
            }
            let n = (this.data.len() - this.pos)
                .min(buf.remaining())
                .min(this.chunk);
            buf.put_slice(&this.data[this.pos..this.pos + n]);
            this.pos += n;
            Poll::Ready(Ok(()))
        }
    }

    impl AsyncBufRead for CountFill {
        fn poll_fill_buf(
            self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
        ) -> Poll<std::io::Result<&[u8]>> {
            let this = self.get_mut();
            this.fills.fetch_add(1, Ordering::SeqCst);
            if this.pos >= this.data.len() {
                return Poll::Ready(Ok(&[]));
            }
            let end = (this.pos + this.chunk).min(this.data.len());
            Poll::Ready(Ok(&this.data[this.pos..end]))
        }

        fn consume(self: Pin<&mut Self>, amt: usize) {
            let this = self.get_mut();
            this.pos = this.pos.saturating_add(amt).min(this.data.len());
        }
    }

    #[test]
    fn ticket_id() {
        assert_eq!(MAX_LINE_BYTES, 4 * 1024 * 1024);
        assert_eq!(READ_CHUNK, 64 * 1024);
    }

    #[tokio::test]
    async fn reads_line_without_newline_at_eof() {
        let mut r = tokio::io::BufReader::new(&b"partial"[..]);
        let got = read_line_limited(&mut r, 64).await.unwrap();
        assert_eq!(got, Some(String::from("partial")));
    }

    #[tokio::test]
    async fn empty_eof_is_none() {
        let mut r = tokio::io::BufReader::new(&b""[..]);
        let got = read_line_limited(&mut r, 64).await.unwrap();
        assert!(got.is_none());
    }

    #[tokio::test]
    async fn strips_newline_keeps_cr() {
        let mut r = tokio::io::BufReader::new(&b"ab\r\ncd\n"[..]);
        let first = read_line_limited(&mut r, 64).await.unwrap();
        let second = read_line_limited(&mut r, 64).await.unwrap();
        assert_eq!(first, Some(String::from("ab\r")));
        assert_eq!(second, Some(String::from("cd")));
    }

    #[tokio::test]
    async fn exact_max_then_newline_is_some() {
        let mut r = tokio::io::BufReader::new(&b"abc\n"[..]);
        let got = read_line_limited(&mut r, 3).await.unwrap();
        assert_eq!(got, Some(String::from("abc")));
    }

    #[tokio::test]
    async fn oversize_without_newline_is_none() {
        let mut r = tokio::io::BufReader::new(&b"abcdef"[..]);
        let got = read_line_limited(&mut r, 3).await.unwrap();
        assert!(got.is_none());
    }

    #[tokio::test]
    async fn oversize_before_newline_is_none() {
        let mut r = tokio::io::BufReader::new(&b"abcdef\n"[..]);
        let got = read_line_limited(&mut r, 3).await.unwrap();
        assert!(got.is_none());
    }

    #[tokio::test]
    async fn invalid_utf8_is_error() {
        let mut r = tokio::io::BufReader::new(&[0xff, b'\n'][..]);
        let got = read_line_limited(&mut r, 16).await;
        assert!(got.is_err());
    }

    #[tokio::test]
    async fn fill_buf_count_is_chunked_not_one_byte() {
        let mut data = vec![b'x'; 4000];
        data.push(b'\n');
        let mut r = CountFill::new(data, 512);
        let got = read_line_limited(&mut r, MAX_LINE_BYTES).await.unwrap();
        assert_eq!(got.as_deref(), Some("x".repeat(4000).as_str()));
        let fills = r.fills.load(Ordering::SeqCst);
        assert!(fills > 0);
        assert!(fills <= 16);
    }

    #[tokio::test]
    async fn newline_across_chunk_boundary() {
        let mut data = vec![b'a'; 500];
        data.push(b'\n');
        data.extend_from_slice(b"z\n");
        let mut r = CountFill::new(data, 256);
        let first = read_line_limited(&mut r, 1024).await.unwrap();
        let second = read_line_limited(&mut r, 1024).await.unwrap();
        assert_eq!(first.as_deref(), Some("a".repeat(500).as_str()));
        assert_eq!(second, Some(String::from("z")));
    }
}
