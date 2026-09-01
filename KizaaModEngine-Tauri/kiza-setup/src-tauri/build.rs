use std::path::PathBuf;

fn main() {
    // The launcher is embedded rather than committed: `KIZA_SETUP_PAYLOAD`
    // points at the zip that `scripts/build-installer.mjs` prepares. Without it
    // the crate still builds — it just carries an empty archive, and refuses to
    // install at runtime rather than silently copying nothing.
    println!("cargo:rerun-if-env-changed=KIZA_SETUP_PAYLOAD");
    // Which edition this installs is read at compile time by `option_env!`,
    // and cargo does not know that on its own: it would hand back a cached
    // Stable installer for a Maker build, and the only sign would be the Maker
    // installing itself over somebody's launcher.
    println!("cargo:rerun-if-env-changed=KIZA_EDITION");

    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR is set by cargo"));
    let destination = out_dir.join("payload.zip");

    match std::env::var("KIZA_SETUP_PAYLOAD") {
        Ok(source) if !source.trim().is_empty() => {
            println!("cargo:rerun-if-changed={source}");
            std::fs::copy(&source, &destination)
                .unwrap_or_else(|error| panic!("could not read the payload at {source}: {error}"));
        }
        _ => {
            std::fs::write(&destination, []).expect("could not write the placeholder payload");
        }
    }

    tauri_build::build();
}
