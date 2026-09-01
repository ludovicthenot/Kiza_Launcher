fn main() {
    // Which edition this binary is depends on an environment variable read at
    // compile time by `option_env!`. Cargo does not know that on its own: it
    // would happily hand back a Stable binary from cache for a Maker build,
    // and the only sign would be a launcher that quietly has no Maker in it.
    println!("cargo:rerun-if-env-changed=KIZA_EDITION");
    tauri_build::build()
}
