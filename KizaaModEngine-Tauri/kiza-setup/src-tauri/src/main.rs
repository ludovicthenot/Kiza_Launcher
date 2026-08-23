// A GUI subsystem binary: no console window flashes up when it is double
// clicked. Debug builds keep the console so `println!` still reaches somewhere.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use kiza_setup_lib::{cli, run_headless, uninstall};

use windows::core::{HSTRING, PCWSTR};
use windows::Win32::System::Environment::GetCommandLineW;
use windows::Win32::UI::WindowsAndMessaging::{
    MessageBoxW, IDYES, MB_ICONERROR, MB_ICONQUESTION, MB_OK, MB_YESNO,
};

fn raw_command_line() -> String {
    // `std::env::args` has already been through the CRT's splitter, which
    // throws away exactly the information `/D=` needs: where each argument
    // began in the untouched line.
    unsafe { GetCommandLineW().to_string().unwrap_or_default() }
}

fn message(
    title: &str,
    body: &str,
    style: windows::Win32::UI::WindowsAndMessaging::MESSAGEBOX_STYLE,
) -> i32 {
    let title = HSTRING::from(title);
    let body = HSTRING::from(body);
    unsafe { MessageBoxW(None, PCWSTR(body.as_ptr()), PCWSTR(title.as_ptr()), style).0 }
}

fn report_error(body: &str) {
    message("Kiza Setup", body, MB_OK | MB_ICONERROR);
}

/// The uninstaller cannot delete the folder it is running from, so it copies
/// itself to the temporary folder and hands the job over.
///
/// Returns true when this process has done its part and should exit.
fn relaunch_from_temp_if_needed(options: &cli::Options) -> bool {
    if options.mode != cli::Mode::Uninstall {
        return false;
    }

    let Ok(current) = std::env::current_exe() else {
        return false;
    };
    let temp = std::env::temp_dir();
    // Already the copy: carry on and do the work.
    if current.parent() == Some(temp.as_path()) {
        return false;
    }

    let Some(install_dir) = uninstall::install_dir(&current) else {
        return false;
    };
    // Running from somewhere else entirely — a copy on the Desktop, say. There
    // is nothing to step out of the way of.
    if current.parent() != Some(install_dir.as_path()) {
        return false;
    }

    let copy = temp.join(format!("Kiza Uninstall {}.exe", std::process::id()));
    if std::fs::copy(&current, &copy).is_err() {
        return false;
    }

    let mut command = std::process::Command::new(&copy);
    command.arg("--uninstall");
    if options.presentation == cli::Presentation::Silent {
        command.arg("/S");
    } else if options.presentation == cli::Presentation::Passive {
        command.arg("/P");
    }
    // `/D=` takes the rest of the line, so it goes last.
    command.arg(format!("/D={}", install_dir.display()));

    command.spawn().is_ok()
}

/// WebView2 has to be present before a window can be drawn, so this runs before
/// Tauri starts and can only speak through a message box.
fn ensure_webview2(options: &cli::Options) -> Result<(), String> {
    if kiza_setup_lib::webview2::is_installed() {
        return Ok(());
    }

    if !options.unattended() {
        let answer = message(
            "Kiza Setup",
            "Kiza Launcher needs Microsoft Edge WebView2, a Windows component that is not on this computer yet.\n\nDownload and install it now? It comes from Microsoft and takes about a minute.",
            MB_YESNO | MB_ICONQUESTION,
        );
        if answer != IDYES.0 {
            return Err("Kiza Launcher cannot be installed without WebView2.".to_string());
        }
    }

    kiza_setup_lib::webview2::install(options.unattended())
}

fn main() {
    let options = cli::parse(&raw_command_line());

    if relaunch_from_temp_if_needed(&options) {
        return;
    }

    if options.presentation == cli::Presentation::Silent {
        // Nothing may be drawn, so the outcome is reported the only way a
        // silent run can report anything: the exit code.
        if let Err(error) = run_headless(&options) {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }

    if let Err(error) = ensure_webview2(&options) {
        report_error(&error);
        std::process::exit(1);
    }

    kiza_setup_lib::run(options);
}
