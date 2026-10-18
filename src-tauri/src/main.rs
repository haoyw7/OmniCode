#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--internal-terminal-guard") {
        std::process::exit(omnicode_lib::run_terminal_guard());
    }
    if let Some(code) = omnicode_lib::ssh_askpass::maybe_run() {
        std::process::exit(code);
    }
    if std::env::args().nth(1).as_deref() == Some("control") {
        std::process::exit(omnicode_lib::control_cli::run(
            std::env::args().skip(2).collect(),
        ));
    }
    if std::env::args().nth(1).as_deref() == Some("app") {
        std::process::exit(omnicode_lib::control_cli::run_app(
            std::env::args().skip(2).collect(),
        ));
    }
    #[cfg(all(debug_assertions, target_os = "macos"))]
    omnicode_lib::ensure_macos_dev_bundle();
    omnicode_lib::run()
}
