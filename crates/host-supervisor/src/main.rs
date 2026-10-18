//! Provider process supervisor for the headless MonoCode Host.
//!
//! The Host talks to this process over newline-delimited JSON on stdio:
//! requests `{"id":1,"op":"spawn"|"write"|"kill"|"killAll",...}` are answered
//! with `{"id":1,"ok":...}` or `{"id":1,"error":"..."}`, and provider output
//! arrives as `{"event":"stdout"|"stderr"|"exit",...}`. When the Host's end of
//! stdin closes, even after a hard crash, every provider tree is stopped.

mod lines;

use std::collections::HashMap;
use std::io::{self, BufRead, BufWriter, Write};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;
#[cfg(not(windows))]
use std::time::Instant;

use monocode_process_tree::{signal_tree, spawn_managed, terminate_all, TreeSignal};
use serde::Deserialize;
use serde_json::{json, Value};

/// A 20 MiB image becomes about 27 MiB in a protocol event. Leave room for
/// several images and old inline-image history without unbounded buffering.
const MAX_OUTPUT_BYTES: usize = 64 * 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES: usize = 8 * 1024 * 1024;
/// How long a stopped provider may take to exit before its tree is killed.
#[cfg(not(windows))]
const KILL_GRACE: Duration = Duration::from_secs(3);
#[cfg(windows)]
const KILL_GRACE: Duration = Duration::from_secs(1);
/// Descendants left in the group after the provider exits get this long.
#[cfg(not(windows))]
const ORPHAN_GRACE: Duration = Duration::from_secs(1);
const PROTOCOL_VERSION: u32 = 1;

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
enum Op {
    Spawn {
        session_id: String,
        command: String,
        args: Vec<String>,
        cwd: String,
        env: HashMap<String, String>,
    },
    Write {
        session_id: String,
        line: String,
    },
    Kill {
        session_id: String,
    },
    KillAll,
}

#[derive(Deserialize)]
struct Request {
    id: u64,
    #[serde(flatten)]
    op: Op,
}

/// Set once the provider's leader has exited and its output is drained.
#[derive(Default)]
struct Exited {
    done: Mutex<bool>,
    changed: Condvar,
}

impl Exited {
    fn finish(&self) {
        *self.done.lock().unwrap_or_else(|e| e.into_inner()) = true;
        self.changed.notify_all();
    }

    fn wait(&self, timeout: Duration) -> bool {
        let done = self.done.lock().unwrap_or_else(|e| e.into_inner());
        let (done, _) = self
            .changed
            .wait_timeout_while(done, timeout, |done| !*done)
            .unwrap_or_else(|e| e.into_inner());
        *done
    }
}

struct Live {
    pid: u32,
    writes: mpsc::Sender<(u64, String)>,
    exited: Arc<Exited>,
}

struct Supervisor {
    out: Mutex<BufWriter<io::Stdout>>,
    children: Mutex<HashMap<String, Live>>,
}

impl Supervisor {
    fn children(&self) -> MutexGuard<'_, HashMap<String, Live>> {
        self.children.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn is_current(&self, session_id: &str, pid: u32) -> bool {
        self.children().get(session_id).map(|live| live.pid) == Some(pid)
    }

    fn remove_if_current(&self, session_id: &str, pid: u32) -> Option<Live> {
        let mut children = self.children();
        if children.get(session_id).map(|live| live.pid) != Some(pid) {
            return None;
        }
        children.remove(session_id)
    }

    /// The Host is the only reader. If it is gone, nothing may outlive it.
    fn send(&self, message: &Value) {
        let mut out = self.out.lock().unwrap_or_else(|e| e.into_inner());
        let written = serde_json::to_writer(&mut *out, message)
            .map_err(io::Error::from)
            .and_then(|()| out.write_all(b"\n"))
            .and_then(|()| out.flush());
        if written.is_err() {
            drop(out);
            self.shutdown();
        }
    }

    fn reply(&self, id: u64, result: Result<Value, String>) {
        self.send(&match result {
            Ok(value) => json!({ "id": id, "ok": value }),
            Err(error) => json!({ "id": id, "error": error }),
        });
    }

    fn shutdown(&self) -> ! {
        let pids: Vec<u32> = self.children().drain().map(|(_, live)| live.pid).collect();
        terminate_all(&pids);
        std::process::exit(0);
    }

    /// Replies itself, before any output, so the Host knows the pid first.
    fn spawn(
        self: &Arc<Self>,
        id: u64,
        session_id: String,
        command: String,
        args: Vec<String>,
        cwd: String,
        env: HashMap<String, String>,
    ) -> Result<(), String> {
        if let Some(previous) = self.children().remove(&session_id) {
            thread::spawn(move || stop(previous));
        }
        let mut cmd = Command::new(&command);
        cmd.args(&args)
            .current_dir(&cwd)
            .env_clear()
            .envs(&env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child =
            spawn_managed(&mut cmd).map_err(|e| format!("Failed to start {command}: {e}"))?;
        let pid = child.id();
        let (stdin, stdout, stderr) =
            match (child.stdin.take(), child.stdout.take(), child.stderr.take()) {
                (Some(stdin), Some(stdout), Some(stderr)) => (stdin, stdout, stderr),
                _ => {
                    terminate_all(&[pid]);
                    let _ = child.wait();
                    return Err("Failed to open provider stdio".into());
                }
            };
        let (writes, queue) = mpsc::channel();
        let exited = Arc::new(Exited::default());
        let overflow = Arc::new(Mutex::new(None));
        // Insert before any reader runs so the first line is already current.
        if let Some(raced) = self.children().insert(
            session_id.clone(),
            Live {
                pid,
                writes,
                exited: exited.clone(),
            },
        ) {
            thread::spawn(move || stop(raced));
        }

        self.reply(id, Ok(json!(pid)));
        let writer = self.clone();
        thread::spawn(move || write_queue(&writer, stdin, queue));
        let readers = [
            self.read(
                &session_id,
                pid,
                stdout,
                "stdout",
                MAX_OUTPUT_BYTES,
                "output_limit",
                &overflow,
            ),
            self.read(
                &session_id,
                pid,
                stderr,
                "stderr",
                MAX_DIAGNOSTIC_BYTES,
                "diagnostic_limit",
                &overflow,
            ),
        ];
        let waiter = self.clone();
        thread::spawn(move || {
            let code = child.wait().ok().and_then(|status| status.code());
            // A provider that exits owns nothing anymore: stop what it left in
            // its group, which would otherwise hold the output pipes open.
            #[cfg(not(windows))]
            if monocode_process_tree::tree_alive(pid) {
                signal_tree(pid, TreeSignal::Term);
                if !monocode_process_tree::wait_until_dead(&[pid], Instant::now() + ORPHAN_GRACE) {
                    signal_tree(pid, TreeSignal::Kill);
                }
            }
            for reader in readers {
                let _ = reader.join();
            }
            waiter.remove_if_current(&session_id, pid);
            exited.finish();
            let mut message =
                json!({ "event": "exit", "sessionId": session_id, "pid": pid, "code": code });
            if let Some(error) = *overflow.lock().unwrap_or_else(|e| e.into_inner()) {
                message["error"] = json!(error);
            }
            waiter.send(&message);
        });
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn read(
        self: &Arc<Self>,
        session_id: &str,
        pid: u32,
        stream: impl io::Read + Send + 'static,
        event: &'static str,
        max_bytes: usize,
        limit_error: &'static str,
        overflow: &Arc<Mutex<Option<&'static str>>>,
    ) -> thread::JoinHandle<()> {
        let supervisor = self.clone();
        let session_id = session_id.to_owned();
        let overflow = overflow.clone();
        thread::spawn(move || {
            let on_overflow = || {
                overflow
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .get_or_insert(limit_error);
                if let Some(live) = supervisor.remove_if_current(&session_id, pid) {
                    thread::spawn(move || stop(live));
                }
            };
            let on_line = |line: &[u8]| {
                if overflow.lock().unwrap_or_else(|e| e.into_inner()).is_some()
                    || !supervisor.is_current(&session_id, pid)
                {
                    return;
                }
                supervisor.send(&json!({
                    "event": event,
                    "sessionId": session_id,
                    "pid": pid,
                    "line": String::from_utf8_lossy(line),
                }));
            };
            lines::read_lines(stream, max_bytes, on_line, on_overflow);
        })
    }

    fn kill(&self, session_id: &str) {
        // Bind first: an `if let` scrutinee would hold the lock through `stop`.
        let live = self.children().remove(session_id);
        if let Some(live) = live {
            stop(live);
        }
    }

    fn kill_all(&self) {
        let children: Vec<Live> = self.children().drain().map(|(_, live)| live).collect();
        let pids: Vec<u32> = children.iter().map(|live| live.pid).collect();
        // Close stdin first so CLIs that watch the pipe can exit on their own.
        drop(children);
        terminate_all(&pids);
    }
}

/// Close stdin, ask the tree to stop, and kill it if it has not exited in time.
fn stop(live: Live) {
    let Live {
        pid,
        writes,
        exited,
    } = live;
    drop(writes);
    #[cfg(not(windows))]
    {
        signal_tree(pid, TreeSignal::Term);
        if !exited.wait(KILL_GRACE) {
            signal_tree(pid, TreeSignal::Kill);
            exited.wait(Duration::from_millis(500));
        }
    }
    #[cfg(windows)]
    {
        // Kill descendants while the leader still exists; closing stdin first
        // could let it exit and leave its children untraceable.
        signal_tree(pid, TreeSignal::Kill);
        exited.wait(KILL_GRACE);
    }
}

/// Writes for one provider stay in order; a child that stops draining stdin
/// blocks only its own queue, never the request loop or `kill`.
fn write_queue(
    supervisor: &Supervisor,
    mut stdin: ChildStdin,
    queue: mpsc::Receiver<(u64, String)>,
) {
    for (id, line) in queue {
        let result = stdin
            .write_all(line.as_bytes())
            .and_then(|()| stdin.write_all(b"\n"))
            .and_then(|()| stdin.flush())
            .map(|()| Value::Null)
            .map_err(|e| format!("Failed to write to provider: {e}"));
        supervisor.reply(id, result);
    }
}

fn main() {
    if let Err(error) = monocode_process_tree::initialize() {
        eprintln!("Process supervision is unavailable: {error}");
        std::process::exit(1);
    }
    let supervisor = Arc::new(Supervisor {
        out: Mutex::new(BufWriter::new(io::stdout())),
        children: Mutex::new(HashMap::new()),
    });
    supervisor.send(&json!({ "event": "ready", "protocol": PROTOCOL_VERSION }));
    let stdin = io::stdin().lock();
    for line in stdin.lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let request: Request = match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(error) => {
                eprintln!("Ignoring malformed supervisor request: {error}");
                continue;
            }
        };
        let id = request.id;
        match request.op {
            Op::Spawn {
                session_id,
                command,
                args,
                cwd,
                env,
            } => {
                if let Err(error) = supervisor.spawn(id, session_id, command, args, cwd, env) {
                    supervisor.reply(id, Err(error));
                }
            }
            Op::Write { session_id, line } => {
                let queued = supervisor
                    .children()
                    .get(&session_id)
                    .map(|live| live.writes.send((id, line)).is_ok());
                if queued != Some(true) {
                    supervisor.reply(id, Err("Provider process is not running".into()));
                }
            }
            Op::Kill { session_id } => {
                let supervisor = supervisor.clone();
                thread::spawn(move || {
                    supervisor.kill(&session_id);
                    supervisor.reply(id, Ok(Value::Null));
                });
            }
            Op::KillAll => {
                let supervisor = supervisor.clone();
                thread::spawn(move || {
                    supervisor.kill_all();
                    supervisor.reply(id, Ok(Value::Null));
                });
            }
        }
    }
    supervisor.shutdown();
}
