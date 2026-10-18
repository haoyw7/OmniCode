mod guard;
use crate::dirs_home;
use crate::fs::expand_home;
use guard::{GuardCommand, GuardEvent};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;
#[cfg(unix)]
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, State};

const DATA_EVENT: &str = "pty-data";
const EXIT_EVENT: &str = "pty-exit";
const READ_CHUNK: usize = 32 * 1024;
const PTY_COALESCE: Duration = Duration::from_millis(8);

pub(crate) fn run_guard() -> i32 {
    guard::run()
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PtyData {
    id: String,
    data: String,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PtyExit {
    id: String,
    code: Option<i32>,
}

struct LivePty {
    cwd: std::path::PathBuf,
    writer: Mutex<Option<ChildStdin>>,
    pid: u32,
    foreground: Mutex<Option<String>>,
    done: (Mutex<Option<Result<(), String>>>, Condvar),
}
impl LivePty {
    fn send(&self, command: &GuardCommand) -> Result<(), String> {
        let mut writer = self.writer.lock().unwrap_or_else(|e| e.into_inner());
        let pipe = writer.as_mut().ok_or("Terminal is stopping")?;
        serde_json::to_writer(&mut *pipe, command).map_err(|e| e.to_string())?;
        pipe.write_all(b"\n")
            .and_then(|_| pipe.flush())
            .map_err(|e| e.to_string())
    }
    fn disconnect(&self) {
        self.writer.lock().unwrap_or_else(|e| e.into_inner()).take();
    }
    fn stop(&self) -> Result<(), String> {
        self.stop_until(std::time::Instant::now() + Duration::from_secs(10))
    }
    fn stop_until(&self, deadline: std::time::Instant) -> Result<(), String> {
        // EOF is the shutdown request, including when the entire GUI crashes.
        self.disconnect();
        let (lock, changed) = &self.done;
        let (result, _) = changed
            .wait_timeout_while(
                lock.lock().unwrap_or_else(|e| e.into_inner()),
                deadline.saturating_duration_since(std::time::Instant::now()),
                |v| v.is_none(),
            )
            .unwrap_or_else(|e| e.into_inner());
        result.clone().unwrap_or_else(|| {
            Err("Terminal cleanup is still running; its workspace reservation was kept".into())
        })
    }
}

pub struct PtyHost {
    sessions: Mutex<HashMap<String, Arc<LivePty>>>,
    generation: std::sync::atomic::AtomicU64,
}
impl PtyHost {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            generation: std::sync::atomic::AtomicU64::new(0),
        }
    }
    pub(crate) fn has_working_dir(&self, path: &std::path::Path) -> bool {
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .any(|live| crate::worktrees::contains_working_dir(path, &live.cwd))
    }
    fn get(&self, id: &str) -> Option<Arc<LivePty>> {
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .cloned()
    }
    fn remove_if_pid(&self, id: &str, pid: u32) -> Option<Arc<LivePty>> {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if sessions.get(id).map(|live| live.pid) != Some(pid) {
            return None;
        }
        sessions.remove(id)
    }
    fn stop_all(&self) -> Result<(), String> {
        self.generation
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let children: Vec<_> = self
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .cloned()
            .collect();
        for child in &children {
            child.disconnect();
        }
        let mut errors = Vec::new();
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        for child in children {
            if let Err(error) = child.stop_until(deadline) {
                errors.push(error);
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("\n"))
        }
    }
    pub(crate) fn kill_all(&self) {
        if let Err(error) = self.stop_all() {
            eprintln!("Terminal cleanup: {error}");
        }
    }
}
impl Drop for PtyHost {
    fn drop(&mut self) {
        self.kill_all();
    }
}

#[tauri::command(async)]
pub fn pty_spawn(
    app: AppHandle,
    host: State<'_, PtyHost>,
    id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let generation = host.generation.load(std::sync::atomic::Ordering::SeqCst);
    let workdir = if crate::wsl_path::parse(&cwd)?.is_some() {
        if !cfg!(windows) {
            return Err("WSL terminals require Windows".into());
        }
        std::path::PathBuf::from(&cwd)
    } else {
        working_dir(&cwd)
    };
    let _reservation = crate::worktree_lifecycle::reserve_spawn(&workdir)?;
    if let Some(previous) = host.get(&id) {
        previous.stop()?;
    }
    let mut command = Command::new(std::env::current_exe().map_err(|e| e.to_string())?);
    command
        .arg("--internal-terminal-guard")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    crate::hide_window_console(&mut command);
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    let live = Arc::new(LivePty {
        cwd: workdir.clone(),
        writer: Mutex::new(child.stdin.take()),
        pid,
        foreground: Mutex::new(None),
        done: (Mutex::new(None), Condvar::new()),
    });
    let output = child
        .stdout
        .take()
        .ok_or("Terminal guard has no output pipe")?;
    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    let reader_live = live.clone();
    let reader_app = app.clone();
    let reader_id = id.clone();
    let reader = thread::spawn(move || {
        let mut ready = Some(ready_tx);
        let mut completed = false;
        for line in BufReader::new(output).lines() {
            let Ok(line) = line else {
                break;
            };
            match serde_json::from_str::<GuardEvent>(&line) {
                Ok(GuardEvent::Ready) => {
                    if let Some(tx) = ready.take() {
                        let _ = tx.send(Ok(()));
                    }
                }
                Ok(GuardEvent::Data { data }) => {
                    let _ = reader_app.emit(
                        DATA_EVENT,
                        PtyData {
                            id: reader_id.clone(),
                            data,
                        },
                    );
                }
                Ok(GuardEvent::Status { foreground }) => {
                    *reader_live
                        .foreground
                        .lock()
                        .unwrap_or_else(|e| e.into_inner()) = foreground;
                }
                Ok(GuardEvent::Exited { code }) => {
                    completed = true;
                    let _ = reader_app.emit(
                        EXIT_EVENT,
                        PtyExit {
                            id: reader_id.clone(),
                            code,
                        },
                    );
                }
                Ok(GuardEvent::Error { message }) => {
                    if let Some(tx) = ready.take() {
                        let _ = tx.send(Err(message.clone()));
                    }
                    eprintln!("Terminal guard: {message}");
                }
                Err(error) => {
                    eprintln!("Terminal guard protocol: {error}");
                    break;
                }
            }
        }
        if let Some(tx) = ready.take() {
            let _ = tx.send(Err("Terminal guard exited before startup".into()));
        }
        completed
    });
    let wait_live = live.clone();
    let wait_id = id.clone();
    thread::spawn(move || {
        let status = child.wait();
        let completed = reader.join().unwrap_or(false);
        let result = if completed && status.is_ok_and(|s| s.success()) {
            Ok(())
        } else {
            Err("Terminal guard exited without confirming cleanup".into())
        };
        *wait_live.done.0.lock().unwrap_or_else(|e| e.into_inner()) = Some(result);
        wait_live.done.1.notify_all();
        if let Some(host) = app.try_state::<PtyHost>() {
            host.remove_if_pid(&wait_id, pid);
        }
    });
    {
        let mut sessions = host.sessions.lock().unwrap_or_else(|e| e.into_inner());
        if host.generation.load(std::sync::atomic::Ordering::SeqCst) != generation {
            drop(sessions);
            live.stop()?;
            return Err("Terminal startup was cancelled".into());
        }
        // Concurrent respawns cannot orphan the losing guard.
        if let Some(previous) = sessions.insert(id.clone(), live.clone()) {
            previous.disconnect();
        }
    }
    let start = live.send(&GuardCommand::Start {
        cwd: workdir,
        cols: cols.max(2),
        rows: rows.max(2),
        path: crate::harness::gui_search_path(),
    });
    let result = start.and_then(|_| {
        ready_rx
            .recv_timeout(Duration::from_secs(15))
            .map_err(|_| "Terminal startup timed out".to_string())?
    });
    if result.is_err() {
        let _ = live.stop();
        host.remove_if_pid(&id, pid);
    }
    result
}
#[tauri::command]
pub fn pty_write(host: State<PtyHost>, id: String, data: String) -> Result<(), String> {
    host.get(&id)
        .ok_or("Terminal is not running")?
        .send(&GuardCommand::Input { data })
}
#[tauri::command]
pub fn pty_resize(host: State<PtyHost>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    host.get(&id)
        .ok_or("Terminal is not running")?
        .send(&GuardCommand::Resize {
            cols: cols.max(2),
            rows: rows.max(2),
        })
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PtyStatus {
    foreground: Option<String>,
}
#[tauri::command]
pub fn pty_status(host: State<PtyHost>, id: String) -> Result<PtyStatus, String> {
    let live = host.get(&id).ok_or("Terminal is not running")?;
    live.send(&GuardCommand::Status)?;
    let foreground = live
        .foreground
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    Ok(PtyStatus { foreground })
}
#[tauri::command(async)]
pub fn pty_kill(host: State<'_, PtyHost>, id: String) -> Result<(), String> {
    if let Some(live) = host.get(&id) {
        live.stop()?;
        host.remove_if_pid(&id, live.pid);
    }
    Ok(())
}
#[tauri::command(async)]
pub fn pty_kill_all(host: State<'_, PtyHost>) -> Result<(), String> {
    host.stop_all()
}

fn working_dir(cwd: &str) -> std::path::PathBuf {
    let path = expand_home(cwd);
    if path.is_dir() {
        return path;
    }
    dirs_home().map(std::path::PathBuf::from).unwrap_or(path)
}

fn default_shell() -> (String, Vec<String>) {
    #[cfg(windows)]
    {
        if let Ok(comspec) = std::env::var("COMSPEC") {
            if !comspec.is_empty() {
                return (comspec, Vec::new());
            }
        }
        ("powershell.exe".into(), vec!["-NoLogo".into()])
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|shell| !shell.is_empty())
            .unwrap_or_else(|| {
                if cfg!(target_os = "macos") {
                    "/bin/zsh".into()
                } else {
                    "/bin/bash".into()
                }
            });
        let args = login_args(&shell)
            .iter()
            .map(|arg| (*arg).to_string())
            .collect();
        (shell, args)
    }
}

#[cfg(not(windows))]
fn login_args(shell: &str) -> &'static [&'static str] {
    match std::path::Path::new(shell)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or(shell)
    {
        "zsh" | "bash" | "sh" | "fish" => &["-l"],
        _ => &[],
    }
}

#[cfg(unix)]
fn open_pty(cols: u16, rows: u16) -> Result<(i32, i32), String> {
    let master = unsafe { libc::posix_openpt(libc::O_RDWR | libc::O_NOCTTY) };
    if master < 0 {
        return Err(os_err("Failed to open terminal"));
    }
    if unsafe { libc::grantpt(master) } != 0 || unsafe { libc::unlockpt(master) } != 0 {
        close_fd(master);
        return Err(os_err("Failed to unlock terminal"));
    }
    let name = slave_name(master).inspect_err(|_| {
        close_fd(master);
    })?;
    let slave = unsafe { libc::open(name.as_ptr(), libc::O_RDWR | libc::O_NOCTTY) };
    if slave < 0 {
        close_fd(master);
        return Err(os_err("Failed to open terminal slave"));
    }
    if let Err(err) = resize_fd(master, cols, rows) {
        close_fd(master);
        close_fd(slave);
        return Err(err);
    }
    Ok((master, slave))
}

#[cfg(unix)]
fn slave_name(master: i32) -> Result<std::ffi::CString, String> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let mut buf = vec![0 as libc::c_char; 64];
        let ret = unsafe { libc::ptsname_r(master, buf.as_mut_ptr(), buf.len()) };
        if ret != 0 {
            return Err(os_err("Failed to resolve terminal name"));
        }
        let last = buf.len() - 1;
        buf[last] = 0;
        Ok(unsafe { std::ffi::CStr::from_ptr(buf.as_ptr()) }.to_owned())
    }

    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        let ptr = unsafe { libc::ptsname(master) };
        if ptr.is_null() {
            return Err(os_err("Failed to resolve terminal name"));
        }
        Ok(unsafe { std::ffi::CStr::from_ptr(ptr) }.to_owned())
    }
}

#[cfg(unix)]
fn resize_fd(fd: i32, cols: u16, rows: u16) -> Result<(), String> {
    let size = libc::winsize {
        ws_row: rows,
        ws_col: cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    if unsafe { libc::ioctl(fd, libc::TIOCSWINSZ, &size) } != 0 {
        return Err(os_err("Failed to resize terminal"));
    }
    Ok(())
}

#[cfg(unix)]
fn dup_fd(fd: i32) -> Result<i32, String> {
    let next = unsafe { libc::dup(fd) };
    if next < 0 {
        return Err(os_err("Failed to duplicate terminal"));
    }
    Ok(next)
}

#[cfg(unix)]
fn dup_stdio(fd: i32) -> Result<std::process::Stdio, String> {
    use std::os::unix::io::FromRawFd;
    let next = dup_fd(fd)?;
    Ok(unsafe { std::process::Stdio::from_raw_fd(next) })
}

#[cfg(unix)]
fn set_cloexec(fd: i32) {
    unsafe {
        let flags = libc::fcntl(fd, libc::F_GETFD);
        if flags >= 0 {
            libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC);
        }
    }
}

#[cfg(unix)]
fn close_fd(fd: i32) {
    if fd >= 0 {
        unsafe {
            libc::close(fd);
        }
    }
}

#[cfg(unix)]
fn os_err(ctx: &str) -> String {
    format!("{ctx}: {}", std::io::Error::last_os_error())
}

#[cfg(unix)]
fn pty_should_flush(buffered: usize, since: Duration) -> bool {
    buffered >= READ_CHUNK || since >= PTY_COALESCE
}

#[cfg(unix)]
fn wait_readable(fd: i32, timeout: Duration) -> bool {
    if timeout.is_zero() {
        return false;
    }
    let mut pollfd = libc::pollfd {
        fd,
        events: libc::POLLIN,
        revents: 0,
    };
    let ms = timeout.as_millis().min(i32::MAX as u128) as i32;
    unsafe { libc::poll(&mut pollfd, 1, ms) > 0 }
}

#[cfg(unix)]
fn foreground_label(master_fd: i32, shell_pid: u32) -> Option<String> {
    let mut pgrp: libc::pid_t = 0;
    if unsafe { libc::ioctl(master_fd, libc::TIOCGPGRP, &mut pgrp) } != 0 {
        return None;
    }
    let pid = pgrp;
    // An idle prompt is the common case; skip forking `ps` for it.
    if pid <= 0 || pid == shell_pid as i32 {
        return None;
    }
    let label = process_label(pid)?;
    if is_shell_name(&label) {
        return None;
    }
    Some(label)
}

#[cfg(unix)]
fn process_label(pid: i32) -> Option<String> {
    // Status is polled every second per busy terminal; procfs avoids a fork.
    #[cfg(target_os = "linux")]
    if let Some(args) = proc_cmdline(pid) {
        return command_label(&args);
    }
    use std::process::Command;
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "args="])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let args = raw.trim();
    if args.is_empty() {
        return None;
    }
    command_label(args)
}

#[cfg(target_os = "linux")]
fn proc_cmdline(pid: i32) -> Option<String> {
    let raw = std::fs::read(format!("/proc/{pid}/cmdline")).ok()?;
    // Arguments are NUL-separated; match `ps -o args=` spacing.
    let args = String::from_utf8_lossy(&raw).replace('\0', " ");
    let args = args.trim();
    (!args.is_empty()).then(|| args.to_string())
}

#[cfg(unix)]
fn command_label(args: &str) -> Option<String> {
    let parts: Vec<&str> = args.split_whitespace().collect();
    if parts.is_empty() {
        return None;
    }
    let exe = parts[0];
    let base = std::path::Path::new(exe)
        .file_name()
        .and_then(|name| name.to_str())?;
    if is_interpreter(base) {
        for part in parts.iter().skip(1) {
            if part.starts_with('-') {
                continue;
            }
            let name = std::path::Path::new(part)
                .file_name()
                .and_then(|name| name.to_str())?;
            if !name.starts_with('-') {
                return Some(name.to_string());
            }
        }
    }
    Some(base.to_string())
}

#[cfg(unix)]
fn is_interpreter(name: &str) -> bool {
    matches!(
        name,
        "node" | "nodejs" | "python" | "python3" | "ruby" | "deno" | "bun"
    )
}

#[cfg(unix)]
fn is_shell_name(name: &str) -> bool {
    matches!(
        name,
        "zsh" | "bash" | "sh" | "fish" | "nu" | "dash" | "ksh" | "tcsh" | "zsh5"
    )
}

#[cfg(all(test, unix))]
mod label_tests {
    use super::*;

    #[test]
    fn command_label_prefers_cli_over_interpreter() {
        assert_eq!(
            command_label("node /usr/local/bin/npm run build"),
            Some("npm".into())
        );
        assert_eq!(command_label("cargo build"), Some("cargo".into()));
    }

    #[test]
    fn shell_names_are_ignored() {
        assert!(is_shell_name("zsh"));
        assert!(!is_shell_name("npm"));
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn login_args_for_common_shells() {
        assert_eq!(login_args("/bin/zsh"), &["-l"]);
        assert_eq!(login_args("/bin/bash"), &["-l"]);
        assert_eq!(login_args("/usr/bin/fish"), &["-l"]);
        assert_eq!(login_args("/usr/local/bin/nu"), &[] as &[&str]);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn procfs_label_matches_the_running_test_binary() {
        let pid = std::process::id() as i32;
        let args = proc_cmdline(pid).expect("own cmdline");
        assert!(!args.contains('\0'));
        let exe = std::env::current_exe().unwrap();
        let name = exe.file_name().unwrap().to_str().unwrap();
        assert_eq!(process_label(pid).as_deref(), Some(name));
    }

    #[test]
    fn pty_flush_waits_for_a_full_chunk_or_the_coalesce_window() {
        assert!(!pty_should_flush(1, Duration::from_millis(1)));
        assert!(pty_should_flush(READ_CHUNK, Duration::from_millis(1)));
        assert!(pty_should_flush(1, PTY_COALESCE));
    }

    #[test]
    fn remove_if_pid_ignores_a_replaced_session() {
        let host = PtyHost::new();
        host.sessions.lock().unwrap().insert(
            "term".into(),
            Arc::new(LivePty {
                cwd: "/test".into(),
                writer: Mutex::new(None),
                pid: 42,
                foreground: Mutex::new(None),
                done: (Mutex::new(None), std::sync::Condvar::new()),
            }),
        );
        assert!(host.remove_if_pid("term", 7).is_none());
        assert!(host.get("term").is_some());
        assert!(host.remove_if_pid("term", 42).is_some());
    }
}
