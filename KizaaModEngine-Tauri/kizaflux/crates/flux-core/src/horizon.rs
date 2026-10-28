//! Horizon, the engine Kizaflux runs today.

pub mod install;
pub mod launch;
pub mod layout;
pub mod release;
pub mod signature;

/// Where Horizon's releases are published.
pub const REPOSITORY: &str = "horizon-rust/horizon";

/// The archive a release carries for this system, if Horizon builds one.
pub fn platform_asset() -> Option<&'static str> {
    if cfg!(all(windows, target_arch = "x86_64")) {
        Some("horizon-windows-x64.zip")
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("horizon-macos-arm64.zip")
    } else {
        // Linux ships a .tar.gz, which install.rs does not unpack: Kiza
        // Launcher is a Windows program.
        None
    }
}

/// The client program's file name on this system.
pub fn client_program() -> &'static str {
    if cfg!(windows) {
        "horizon-client.exe"
    } else {
        "horizon-client"
    }
}

/// The preparer's file name on this system.
pub fn prepare_program() -> &'static str {
    if cfg!(windows) {
        "horizon-prepare.exe"
    } else {
        "horizon-prepare"
    }
}
