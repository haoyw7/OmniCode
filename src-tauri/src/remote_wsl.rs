//! Distribution discovery only. Execution and bootstrap belong to the shared Host.
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

fn decode(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.iter().skip(1).step_by(2).any(|b| *b == 0) {
        String::from_utf16_lossy(
            &bytes
                .as_chunks::<2>()
                .0
                .iter()
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .collect::<Vec<_>>(),
        )
        .trim_start_matches('\u{feff}')
        .to_string()
    } else {
        String::from_utf8_lossy(bytes)
            .trim_start_matches('\u{feff}')
            .to_string()
    }
}

fn wsl_command() -> Result<Command, String> {
    if !cfg!(windows) {
        return Err("WSL environments require Windows.".into());
    }
    let mut command = Command::new("wsl.exe");
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    crate::hide_window_console(&mut command);
    Ok(command)
}

fn spawn(command: &mut Command) -> Result<Child, String> {
    command
        .spawn()
        .map_err(|_| "Could not start WSL. Install WSL and a Linux distribution first.".into())
}

/// Keeps the most recent output so a failed setup can report its last error.
fn capture(reader: impl Read + Send + 'static) -> Arc<Mutex<Vec<u8>>> {
    let tail = Arc::new(Mutex::new(Vec::new()));
    let sink = tail.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut chunk = [0u8; 4096];
        while let Ok(read) = reader.read(&mut chunk) {
            if read == 0 {
                break;
            }
            if let Ok(mut tail) = sink.lock() {
                tail.extend_from_slice(&chunk[..read]);
                let excess = tail.len().saturating_sub(64 * 1024);
                tail.drain(..excess);
            }
        }
    });
    tail
}

#[tauri::command(async)]
pub fn wsl_distributions() -> Result<Vec<String>, String> {
    let mut child = spawn(wsl_command()?.args(["--list", "--quiet"]))?;
    let stdout = capture(child.stdout.take().unwrap());
    let stderr = capture(child.stderr.take().unwrap());
    drop(child.stdin.take());
    let deadline = Instant::now() + Duration::from_secs(20);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("WSL did not respond. Check the WSL installation and retry.".into());
            }
        }
    };
    // Readers finish at EOF, shortly after the process exits.
    std::thread::sleep(Duration::from_millis(50));
    let output = decode(&stdout.lock().map(|b| b.clone()).unwrap_or_default());
    if !status.success() {
        let error = decode(&stderr.lock().map(|b| b.clone()).unwrap_or_default());
        return Err(if error.trim().is_empty() {
            output
        } else {
            error
        }
        .trim()
        .to_string());
    }
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_utf16_wsl_names_and_utf8_linux_output() {
        let names = "Ubuntu-26.04\r\n开发环境\r\n";
        let utf16: Vec<u8> = names.encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert_eq!(decode(&utf16), names);
        assert_eq!(decode("Linux ✓".as_bytes()), "Linux ✓");
    }
}
