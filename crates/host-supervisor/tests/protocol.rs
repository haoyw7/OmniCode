#![cfg(unix)]

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

struct Supervisor {
    child: std::process::Child,
    messages: mpsc::Receiver<Value>,
}

impl Supervisor {
    fn start() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_monocode-supervisor"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let (send, messages) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if send.send(serde_json::from_str(&line).unwrap()).is_err() {
                    break;
                }
            }
        });
        let supervisor = Self { child, messages };
        assert_eq!(supervisor.next(|m| m["event"] == "ready")["protocol"], 1);
        supervisor
    }

    fn send(&mut self, message: Value) {
        let stdin = self.child.stdin.as_mut().unwrap();
        writeln!(stdin, "{message}").unwrap();
    }

    fn next(&self, matches: impl Fn(&Value) -> bool) -> Value {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            let message = self
                .messages
                .recv_timeout(left)
                .expect("supervisor message");
            if matches(&message) {
                return message;
            }
        }
    }

    fn spawn(&mut self, id: u64, session: &str, script: &str) -> u64 {
        self.send(json!({
            "id": id, "op": "spawn", "sessionId": session, "command": "sh",
            "args": ["-c", script], "cwd": std::env::temp_dir(),
            "env": { "PATH": std::env::var("PATH").unwrap() },
        }));
        self.next(|m| m["id"] == id)["ok"].as_u64().expect("pid")
    }
}

fn alive(pid: u64) -> bool {
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

fn wait_dead(pid: u64) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while alive(pid) {
        assert!(Instant::now() < deadline, "process {pid} survived");
        thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn echoes_writes_and_reports_the_exit() {
    let mut supervisor = Supervisor::start();
    let pid = supervisor.spawn(1, "echo", "read line; echo \"got $line\"");
    supervisor.send(json!({ "id": 2, "op": "write", "sessionId": "echo", "line": "ping" }));
    assert_eq!(supervisor.next(|m| m["id"] == 2)["ok"], Value::Null);
    let line = supervisor.next(|m| m["event"] == "stdout");
    assert_eq!(
        (line["line"].as_str(), line["pid"].as_u64()),
        (Some("got ping"), Some(pid))
    );
    let exit = supervisor.next(|m| m["event"] == "exit");
    assert_eq!(
        (exit["code"].as_i64(), exit["pid"].as_u64()),
        (Some(0), Some(pid))
    );
}

#[test]
fn stops_an_oversized_provider_with_its_limit_error() {
    let mut supervisor = Supervisor::start();
    // 9 MiB of stderr without a newline, then the provider keeps running.
    let pid = supervisor.spawn(
        1,
        "noisy",
        "head -c 9437184 /dev/zero | tr '\\0' x >&2; sleep 30",
    );
    let exit = supervisor.next(|m| m["event"] == "exit");
    assert_eq!(
        (exit["error"].as_str(), exit["pid"].as_u64()),
        (Some("diagnostic_limit"), Some(pid))
    );
    wait_dead(pid);
}

#[test]
fn closing_the_host_pipe_stops_every_tree() {
    let mut supervisor = Supervisor::start();
    let first = supervisor.spawn(1, "a", "trap '' TERM; sleep 30 & echo $!; wait");
    let descendant: u64 = supervisor.next(|m| m["event"] == "stdout")["line"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let second = supervisor.spawn(2, "b", "sleep 30");
    drop(supervisor.child.stdin.take());
    supervisor.child.wait().unwrap();
    for pid in [first, descendant, second] {
        wait_dead(pid);
    }
}
