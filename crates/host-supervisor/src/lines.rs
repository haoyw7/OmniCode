use std::io::{self, BufRead, BufReader};

/// Split `stream` into lines without a trailing `\r`, collecting each frame at
/// most once. A frame over `max_bytes` stops delivery, discards its tail and
/// calls `on_overflow` at once; the stream is then drained so the provider
/// never blocks on a full pipe while it is being stopped.
pub fn read_lines(
    stream: impl io::Read,
    max_bytes: usize,
    mut on_line: impl FnMut(&[u8]),
    on_overflow: impl FnOnce(),
) {
    let mut reader = BufReader::with_capacity(64 * 1024, stream);
    let mut pending = Vec::new();
    loop {
        let buffer = match reader.fill_buf() {
            Ok(buffer) => buffer,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => break,
        };
        if buffer.is_empty() {
            break;
        }
        let (part, consumed, complete) = match buffer.iter().position(|byte| *byte == b'\n') {
            Some(newline) => (&buffer[..newline], newline + 1, true),
            None => (buffer, buffer.len(), false),
        };
        if pending.len() + part.len() > max_bytes {
            reader.consume(consumed);
            on_overflow();
            let _ = io::copy(&mut reader, &mut io::sink());
            return;
        }
        pending.extend_from_slice(part);
        reader.consume(consumed);
        if complete {
            emit(&mut pending, &mut on_line);
        }
    }
    if !pending.is_empty() {
        emit(&mut pending, &mut on_line);
    }
}

fn emit(pending: &mut Vec<u8>, on_line: &mut impl FnMut(&[u8])) {
    let line = pending.strip_suffix(b"\r").unwrap_or(pending);
    on_line(line);
    pending.clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect(input: &[u8], max: usize) -> (Vec<String>, bool) {
        let mut lines = Vec::new();
        let mut overflowed = false;
        read_lines(
            input,
            max,
            |line| lines.push(String::from_utf8_lossy(line).into_owned()),
            || overflowed = true,
        );
        (lines, overflowed)
    }

    #[test]
    fn splits_lines_like_the_node_reader() {
        assert_eq!(
            collect(b"one\r\n\ntwo\nlast", 64),
            (
                vec!["one".into(), "".into(), "two".into(), "last".into()],
                false
            )
        );
    }

    #[test]
    fn stops_on_an_oversized_frame_without_emitting_its_tail() {
        assert_eq!(
            collect(b"ok\n0123456789\nafter\n", 8),
            (vec!["ok".into()], true)
        );
    }
}
