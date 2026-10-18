//! Provider process trees, spawned and stopped as a unit.
//!
//! Ported from the desktop harness (`src-tauri/src/harness.rs` and
//! `src-tauri/src/windows.rs`) so the headless Host supervisor shares the same
//! semantics: every child leads its own process group on Unix, and joins a
//! kill-on-close job object on Windows.

use std::io;
use std::process::{Child, Command};
#[cfg(not(windows))]
use std::thread;
#[cfg(not(windows))]
use std::time::{Duration, Instant};

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::managed_job;

#[cfg(not(windows))]
const KILL_ALL_GRACE: Duration = Duration::from_millis(300);
#[cfg(not(windows))]
const KILL_ALL_KILL_WAIT: Duration = Duration::from_millis(150);

/// Prepare the job object that owns every managed child. Its handle lives as
/// long as this process, so even a crash kills the registered trees.
pub fn initialize() -> io::Result<()> {
    #[cfg(windows)]
    {
        windows::managed_job().map(|_| ())
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

/// Spawn `cmd` as the leader of its own tree: a new process group on Unix, a
/// suspended-then-enrolled job member on Windows.
pub fn spawn_managed(cmd: &mut Command) -> io::Result<Child> {
    #[cfg(windows)]
    {
        windows::spawn_managed(cmd)
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
        spawn_retrying_text_file_busy(cmd)
    }
    #[cfg(not(any(unix, windows)))]
    {
        cmd.spawn()
    }
}

/// Linux refuses to `execve` a file that any process holds open for writing,
/// and a sibling thread's spawn briefly inherits our write handles. A binary
/// written seconds ago can be momentarily unrunnable rather than wrong.
#[cfg(unix)]
fn spawn_retrying_text_file_busy(cmd: &mut Command) -> io::Result<Child> {
    const ATTEMPTS: u32 = 4;
    for attempt in 1..ATTEMPTS {
        match cmd.spawn() {
            Err(e) if is_text_file_busy(&e) => thread::sleep(Duration::from_millis(20) * attempt),
            settled => return settled,
        }
    }
    cmd.spawn()
}

#[cfg(unix)]
fn is_text_file_busy(error: &io::Error) -> bool {
    error.raw_os_error() == Some(libc::ETXTBSY)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TreeSignal {
    #[cfg(not(windows))]
    Term,
    Kill,
}

/// Signal the whole tree led by `pid`. Its pid is the stable group id even
/// after the leader exits, so the group is signalled first.
pub fn signal_tree(pid: u32, signal: TreeSignal) {
    if pid <= 1 {
        return;
    }
    #[cfg(unix)]
    {
        let sig = match signal {
            TreeSignal::Term => libc::SIGTERM,
            TreeSignal::Kill => libc::SIGKILL,
        };
        let ipid = pid as i32;
        unsafe {
            libc::kill(-ipid, sig);
            libc::kill(ipid, sig);
        }
    }
    #[cfg(windows)]
    {
        let _ = signal;
        windows::kill_tree(pid);
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (pid, signal);
    }
}

/// Whether the leader or any member of its process group still exists.
#[cfg(not(windows))]
pub fn tree_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        let ipid = pid as i32;
        pid > 1 && unsafe { libc::kill(ipid, 0) == 0 || libc::kill(-ipid, 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    }
}

/// SIGTERM every tree, then SIGKILL whatever is still standing, before return.
pub fn terminate_all(pids: &[u32]) {
    let pids: Vec<u32> = pids.iter().copied().filter(|pid| *pid > 1).collect();
    #[cfg(windows)]
    for pid in pids {
        signal_tree(pid, TreeSignal::Kill);
    }
    #[cfg(not(windows))]
    {
        if pids.is_empty() {
            return;
        }
        for pid in &pids {
            signal_tree(*pid, TreeSignal::Term);
        }
        wait_until_dead(&pids, Instant::now() + KILL_ALL_GRACE);
        let remaining: Vec<u32> = pids
            .iter()
            .copied()
            .filter(|pid| tree_alive(*pid))
            .collect();
        if remaining.is_empty() {
            return;
        }
        for pid in &remaining {
            signal_tree(*pid, TreeSignal::Kill);
        }
        wait_until_dead(&remaining, Instant::now() + KILL_ALL_KILL_WAIT);
    }
}

/// Wait until every tree is gone or `until` passes. Returns whether all died.
#[cfg(not(windows))]
pub fn wait_until_dead(pids: &[u32], until: Instant) -> bool {
    loop {
        if pids.iter().all(|pid| !tree_alive(*pid)) {
            return true;
        }
        if Instant::now() >= until {
            return false;
        }
        thread::sleep(Duration::from_millis(20));
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::Stdio;

    #[test]
    fn only_text_file_busy_is_worth_respawning_for() {
        assert!(is_text_file_busy(&io::Error::from_raw_os_error(
            libc::ETXTBSY
        )));
        assert!(!is_text_file_busy(&io::Error::from_raw_os_error(
            libc::ENOENT
        )));
        assert!(!is_text_file_busy(&io::Error::other("no errno")));
    }

    #[test]
    fn terminate_all_stops_a_tree_that_ignores_sigterm() {
        let mut child = spawn_managed(
            Command::new("sh")
                .args(["-c", "trap '' TERM; sleep 30 & wait"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null()),
        )
        .unwrap();
        let pid = child.id();
        thread::sleep(Duration::from_millis(100));
        assert!(tree_alive(pid));
        let reaper = thread::spawn(move || child.wait());
        terminate_all(&[pid]);
        reaper.join().unwrap().unwrap();
        assert!(wait_until_dead(
            &[pid],
            Instant::now() + Duration::from_secs(2)
        ));
    }
}
