use super::*;
use std::io::Write;
use zip::write::SimpleFileOptions;

fn target() -> Target {
    Target {
        minecraft: "26.3".into(),
    }
}

/// A zip of `(name, contents)` pairs, stored uncompressed.
fn archive(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for (name, bytes) in files {
        writer.start_file(*name, options).unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

fn report(files: &[(&str, &[u8])]) -> Report {
    analyze_bytes("test.jar", &archive(files), &target(), &Limits::default()).unwrap()
}

const FABRIC_CONTENT: &str = r#"{"schemaVersion":1,"id":"oak_plus","version":"1.0","depends":{"minecraft":"~1.21.1"},"mixins":["oak_plus.mixins.json"]}"#;

#[test]
fn a_java_mod_with_content_needs_adaptation() {
    let r = report(&[
        ("fabric.mod.json", FABRIC_CONTENT.as_bytes()),
        ("oak_plus.mixins.json", b"{}"),
        ("com/example/OakPlus.class", b"\xca\xfe\xba\xbe"),
        ("assets/oak_plus/textures/block/oak.png", b"png"),
        ("data/oak_plus/recipe/oak.json", b"{}"),
    ]);
    assert_eq!(r.kind, Kind::Mod(Loader::Fabric));
    assert_eq!(r.status, Status::NeedsAdaptation);
    assert_eq!(r.minecraft_match, VersionMatch::Differs);
    assert!(
        r.unavailable
            .iter()
            .any(|u| u.contains("1 Mixin configuration")),
        "{:?}",
        r.unavailable
    );
    assert!(
        r.unavailable.iter().any(|u| u.contains("1 classes")),
        "{:?}",
        r.unavailable
    );
    assert!(
        r.reasons.iter().any(|u| u.contains("oak_plus")),
        "{:?}",
        r.reasons
    );
}

#[test]
fn a_java_mod_without_content_is_incompatible() {
    let r = report(&[
        (
            "fabric.mod.json",
            br#"{"schemaVersion":1,"id":"tweak","version":"1"}"#,
        ),
        ("com/example/Tweak.class", b"\xca\xfe\xba\xbe"),
        ("assets/tweak/icon.png", b"png"),
        ("assets/tweak/lang/en_us.json", b"{}"),
    ]);
    // Its icon and translations are not content.
    assert_eq!(r.status, Status::Incompatible);
    let r = report(&[
        (
            "fabric.mod.json",
            br#"{"schemaVersion":1,"id":"tweak","version":"1"}"#,
        ),
        ("com/example/Tweak.class", b"\xca\xfe\xba\xbe"),
        ("assets/minecraft/lang/en_us.json", b"{}"),
    ]);
    assert_eq!(r.status, Status::Incompatible);
}

#[test]
fn a_mod_with_no_code_is_resources_only() {
    let r = report(&[
        (
            "META-INF/neoforge.mods.toml",
            b"modLoader=\"lowcodefml\"\n[[mods]]\nmodId=\"stones\"\nversion=\"1\"\n",
        ),
        ("data/stones/recipe/a.json", b"{}"),
    ]);
    assert_eq!(r.kind, Kind::Mod(Loader::NeoForge));
    assert_eq!(r.status, Status::ResourcesOnly);
}

#[test]
fn packs_are_resources_only() {
    let r = report(&[
        ("pack.mcmeta", b"{}"),
        ("assets/minecraft/textures/block/stone.png", b"png"),
    ]);
    assert_eq!(r.kind, Kind::ResourcePack);
    assert_eq!(r.status, Status::ResourcesOnly);
    let r = report(&[
        ("pack.mcmeta", b"{}"),
        ("data/towers/structure/a.nbt", b"nbt"),
    ]);
    assert_eq!(r.kind, Kind::DataPack);
    assert_eq!(r.status, Status::ResourcesOnly);
}

#[test]
fn a_horizon_mod_is_untested_until_a_test_says_otherwise() {
    let bytes = archive(&[
        (
            "horizon-mod.toml",
            b"id=\"coords\"\nversion=\"0.1.0\"\napi=\"0.1\"\ncapabilities=[\"hud\"]\n",
        ),
        ("mod.wasm", b"\0asm"),
    ]);
    let mut r = analyze_bytes("coords.hmod", &bytes, &target(), &Limits::default()).unwrap();
    assert_eq!(r.kind, Kind::Mod(Loader::Horizon));
    assert_eq!(r.status, Status::Untested);
    let mut results = TestResults::default();
    results.by_sha1.insert(
        r.sha1.clone(),
        TestResult {
            status: Status::CompatibleTested,
            notes: vec![],
        },
    );
    apply_test_results(&mut r, &results);
    assert_eq!(r.status, Status::CompatibleTested);
}

#[test]
fn performance_mods_are_replaced_by_the_engine() {
    let r = report(&[
        (
            "fabric.mod.json",
            br#"{"schemaVersion":1,"id":"sodium","version":"0.6"}"#,
        ),
        ("net/caffeinemc/Sodium.class", b"\xca\xfe\xba\xbe"),
        ("assets/sodium/shaders/a.glsl", b"x"),
    ]);
    assert!(r.replaced_by_engine);
    assert_eq!(r.status, Status::Incompatible);
}

#[test]
fn forge_mixins_come_from_the_manifest() {
    let r = report(&[
        ("META-INF/mods.toml", b"modLoader=\"javafml\"\n[[mods]]\nmodId=\"old\"\nversion=\"1\"\n[[dependencies.old]]\nmodId=\"minecraft\"\nmandatory=true\nversionRange=\"[1.20.1,1.21)\"\n"),
        ("META-INF/MANIFEST.MF", b"Manifest-Version: 1.0\r\nMixinConfigs: old.mixins.json\r\n"),
        ("old/Old.class", b"\xca\xfe\xba\xbe"),
    ]);
    let m = &r.descriptors[0].mods[0];
    assert_eq!(m.mixin_configs, ["old.mixins.json"]);
    assert_eq!(m.minecraft_match, Some(VersionMatch::Differs));
    assert_eq!(r.status, Status::Incompatible);
}

#[test]
fn nested_jars_get_their_own_reports() {
    let inner = archive(&[
        (
            "fabric.mod.json",
            br#"{"schemaVersion":1,"id":"lib","version":"1"}"#,
        ),
        ("lib/Lib.class", b"\xca\xfe\xba\xbe"),
    ]);
    let r = report(&[
        (
            "fabric.mod.json",
            br#"{"schemaVersion":1,"id":"outer","version":"1"}"#,
        ),
        ("META-INF/jars/lib.jar", &inner),
    ]);
    assert_eq!(r.nested.len(), 1);
    assert_eq!(r.nested[0].mod_ids(), ["lib"]);
}

#[test]
fn an_archive_escaping_its_folder_is_refused() {
    let r = report(&[
        (
            "fabric.mod.json",
            br#"{"schemaVersion":1,"id":"evil","version":"1"}"#,
        ),
        ("../../evil.dll", b"MZ"),
    ]);
    assert_eq!(r.status, Status::Incompatible);
    assert_eq!(r.contents.unsafe_entries, ["../../evil.dll"]);
    assert!(r.reasons[0].starts_with("Refused"));
}

#[test]
fn too_many_entries_are_not_read() {
    let files: Vec<(String, Vec<u8>)> =
        (0..20).map(|i| (format!("f{i}.txt"), Vec::new())).collect();
    let refs: Vec<(&str, &[u8])> = files
        .iter()
        .map(|(n, b)| (n.as_str(), b.as_slice()))
        .collect();
    let limits = Limits {
        max_entries: 10,
        ..Limits::default()
    };
    let r = analyze_bytes("big.jar", &archive(&refs), &target(), &limits).unwrap();
    assert_eq!(r.status, Status::Incompatible);
}

#[test]
fn a_descriptor_larger_than_the_limit_is_not_read() {
    let big = vec![b' '; 2048];
    let limits = Limits {
        max_descriptor_bytes: 1024,
        ..Limits::default()
    };
    let r = analyze_bytes(
        "x.jar",
        &archive(&[("fabric.mod.json", &big)]),
        &target(),
        &limits,
    )
    .unwrap();
    assert!(r.descriptors.is_empty());
    assert!(r.reasons.iter().any(|x| x.contains("not read")));
}

#[test]
fn not_a_zip_is_an_error() {
    assert!(analyze_bytes("x.jar", b"not a zip", &target(), &Limits::default()).is_err());
}

#[test]
fn a_file_on_disk() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pack.zip");
    std::fs::write(
        &path,
        archive(&[("pack.mcmeta", b"{}"), ("assets/x/a.png", b"p")]),
    )
    .unwrap();
    let r = analyze_file(&path, &target(), &Limits::default()).unwrap();
    assert_eq!(r.file_name, "pack.zip");
    assert_eq!(r.sha1.len(), 40);
    assert_eq!(r.status, Status::ResourcesOnly);
}

#[test]
fn a_zoom_mod_points_at_horizons_own() {
    let r = report(&[
        (
            "fabric.mod.json",
            br#"{"schemaVersion":1,"id":"zoomify","version":"2"}"#,
        ),
        ("dev/Zoomify.class", b"\xca\xfe\xba\xbe"),
    ]);
    assert_eq!(r.horizon_equivalent, Some("zoom"));
    assert!(r.reasons.iter().any(|x| x.contains("`zoom`")));
}
