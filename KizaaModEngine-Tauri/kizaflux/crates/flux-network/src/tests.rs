use super::*;
use std::net::TcpListener;
use std::thread;

/// A server that answers status pings with `answer(handshake protocol)`.
fn fake_server(answer: impl Fn(i32) -> String + Send + 'static, pings: usize) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap().to_string();
    thread::spawn(move || {
        for _ in 0..pings {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            let handshake = receive(&mut stream).unwrap();
            let mut cursor = handshake.as_slice();
            assert_eq!(read_varint(&mut cursor).unwrap(), 0x00);
            let protocol = read_varint(&mut cursor).unwrap();
            let request = receive(&mut stream).unwrap();
            assert_eq!(request, [0x00]);
            let mut body = Vec::new();
            write_varint(&mut body, 0x00);
            write_string(&mut body, &answer(protocol));
            send(&mut stream, &body).unwrap();
        }
    });
    address
}

fn vanilla(name: &'static str, protocol: i32) -> impl Fn(i32) -> String + Send {
    move |_| {
        format!(
            r#"{{"version":{{"name":"{name}","protocol":{protocol}}},"players":{{"max":20,"online":1}},"description":"A Minecraft Server","enforcesSecureChat":true}}"#
        )
    }
}

#[test]
fn a_vanilla_server_of_the_engines_version() {
    let address = fake_server(vanilla("26.3", 777), 2);
    let (verdict, status) = probe(&address, 777, &Options::default());
    assert_eq!(verdict, Verdict::ProtocolMatches);
    let status = status.unwrap();
    assert_eq!(status.players_online, Some(1));
    assert_eq!(status.enforces_secure_chat, Some(true));
}

#[test]
fn a_server_of_another_version() {
    let address = fake_server(vanilla("1.21.1", 767), 1);
    let (verdict, _) = probe(&address, 777, &Options::default());
    assert_eq!(
        verdict,
        Verdict::VersionMismatch {
            server_version: "1.21.1".into(),
            server_protocol: 767
        }
    );
}

#[test]
fn a_proxy_answering_any_version() {
    let address = fake_server(
        |asked| format!(r#"{{"version":{{"name":"Velocity 3.4","protocol":{asked}}}}}"#),
        2,
    );
    let (verdict, _) = probe(&address, 777, &Options::default());
    assert_eq!(
        verdict,
        Verdict::MultiVersionProxy {
            server_version: "Velocity 3.4".into()
        }
    );
}

#[test]
fn a_forge_server_wants_its_mods() {
    let address = fake_server(
        |_| {
            r#"{"version":{"name":"1.20.1","protocol":763},"forgeData":{"channels":[],"mods":[{"modId":"forge","modmarker":"47.2.0"},{"modId":"create","modmarker":"0.5.1"},{"modId":"spark","modmarker":"OHNOES😱"}],"fmlNetworkVersion":3}}"#.to_string()
        },
        2,
    );
    let (verdict, _) = probe(&address, 777, &Options::default());
    assert_eq!(
        verdict,
        Verdict::NeedsJavaClient {
            mods: vec!["create".into()]
        }
    );
}

#[test]
fn a_neoforge_server_says_it_is_modded() {
    let status =
        parse_status(r#"{"version":{"name":"1.21.1","protocol":767},"isModded":true}"#).unwrap();
    assert!(status.modded);
    assert_eq!(
        verdict(&status, 777, false),
        Verdict::NeedsJavaClient { mods: vec![] }
    );
}

#[test]
fn an_empty_legacy_mod_list_asks_for_nothing() {
    // CubeCraft's answer, 2026-10-28.
    let status = parse_status(
        r#"{"version":{"name":"CubeCraft","protocol":777},"players":{"max":5000,"online":1540},"modinfo":{"type":"FML","modList":[]}}"#,
    )
    .unwrap();
    assert!(!status.modded);
    assert_eq!(verdict(&status, 777, false), Verdict::ProtocolMatches);
}

#[test]
fn nobody_listening() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap().to_string();
    drop(listener);
    let (verdict, status) = probe(
        &address,
        777,
        &Options {
            timeout: Duration::from_secs(2),
        },
    );
    assert!(
        matches!(verdict, Verdict::Unreachable { .. }),
        "{verdict:?}"
    );
    assert!(status.is_none());
}

#[test]
fn something_that_is_not_minecraft() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap().to_string();
    thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n");
        }
    });
    let (verdict, _) = probe(
        &address,
        777,
        &Options {
            timeout: Duration::from_secs(2),
        },
    );
    assert!(
        matches!(verdict, Verdict::Unreachable { .. }),
        "{verdict:?}"
    );
}

#[test]
fn addresses() {
    assert_eq!(
        split_address("play.example.net").unwrap(),
        ("play.example.net".into(), 25565)
    );
    assert_eq!(
        split_address("localhost:25570").unwrap(),
        ("localhost".into(), 25570)
    );
    assert_eq!(split_address("[::1]:25570").unwrap(), ("::1".into(), 25570));
    assert!(split_address("host:port").is_err());
}

#[test]
fn varints_round_trip() {
    for value in [0, 1, 127, 128, 255, 25565, 777, i32::MAX, -1] {
        let mut out = Vec::new();
        write_varint(&mut out, value);
        let mut cursor = out.as_slice();
        assert_eq!(read_varint(&mut cursor).unwrap(), value);
    }
    let mut endless: &[u8] = &[0xff; 6];
    assert!(read_varint(&mut endless).is_err());
}

/// A real server, when one is running: `KIZAFLUX_SERVER=localhost:25565
/// cargo test -p flux-network -- --ignored --nocapture`.
#[test]
#[ignore]
fn a_real_server() {
    let address = std::env::var("KIZAFLUX_SERVER").expect("KIZAFLUX_SERVER");
    let (verdict, status) = probe(&address, protocol_of("26.3").unwrap(), &Options::default());
    println!("{verdict:?}\n{status:#?}");
}
