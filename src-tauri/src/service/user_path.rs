//! Startup-only shell PATH recovery. The application and its children share the recovered PATH.
use std::io::Read;
#[cfg(windows)]
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const LIMIT: u64 = 65536;
const START: &str = "DSH_DESKTOP_PATH_BEGIN";
const END: &str = "DSH_DESKTOP_PATH_END";

fn parse_path(text: &str) -> Result<String, String> {
    let start = text.rfind(START).ok_or("CLI_SCAN_FAILED: shell returned no PATH")? + START.len();
    let end = text[start..].find(END).ok_or("CLI_SCAN_FAILED: incomplete shell PATH")? + start;
    let path = text[start..end].trim_matches(['\r', '\n']);
    if path.is_empty() || path.contains(['\r', '\n', '\0']) {
        return Err("CLI_SCAN_FAILED: invalid shell PATH".into());
    }
    Ok(path.to_string())
}

#[cfg(windows)]
struct Job(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0); }
    }
}

fn recover(login: bool) -> Result<String, String> {
    #[cfg(windows)]
    let mut command = {
        let system = PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()));
        let powershell = system.join("System32/WindowsPowerShell/v1.0/powershell.exe");
        let shell = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
            .map(|dir| dir.join("pwsh.exe")).find(|path| path.is_file()).unwrap_or_else(|| powershell.clone());
        let mut command = Command::new(powershell);
        // The no-profile parent waits until its Job Object owns all descendants.
        command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
            "$null=[Console]::ReadLine(); & $env:DSH_PROBE_SHELL -NoLogo -NonInteractive -Command '[Console]::WriteLine($env:DSH_PROBE_BEGIN); [Console]::WriteLine($env:PATH); [Console]::WriteLine($env:DSH_PROBE_END)'; exit $LASTEXITCODE"]);
        command.env("DSH_PROBE_SHELL", shell);
        command.env("DSH_PROBE_BEGIN", START).env("DSH_PROBE_END", END);
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
        let _ = login;
        command
    };
    #[cfg(unix)]
    let mut command = {
        let shell = std::env::var_os("SHELL").unwrap_or_else(|| "/bin/sh".into());
        let mut command = Command::new(shell);
        command.args([if login { "-lc" } else { "-ic" }, "printf '\\nDSH_DESKTOP_PATH_BEGIN\\n%s\\nDSH_DESKTOP_PATH_END\\n' \"$PATH\""]);
        use std::os::unix::process::CommandExt;
        unsafe { command.pre_exec(|| { if libc::setsid() < 0 { Err(std::io::Error::last_os_error()) } else { Ok(()) } }); }
        command
    };
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = command.spawn().map_err(|_| "CLI_SCAN_FAILED: could not start user shell")?;
    #[cfg(windows)]
    let job = {
        use windows_sys::Win32::System::JobObjects::*;
        use std::os::windows::io::AsRawHandle;
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let valid = !handle.is_null() && unsafe { SetInformationJobObject(handle, JobObjectExtendedLimitInformation, &info as *const _ as _, std::mem::size_of_val(&info) as u32) != 0
            && AssignProcessToJobObject(handle, child.as_raw_handle()) != 0 };
        if !valid {
            if !handle.is_null() { unsafe { windows_sys::Win32::Foundation::CloseHandle(handle); } }
            let _ = child.kill(); let _ = child.wait();
            return Err("CLI_SCAN_FAILED: shell process ownership failed".into());
        }
        Job(handle)
    };
    #[cfg(windows)]
    if let Some(mut input) = child.stdin.take() { let _ = input.write_all(b"start\n"); }
    #[cfg(unix)]
    drop(child.stdin.take());
    let output = child.stdout.take().expect("piped stdout");
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        output.take(LIMIT + 1).read_to_end(&mut bytes).map(|_| bytes)
    });
    let deadline = Instant::now() + Duration::from_secs(10);
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) => break if status.success() { Ok(()) } else { Err("CLI_SCAN_FAILED: shell initialization failed") },
            Err(_) => break Err("CLI_SCAN_FAILED: shell wait failed"),
            _ if Instant::now() >= deadline => break Err("CLI_SCAN_FAILED: shell initialization timed out"),
            _ => std::thread::sleep(Duration::from_millis(20)),
        }
    };
    #[cfg(windows)]
    drop(job);
    #[cfg(unix)]
    unsafe { libc::kill(-(child.id() as i32), libc::SIGKILL); }
    let _ = child.wait();
    let bytes = reader.join().map_err(|_| "CLI_SCAN_FAILED: shell output reader failed")?
        .map_err(|_| "CLI_SCAN_FAILED: shell output read failed")?;
    result?;
    if bytes.len() > LIMIT as usize { return Err("CLI_SCAN_FAILED: shell output exceeded limit".into()); }
    parse_path(&String::from_utf8_lossy(&bytes))
}

/// Called before the application creates threads; never modifies machine or user environment settings.
pub fn initialize() {
    let inherited = std::env::var_os("PATH").unwrap_or_default();
    let mut recovered = Vec::<PathBuf>::new();
    for login in [false, true] {
        match recover(login) {
            Ok(path) => {
                recovered.extend(std::env::split_paths(&path));
                let mut directories = recovered.clone();
                directories.extend(std::env::split_paths(&inherited));
                if let Ok(path) = std::env::join_paths(directories) { std::env::set_var("PATH", path); }
            }
            Err(error) => eprintln!("{error}; command discovery remains incomplete"),
        }
        if cfg!(windows) { break; }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ignores_profile_noise_and_rejects_missing_or_multiline_path() {
        assert_eq!(parse_path("noise\nDSH_DESKTOP_PATH_BEGIN\n/custom/bin:/usr/bin\nDSH_DESKTOP_PATH_END\nmore").unwrap(), "/custom/bin:/usr/bin");
        assert!(parse_path("profile exited").is_err());
        assert!(parse_path("DSH_DESKTOP_PATH_BEGIN\na\nb\nDSH_DESKTOP_PATH_END").is_err());
    }
    #[test]
    #[ignore = "Opt-in probe executes the current user's shell profile"]
    fn actual_user_shell_returns_path() { assert!(!recover(false).unwrap().is_empty()); }
}
