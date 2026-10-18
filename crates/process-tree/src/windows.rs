use std::io;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};
use std::os::windows::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::sync::OnceLock;
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

static MANAGED_JOB: OnceLock<Result<OwnedHandle, i32>> = OnceLock::new();

/// The single kill-on-close job this process enrolls every managed tree in.
/// Callers that spawn through other APIs (a PTY) can enroll there too.
pub fn managed_job() -> io::Result<&'static OwnedHandle> {
    MANAGED_JOB
        .get_or_init(|| create_job().map_err(|err| err.raw_os_error().unwrap_or(1)))
        .as_ref()
        .map_err(|code| io::Error::from_raw_os_error(*code))
}

fn create_job() -> io::Result<OwnedHandle> {
    unsafe {
        let raw = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if raw.is_null() {
            return Err(io::Error::last_os_error());
        }
        let job = OwnedHandle::from_raw_handle(raw);
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job.as_raw_handle(),
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const _,
            std::mem::size_of_val(&limits) as u32,
        ) == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(job)
    }
}

fn assign_child(process: RawHandle) -> io::Result<()> {
    if unsafe { AssignProcessToJobObject(managed_job()?.as_raw_handle(), process) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

pub(crate) fn spawn_managed(command: &mut Command) -> io::Result<Child> {
    use windows_sys::Win32::System::Threading::{CREATE_NEW_PROCESS_GROUP, CREATE_SUSPENDED};
    managed_job()?;
    // Children can exit or create descendants before spawn returns. Enroll
    // them while suspended, then let the first thread run.
    command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | CREATE_SUSPENDED);
    let mut child = command.spawn()?;
    if let Err(err) = assign_child(child.as_raw_handle()).and_then(|()| resume_child(child.id())) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(err);
    }
    Ok(child)
}

fn resume_child(pid: u32) -> io::Result<()> {
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32,
        },
        Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME},
    };
    // Stable Rust does not expose Child's primary-thread handle. The suspended
    // process has not run user code, so find that thread in the OS snapshot.
    unsafe {
        let raw = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if raw == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        let snapshot = OwnedHandle::from_raw_handle(raw);
        let mut entry: THREADENTRY32 = std::mem::zeroed();
        entry.dwSize = std::mem::size_of_val(&entry) as u32;
        let mut found = Thread32First(snapshot.as_raw_handle(), &mut entry);
        while found != 0 {
            if entry.th32OwnerProcessID == pid {
                let raw = OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID);
                if raw.is_null() {
                    return Err(io::Error::last_os_error());
                }
                let thread = OwnedHandle::from_raw_handle(raw);
                if ResumeThread(thread.as_raw_handle()) == u32::MAX {
                    return Err(io::Error::last_os_error());
                }
                return Ok(());
            }
            found = Thread32Next(snapshot.as_raw_handle(), &mut entry);
        }
        Err(io::Error::other("Managed child has no primary thread"))
    }
}

pub(crate) fn kill_tree(pid: u32) {
    let system_root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    let taskkill = std::path::Path::new(&system_root)
        .join("System32")
        .join("taskkill.exe");
    let _ = Command::new(taskkill)
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}
