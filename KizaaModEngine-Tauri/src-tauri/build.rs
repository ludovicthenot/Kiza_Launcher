fn main() {
    // Which edition this binary is depends on an environment variable read at
    // compile time by `option_env!`. Cargo does not know that on its own: it
    // would happily hand back a Stable binary from cache for a Maker build,
    // and the only sign would be a launcher that quietly has no Maker in it.
    println!("cargo:rerun-if-env-changed=KIZA_EDITION");
    // Saying what to watch, as the lines above do, tells cargo to watch
    // nothing else: a new icon then left the cached .exe with the old one
    // embedded, release after release. The icons and the config are what
    // tauri_build puts in the binary, so they are watched by name.
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    tauri_build::build()
}
