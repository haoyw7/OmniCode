//! Private, pipe-owned PTY process. No GUI runtime and no detach/reconnect path.
use super::*;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::PathBuf;
use std::sync::mpsc;

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum GuardCommand {
    Start {
        cwd: PathBuf,
        cols: u16,
        rows: u16,
        path: String,
    },
    Input {
        data: String,
    },
    Resize {
        cols: u16,
        rows: u16,
    },
    Status,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(super) enum GuardEvent {
    Ready,
    Data {
        data: String,
    },
    Status {
        foreground: Option<String>,
    },
    Error {
        message: String,
    },
    /// Emitted only after the owned process tree has stopped and its lease is released.
    Exited {
        code: Option<i32>,
    },
}
type Output = Arc<Mutex<std::io::Stdout>>;
fn emit(output: &Output, event: &GuardEvent) -> Result<(), String> {
    let mut output = output.lock().unwrap_or_else(|e| e.into_inner());
    serde_json::to_writer(&mut *output, event).map_err(|e| e.to_string())?;
    output
        .write_all(b"\n")
        .and_then(|_| output.flush())
        .map_err(|e| e.to_string())
}

pub(super) fn run() -> i32 {
    let output = Arc::new(Mutex::new(std::io::stdout()));
    match serve(output.clone()) {
        Ok(()) => 0,
        Err(message) => {
            let _ = emit(&output, &GuardEvent::Error { message });
            1
        }
    }
}
fn serve(output: Output) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    unsafe {
        // Reap orphaned jobs, including shell job-control groups, before releasing the lease.
        if libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    #[cfg(windows)]
    crate::windows::initialize().map_err(|e| e.to_string())?;
    let (tx, rx) = mpsc::channel();
    // EOF detection must not wait behind PTY output or input writes.
    let disconnected = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let input_disconnected = disconnected.clone();
    thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else {
                break;
            };
            let Ok(command) = serde_json::from_str::<GuardCommand>(&line) else {
                break;
            };
            if tx.send(command).is_err() {
                break;
            }
        }
        input_disconnected.store(true, std::sync::atomic::Ordering::SeqCst);
    });
    let Ok(GuardCommand::Start {
        cwd,
        cols,
        rows,
        path,
    }) = rx.recv()
    else {
        return Ok(());
    };
    if disconnected.load(std::sync::atomic::Ordering::SeqCst) {
        return Ok(());
    }
    #[cfg(not(test))]
    let lease = crate::local_host::claim_checkout_process_resource(
        &cwd,
        &format!("pty-guard:{}", uuid::Uuid::new_v4()),
    )?;
    #[cfg(test)]
    let lease: Option<crate::local_host::SharedResourceLease> = None;
    // The lease belongs to this guard until *all* terminal jobs exit.
    let mut terminal = Terminal::spawn(&cwd, cols, rows, &path)?;
    let reader = terminal.reader.take().ok_or("Terminal reader is missing")?;
    let reader_output = output.clone();
    let reader_thread = thread::spawn(move || pump(reader, reader_output));
    // A stopped terminal can leave its input pipe full. Never let that block
    // the owner loop from observing GUI death and killing the process tree.
    let (input_tx, input_rx) = mpsc::sync_channel::<String>(64);
    let mut writer = terminal.writer.take().ok_or("Terminal writer is missing")?;
    let writer_thread = thread::spawn(move || {
        while let Ok(data) = input_rx.recv() {
            if writer
                .write_all(data.as_bytes())
                .and_then(|_| writer.flush())
                .is_err()
            {
                break;
            }
        }
    });
    let result: Result<Option<i32>, String> = (|| {
        if disconnected.load(std::sync::atomic::Ordering::SeqCst) {
            return Ok(None);
        }
        emit(&output, &GuardEvent::Ready)?;
        loop {
            if disconnected.load(std::sync::atomic::Ordering::SeqCst) {
                return Ok(None);
            }
            if let Some(code) = terminal.exited()? {
                return Ok(Some(code));
            }
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok(GuardCommand::Input { data }) => input_tx
                    .try_send(data)
                    .map_err(|e| format!("Terminal input unavailable: {e}"))?,
                Ok(GuardCommand::Resize { cols, rows }) => {
                    terminal.resize(cols.max(2), rows.max(2))?
                }
                Ok(GuardCommand::Status) => emit(
                    &output,
                    &GuardEvent::Status {
                        foreground: terminal.foreground(),
                    },
                )?,
                Ok(GuardCommand::Start { .. }) => return Err("Terminal has already started".into()),
                Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(None),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
        }
    })();
    // Never let an I/O failure skip process cleanup, and never clear a live lease.
    while let Err(message) = terminal.stop() {
        eprintln!("Terminal cleanup retained its reservation: {message}");
        thread::sleep(Duration::from_secs(1));
    }
    drop(input_tx);
    let _ = writer_thread.join();
    drop(terminal);
    let _ = reader_thread.join();
    drop(lease);
    let code = result?;
    // A disconnected UI no longer consumes output; cleanup has still completed.
    let _ = emit(&output, &GuardEvent::Exited { code });
    Ok(())
}

#[cfg(unix)]
type Reader = std::fs::File;
#[cfg(windows)]
type Reader = Box<dyn Read + Send>;
fn pump(mut reader: Reader, output: Output) {
    let mut bytes = vec![0; READ_CHUNK];
    while let Ok(n) = reader.read(&mut bytes) {
        if n == 0 {
            break;
        }
        #[cfg(unix)]
        let mut accumulated = bytes[..n].to_vec();
        #[cfg(windows)]
        let accumulated = bytes[..n].to_vec();
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            let started = Instant::now();
            while !pty_should_flush(accumulated.len(), started.elapsed())
                && wait_readable(
                    reader.as_raw_fd(),
                    PTY_COALESCE.saturating_sub(started.elapsed()),
                )
            {
                match reader.read(&mut bytes) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => accumulated.extend_from_slice(&bytes[..n]),
                }
            }
        }
        #[cfg(windows)]
        thread::sleep(PTY_COALESCE);
        let data = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, accumulated);
        if emit(&output, &GuardEvent::Data { data }).is_err() {
            break;
        }
    }
}

struct Terminal {
    pid: u32,
    reader: Option<Reader>,
    #[cfg(unix)]
    child: std::process::Child,
    #[cfg(unix)]
    master: std::fs::File,
    writer: Option<Box<dyn Write + Send>>,
    #[cfg(windows)]
    child: Box<dyn portable_pty::Child + Send + Sync>,
    #[cfg(windows)]
    master: Box<dyn portable_pty::MasterPty + Send>,
}
impl Terminal {
    #[cfg(unix)]
    fn spawn(cwd: &std::path::Path, cols: u16, rows: u16, path: &str) -> Result<Self, String> {
        use std::os::fd::{AsRawFd, FromRawFd};
        use std::os::unix::process::CommandExt;
        let (master, slave) = open_pty(cols, rows)?;
        set_cloexec(master);
        set_cloexec(slave);
        let master = unsafe { std::fs::File::from_raw_fd(master) };
        let slave = unsafe { std::fs::File::from_raw_fd(slave) };
        let reader = master.try_clone().map_err(|e| e.to_string())?;
        let writer = master.try_clone().map_err(|e| e.to_string())?;
        let (shell, args) = default_shell();
        let mut command = Command::new(shell);
        command
            .args(args)
            .current_dir(cwd)
            .stdin(dup_stdio(slave.as_raw_fd())?)
            .stdout(dup_stdio(slave.as_raw_fd())?)
            .stderr(dup_stdio(slave.as_raw_fd())?)
            .env("TERM", "xterm-256color")
            .env("COLORTERM", "truecolor")
            .env("COLORFGBG", "15;0")
            .env("TERM_PROGRAM", "MonoCode")
            .env("PATH", path)
            .env("PWD", cwd);
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() < 0 {
                    return Err(std::io::Error::last_os_error());
                }
                let _ = libc::ioctl(0, libc::TIOCSCTTY as _, 0);
                Ok(())
            });
        }
        let child = command.spawn().map_err(|e| e.to_string())?;
        Ok(Self {
            pid: child.id(),
            child,
            master,
            writer: Some(Box::new(writer)),
            reader: Some(reader),
        })
    }
    #[cfg(windows)]
    fn spawn(cwd: &std::path::Path, cols: u16, rows: u16, path: &str) -> Result<Self, String> {
        use portable_pty::{native_pty_system, CommandBuilder, PtySize};
        let pair = native_pty_system()
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let wsl = crate::wsl_path::parse(&cwd.to_string_lossy())?;
        let (shell, args) = wsl
            .as_ref()
            .map_or_else(default_shell, |target| target.shell());
        let mut command = CommandBuilder::new(shell);
        command.args(args);
        if wsl.is_none() {
            command.cwd(cwd);
        }
        for (name, value) in [
            ("TERM", "xterm-256color"),
            ("COLORTERM", "truecolor"),
            ("COLORFGBG", "15;0"),
            ("TERM_PROGRAM", "MonoCode"),
            ("PATH", path),
        ] {
            command.env(name, value);
        }
        let child = crate::windows::spawn_pty(pair.slave.as_ref(), command)?;
        Ok(Self {
            pid: child.process_id().unwrap_or(0),
            child,
            master: pair.master,
            writer: Some(writer),
            reader: Some(reader),
        })
    }
    fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            resize_fd(self.master.as_raw_fd(), cols, rows)
        }
        #[cfg(windows)]
        {
            self.master
                .resize(portable_pty::PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| e.to_string())
        }
    }
    fn foreground(&self) -> Option<String> {
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            foreground_label(self.master.as_raw_fd(), self.pid)
        }
        #[cfg(windows)]
        {
            None
        }
    }
    fn exited(&mut self) -> Result<Option<i32>, String> {
        let status = self.child.try_wait().map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            Ok(status.map(|s| s.code().unwrap_or(1)))
        }
        #[cfg(windows)]
        {
            Ok(status.map(|s| s.exit_code() as i32))
        }
    }
    #[cfg(unix)]
    fn stop(&mut self) -> Result<(), String> {
        let groups = terminal_groups(self.pid)?;
        monocode_process_tree::terminate_all(&groups);
        let _ = self.child.wait();
        #[cfg(target_os = "linux")]
        unsafe {
            while libc::waitpid(-1, std::ptr::null_mut(), libc::WNOHANG) > 0 {}
        }
        if terminal_groups(self.pid)?.is_empty() {
            Ok(())
        } else {
            Err("Terminal processes have not exited".into())
        }
    }
    #[cfg(windows)]
    fn stop(&mut self) -> Result<(), String> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::{
            JobObjectBasicAccountingInformation, QueryInformationJobObject, TerminateJobObject,
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
        };
        let job = monocode_process_tree::managed_job().map_err(|e| e.to_string())?;
        unsafe {
            if TerminateJobObject(job.as_raw_handle(), 1) == 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let _ = self.child.wait();
            let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = std::mem::zeroed();
            if QueryInformationJobObject(
                job.as_raw_handle(),
                JobObjectBasicAccountingInformation,
                &mut info as *mut _ as *mut _,
                std::mem::size_of_val(&info) as u32,
                std::ptr::null_mut(),
            ) == 0
            {
                return Err(std::io::Error::last_os_error().to_string());
            }
            if info.ActiveProcesses != 0 {
                return Err(format!("Terminal {} jobs have not exited", self.pid));
            }
        }
        Ok(())
    }
}

/// Job-control children have their own process groups. Include the entire PTY
/// session, and on Linux also escaped descendants adopted by this subreaper.
#[cfg(unix)]
fn terminal_groups(shell: u32) -> Result<Vec<u32>, String> {
    let mut groups = std::collections::BTreeSet::new();
    #[cfg(target_os = "linux")]
    {
        let mut processes = Vec::new();
        for entry in std::fs::read_dir("/proc")
            .map_err(|e| e.to_string())?
            .flatten()
        {
            let Some(pid) = entry
                .file_name()
                .to_str()
                .and_then(|s| s.parse::<u32>().ok())
            else {
                continue;
            };
            let Ok(stat) = std::fs::read_to_string(entry.path().join("stat")) else {
                continue;
            };
            let Some((_, tail)) = stat.rsplit_once(") ") else {
                continue;
            };
            let fields: Vec<_> = tail.split_whitespace().collect();
            if fields.len() < 4 || fields[0] == "Z" {
                continue;
            }
            if let (Ok(parent), Ok(group), Ok(session)) = (
                fields[1].parse::<u32>(),
                fields[2].parse::<u32>(),
                fields[3].parse::<u32>(),
            ) {
                processes.push((pid, parent, group, session));
            }
        }
        let mut owned = std::collections::HashSet::from([std::process::id()]);
        loop {
            let before = owned.len();
            for &(pid, parent, group, session) in &processes {
                if pid != std::process::id() && (owned.contains(&parent) || session == shell) {
                    owned.insert(pid);
                    groups.insert(group);
                }
            }
            if before == owned.len() {
                break;
            }
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let result = Command::new("ps")
            .args(["-axo", "pid="])
            .output()
            .map_err(|e| e.to_string())?;
        if !result.status.success() {
            return Err("Could not inspect terminal processes".into());
        }
        for pid in String::from_utf8_lossy(&result.stdout)
            .split_whitespace()
            .filter_map(|s| s.parse::<i32>().ok())
        {
            unsafe {
                if libc::getsid(pid) == shell as i32 {
                    let group = libc::getpgid(pid);
                    if group > 1 {
                        groups.insert(group as u32);
                    }
                }
            }
        }
    }
    groups.remove(&(unsafe { libc::getpgrp() } as u32));
    groups.retain(|pid| *pid > 1);
    Ok(groups.into_iter().collect())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::Child;

    #[test]
    #[ignore = "subprocess entry point"]
    fn guard_process() {
        if std::env::var_os("MONOCODE_TEST_TERMINAL_GUARD").is_some() {
            std::process::exit(run());
        }
    }
    fn launch(cwd: &std::path::Path) -> Child {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "pty::guard::tests::guard_process",
                "--ignored",
                "--nocapture",
            ])
            .env("MONOCODE_TEST_TERMINAL_GUARD", "1")
            .env("SHELL", "/bin/sh")
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        command.spawn().unwrap()
    }
    fn send(child: &mut Child, command: GuardCommand) {
        let input = child.stdin.as_mut().unwrap();
        serde_json::to_writer(&mut *input, &command).unwrap();
        input.write_all(b"\n").unwrap();
        input.flush().unwrap();
    }
    fn start(child: &mut Child, root: &std::path::Path) {
        send(
            child,
            GuardCommand::Start {
                cwd: root.into(),
                cols: 80,
                rows: 24,
                path: std::env::var("PATH").unwrap(),
            },
        );
    }
    fn root() -> PathBuf {
        let path = std::env::temp_dir().join(format!("monocode-terminal-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }
    fn wait_for(mut condition: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(8);
        while !condition() {
            assert!(Instant::now() < deadline, "terminal condition timed out");
            thread::sleep(Duration::from_millis(20));
        }
    }
    fn alive(pid: u32) -> bool {
        #[cfg(target_os = "linux")]
        if let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) {
            if stat
                .rsplit_once(") ")
                .is_some_and(|(_, tail)| tail.starts_with('Z'))
            {
                return false;
            }
        }
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    fn pids(root: &std::path::Path) -> Vec<u32> {
        wait_for(|| {
            std::fs::read_to_string(root.join("pids"))
                .is_ok_and(|s| s.split_whitespace().count() == 2)
        });
        std::fs::read_to_string(root.join("pids"))
            .unwrap()
            .split_whitespace()
            .map(|s| s.parse().unwrap())
            .collect()
    }
    fn run_jobs(child: &mut Child) {
        send(
            child,
            GuardCommand::Input {
                data: "sleep 60 & printf '%s %s' $$ $! > pids\n".into(),
            },
        );
    }
    #[test]
    fn eof_cleans_shell_jobs_and_preserves_an_unrelated_process() {
        let root = root();
        let mut other = Command::new("sleep").arg("60").spawn().unwrap();
        let mut child = launch(&root);
        start(&mut child, &root);
        run_jobs(&mut child);
        let pids = pids(&root);
        assert!(pids.iter().all(|pid| alive(*pid)));
        // Keeping the connection open (including hidden UI) must keep jobs alive.
        thread::sleep(Duration::from_millis(150));
        assert!(pids.iter().all(|pid| alive(*pid)));
        child.stdin.take();
        wait_for(|| child.try_wait().unwrap().is_some());
        assert!(pids.iter().all(|pid| !alive(*pid)));
        assert!(other.try_wait().unwrap().is_none());
        other.kill().unwrap();
        other.wait().unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn eof_during_startup_cannot_leave_a_terminal() {
        let root = root();
        let mut child = launch(&root);
        start(&mut child, &root);
        child.stdin.take();
        wait_for(|| child.try_wait().unwrap().is_some());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn input_output_resize_and_natural_exit_keep_the_protocol() {
        let root = root();
        let mut child = launch(&root);
        start(&mut child, &root);
        send(&mut child, GuardCommand::Resize { cols: 93, rows: 31 });
        send(
            &mut child,
            GuardCommand::Input {
                data: "stty size; printf 'terminal-marker\\n'; exit 7\n".into(),
            },
        );
        let output = child.stdout.take().unwrap();
        let reader = thread::spawn(move || {
            BufReader::new(output)
                .lines()
                .map_while(Result::ok)
                .filter_map(|s| serde_json::from_str::<GuardEvent>(&s).ok())
                .collect::<Vec<_>>()
        });
        wait_for(|| child.try_wait().unwrap().is_some());
        let events = reader.join().unwrap();
        let data: Vec<u8> = events
            .iter()
            .filter_map(|event| match event {
                GuardEvent::Data { data } => Some(
                    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data)
                        .unwrap(),
                ),
                _ => None,
            })
            .flatten()
            .collect();
        let text = String::from_utf8_lossy(&data);
        assert!(text.contains("31 93"), "{text}");
        assert!(text.contains("terminal-marker"));
        assert!(matches!(
            events.last(),
            Some(GuardEvent::Exited { code: Some(7) })
        ));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    #[ignore = "subprocess entry point"]
    fn owner_process() {
        if let Some(root) = std::env::var_os("MONOCODE_TEST_TERMINAL_OWNER") {
            let root = PathBuf::from(root);
            let mut child = launch(&root);
            start(&mut child, &root);
            run_jobs(&mut child);
            let _ = pids(&root);
            std::fs::write(root.join("owner-ready"), child.id().to_string()).unwrap();
            loop {
                thread::sleep(Duration::from_secs(1));
            }
        }
    }
    #[test]
    fn killing_the_owner_closes_its_pipe_and_cleans_the_terminal() {
        let root = root();
        let mut owner = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "pty::guard::tests::owner_process",
                "--ignored",
                "--nocapture",
            ])
            .env("MONOCODE_TEST_TERMINAL_OWNER", &root)
            .stdout(Stdio::null())
            .spawn()
            .unwrap();
        wait_for(|| root.join("owner-ready").exists());
        let pids = pids(&root);
        owner.kill().unwrap();
        owner.wait().unwrap();
        wait_for(|| pids.iter().all(|pid| !alive(*pid)));
        std::fs::remove_dir_all(root).unwrap();
    }
}
