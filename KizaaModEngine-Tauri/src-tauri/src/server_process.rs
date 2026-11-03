//! Running a hosted server: the Java process, its console, and the state the
//! page shows.
//!
//! The state is read off the process, never assumed from the button that was
//! pressed. Start spawns the JVM and reports *Starting*; the server's own
//! "Done (…)!" line is what makes it *Online*; a stop command makes it
//! *Stopping*; the exit code decides between *Offline* and *Crashed*. A
//! process that outlived a previous Kiza is found through its pid file and
//! shown as *Detached* — running, but with no console to attach to — which
//! is the truth, and the truth is what lets the user decide to kill it.
//!
//! The console is a ring of the last `CONSOLE_LINES` lines with a sequence
//! number each, so the page asks only for what it has not seen. Nothing here
//! polls the process on the page's behalf: the reader threads block on the
//! pipes and the waiter on the process, and they wake when there is news.

use crate::server_install::{Cancel, InstallProgress};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Written beside the server while it runs, read to find one that outlived
/// the launcher.
pub const PID_FILE: &str = "kiza-server.pid";
/// How much console is kept. Two thousand lines is a long evening of chat and
/// well under a megabyte; the server's own `logs/latest.log` keeps the rest.
pub const CONSOLE_LINES: usize = 2000;
/// How long a polite `stop` gets before the process is killed.
pub const STOP_GRACE: Duration = Duration::from_secs(30);

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ServerState {
    Offline,
    Installing,
    Starting,
    Online,
    Stopping,
    Crashed,
    /// Running, started by a previous Kiza; no console, only a kill.
    Detached,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct ServerStatus {
    pub state: ServerState,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub started_at_ms: Option<u64>,
    /// Who is on, read from the join and leave lines.
    pub players: Vec<String>,
    pub last_error: Option<String>,
    pub install: Option<InstallProgress>,
}

impl ServerStatus {
    fn offline() -> Self {
        Self {
            state: ServerState::Offline,
            pid: None,
            exit_code: None,
            started_at_ms: None,
            players: Vec::new(),
            last_error: None,
            install: None,
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct ConsoleLine {
    pub seq: u64,
    pub at_ms: u64,
    /// `out`, `err`, or `in` for a command the user sent.
    pub stream: &'static str,
    pub text: String,
}

#[derive(Default)]
pub struct Console {
    lines: VecDeque<ConsoleLine>,
    next_seq: u64,
}

impl Console {
    pub fn push(&mut self, stream: &'static str, text: String) -> &ConsoleLine {
        if self.lines.len() >= CONSOLE_LINES {
            self.lines.pop_front();
        }
        self.next_seq += 1;
        self.lines.push_back(ConsoleLine {
            seq: self.next_seq,
            at_ms: now_ms(),
            stream,
            text,
        });
        self.lines.back().expect("just pushed")
    }

    /// Everything after `after`, oldest first.
    pub fn since(&self, after: u64) -> Vec<ConsoleLine> {
        self.lines
            .iter()
            .filter(|line| line.seq > after)
            .cloned()
            .collect()
    }

    pub fn clear(&mut self) {
        self.lines.clear();
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The live handles of one running server.
struct Running {
    child: Mutex<Child>,
    stdin: Mutex<Option<ChildStdin>>,
    stop_requested: AtomicBool,
}

struct Entry {
    status: ServerStatus,
    console: Arc<Mutex<Console>>,
    running: Option<Arc<Running>>,
    cancel: Option<Cancel>,
    /// World size is a walk of the disk; remembered for a minute.
    world_bytes: Option<(Instant, u64)>,
    last_console_notice: Option<Instant>,
}

impl Entry {
    fn new() -> Self {
        Self {
            status: ServerStatus::offline(),
            console: Arc::new(Mutex::new(Console::default())),
            running: None,
            cancel: None,
            world_bytes: None,
            last_console_notice: None,
        }
    }
}

/// What the runtime tells the window about, the moment it happens.
///
/// The page used to learn that a server had come up by asking every few
/// seconds; a state read off the process a second ago is a second stale.
/// With this, a status change is on screen before the next poll would have
/// asked, and the polls become the safety net rather than the mechanism.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum Notice {
    Status {
        id: String,
        status: ServerStatus,
    },
    /// New console lines exist; the page fetches what it has not seen.
    Console {
        id: String,
    },
}

pub type Notifier = Box<dyn Fn(Notice) + Send + Sync>;

/// How often at most the console notice fires per server. A server printing
/// three hundred lines a second during startup must not send three hundred
/// events; the page fetches them all in one request either way.
const CONSOLE_NOTICE_GAP: Duration = Duration::from_millis(120);

/// Every hosted server the launcher knows the state of. One per app.
#[derive(Default)]
pub struct ServerRuntime {
    entries: Mutex<HashMap<String, Entry>>,
    notifier: Mutex<Option<Notifier>>,
}

impl ServerRuntime {
    fn with_entry<T>(&self, id: &str, f: impl FnOnce(&mut Entry) -> T) -> T {
        let mut entries = self.entries.lock().unwrap_or_else(|p| p.into_inner());
        f(entries.entry(id.to_string()).or_insert_with(Entry::new))
    }

    /// Where notices go. Set once, by the app, with a closure that emits to
    /// the window; absent in tests and nothing is sent.
    pub fn set_notifier(&self, notifier: Notifier) {
        *self.notifier.lock().unwrap_or_else(|p| p.into_inner()) = Some(notifier);
    }

    fn notify(&self, notice: Notice) {
        // Cloned out of the lock so a slow emitter never holds the runtime.
        let guard = self.notifier.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(notifier) = guard.as_ref() {
            notifier(notice);
        }
    }

    fn announce(&self, id: &str) {
        let status = self.with_entry(id, |entry| entry.status.clone());
        self.notify(Notice::Status {
            id: id.to_string(),
            status,
        });
    }

    /// Console activity, throttled per server.
    fn console_changed(&self, id: &str) {
        let due = self.with_entry(id, |entry| {
            let now = Instant::now();
            match entry.last_console_notice {
                Some(last) if now.duration_since(last) < CONSOLE_NOTICE_GAP => false,
                _ => {
                    entry.last_console_notice = Some(now);
                    true
                }
            }
        });
        if due {
            self.notify(Notice::Console { id: id.to_string() });
        }
    }

    /// The state as the runtime knows it, or as the pid file says when the
    /// runtime has never heard of this server.
    pub fn status(&self, server_dir: &Path, id: &str) -> ServerStatus {
        let known = {
            let entries = self.entries.lock().unwrap_or_else(|p| p.into_inner());
            entries.get(id).map(|entry| entry.status.clone())
        };
        if let Some(status) = known {
            if status.state != ServerState::Offline && status.state != ServerState::Crashed {
                return status;
            }
            // Offline in memory, but a pid file may say otherwise.
            if let Some(pid) = detached_pid(server_dir) {
                return ServerStatus {
                    state: ServerState::Detached,
                    pid: Some(pid),
                    ..status
                };
            }
            return status;
        }
        match detached_pid(server_dir) {
            Some(pid) => ServerStatus {
                state: ServerState::Detached,
                pid: Some(pid),
                ..ServerStatus::offline()
            },
            None => ServerStatus::offline(),
        }
    }

    /// Every server that is up, with its state — for the Discord presence,
    /// which shows one server at a time and picks the busiest.
    pub fn online(&self) -> Vec<(String, ServerStatus)> {
        let entries = self.entries.lock().unwrap_or_else(|p| p.into_inner());
        entries
            .iter()
            .filter(|(_, entry)| entry.status.state == ServerState::Online)
            .map(|(id, entry)| (id.clone(), entry.status.clone()))
            .collect()
    }

    pub fn is_running(&self, id: &str) -> bool {
        let entries = self.entries.lock().unwrap_or_else(|p| p.into_inner());
        entries.get(id).is_some_and(|entry| {
            matches!(
                entry.status.state,
                ServerState::Starting
                    | ServerState::Online
                    | ServerState::Stopping
                    | ServerState::Installing
            )
        })
    }

    pub fn console_since(&self, id: &str, after: u64) -> Vec<ConsoleLine> {
        let console = self.with_entry(id, |entry| entry.console.clone());
        let console = console.lock().unwrap_or_else(|p| p.into_inner());
        console.since(after)
    }

    pub fn clear_console(&self, id: &str) {
        let console = self.with_entry(id, |entry| entry.console.clone());
        console.lock().unwrap_or_else(|p| p.into_inner()).clear();
    }

    fn set_status(&self, id: &str, f: impl FnOnce(&mut ServerStatus)) {
        self.with_entry(id, |entry| f(&mut entry.status));
        self.announce(id);
    }

    pub fn note_install(&self, id: &str, progress: InstallProgress) {
        self.set_status(id, |status| {
            if !progress.finished {
                status.state = ServerState::Installing;
            }
            status.install = Some(progress);
        });
    }

    pub fn begin_install(&self, id: &str) -> Result<Cancel, String> {
        self.with_entry(id, |entry| {
            if entry.status.state != ServerState::Offline
                && entry.status.state != ServerState::Crashed
            {
                return Err("The server is busy.".to_string());
            }
            let cancel = Cancel::default();
            entry.cancel = Some(cancel.clone());
            entry.status.state = ServerState::Installing;
            entry.status.last_error = None;
            entry.status.install = Some(InstallProgress {
                phase: "prepare".into(),
                message: "Preparing".into(),
                ..Default::default()
            });
            Ok(cancel)
        })
        .inspect(|_| self.announce(id))
    }

    pub fn end_install(&self, id: &str, outcome: Result<(), String>) {
        self.with_entry(id, |entry| {
            entry.cancel = None;
            let cancelled = outcome.as_ref().is_err_and(|e| e == "Cancelled.");
            let mut progress = entry.status.install.take().unwrap_or_default();
            progress.finished = true;
            progress.cancelled = cancelled;
            progress.error = outcome.err().filter(|_| !cancelled);
            entry.status.last_error = progress.error.clone();
            entry.status.install = Some(progress);
            entry.status.state = ServerState::Offline;
        });
        self.announce(id);
    }

    pub fn cancel_install(&self, id: &str) -> bool {
        self.with_entry(id, |entry| match &entry.cancel {
            Some(cancel) => {
                cancel.cancel();
                true
            }
            None => false,
        })
    }

    /// Spawns the JVM and follows it. `command` is fully built by the caller;
    /// this only owns what happens after.
    pub fn spawn(
        self: &Arc<Self>,
        id: &str,
        server_dir: &Path,
        mut command: Command,
    ) -> Result<u32, String> {
        if self.is_running(id) {
            return Err("The server is already running.".to_string());
        }
        if detached_pid(server_dir).is_some() {
            return Err("A previous Kiza left this server running. Kill it first.".to_string());
        }
        command
            .current_dir(server_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command
            .spawn()
            .map_err(|error| format!("Could not start Java: {error}"))?;
        let pid = child.id();
        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let _ = std::fs::write(server_dir.join(PID_FILE), pid.to_string());

        let running = Arc::new(Running {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            stop_requested: AtomicBool::new(false),
        });
        let console = self.with_entry(id, |entry| {
            entry.running = Some(running.clone());
            entry.status = ServerStatus {
                state: ServerState::Starting,
                pid: Some(pid),
                started_at_ms: Some(now_ms()),
                ..ServerStatus::offline()
            };
            entry.console.clone()
        });
        {
            let mut console = console.lock().unwrap_or_else(|p| p.into_inner());
            console.push("in", format!("[Kiza] Starting (pid {pid})"));
        }
        self.announce(id);
        self.console_changed(id);

        for (stream, reader) in [
            (
                "out",
                stdout.map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
            ),
            (
                "err",
                stderr.map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
            ),
        ] {
            let Some(reader) = reader else { continue };
            let runtime = Arc::clone(self);
            let console = console.clone();
            let id = id.to_string();
            std::thread::Builder::new()
                .name(format!("kiza-server-{stream}-{id}"))
                .spawn(move || {
                    for line in BufReader::new(reader).split(b'\n').flatten() {
                        let text = String::from_utf8_lossy(&line)
                            .trim_end_matches('\r')
                            .to_string();
                        runtime.observe(&id, &text);
                        console
                            .lock()
                            .unwrap_or_else(|p| p.into_inner())
                            .push(stream, text);
                        runtime.console_changed(&id);
                    }
                })
                .map_err(|error| error.to_string())?;
        }

        let runtime = Arc::clone(self);
        let waited = running.clone();
        let id_owned = id.to_string();
        let dir = server_dir.to_path_buf();
        std::thread::Builder::new()
            .name(format!("kiza-server-wait-{id}"))
            .spawn(move || {
                let status = loop {
                    let polled = waited
                        .child
                        .lock()
                        .unwrap_or_else(|p| p.into_inner())
                        .try_wait();
                    match polled {
                        Ok(Some(status)) => break Some(status),
                        Ok(None) => std::thread::sleep(Duration::from_millis(500)),
                        Err(_) => break None,
                    }
                };
                let _ = std::fs::remove_file(dir.join(PID_FILE));
                let code = status.and_then(|s| s.code());
                let asked = waited.stop_requested.load(Ordering::SeqCst);
                runtime.exited(&id_owned, code, asked, &console);
            })
            .map_err(|error| error.to_string())?;

        Ok(pid)
    }

    /// Reads the server's own lines for the moments the page cares about.
    fn observe(&self, id: &str, line: &str) {
        let body = message_of(line);
        let changed = if body.starts_with("Done (") {
            self.with_entry(id, |entry| {
                let was = entry.status.state;
                if was == ServerState::Starting {
                    entry.status.state = ServerState::Online;
                }
                was == ServerState::Starting
            })
        } else if body == "Stopping server" || body == "Stopping the server" {
            self.with_entry(id, |entry| {
                let was = entry.status.state;
                entry.status.state = ServerState::Stopping;
                was != ServerState::Stopping
            })
        } else if let Some(name) = body.strip_suffix(" joined the game") {
            let name = name.to_string();
            self.with_entry(id, |entry| {
                if entry.status.players.contains(&name) {
                    false
                } else {
                    entry.status.players.push(name);
                    true
                }
            })
        } else if let Some(name) = body.strip_suffix(" left the game") {
            let name = name.to_string();
            self.with_entry(id, |entry| {
                let before = entry.status.players.len();
                entry.status.players.retain(|p| p != &name);
                entry.status.players.len() != before
            })
        } else {
            false
        };
        if changed {
            self.announce(id);
        }
    }

    fn exited(&self, id: &str, code: Option<i32>, asked: bool, console: &Arc<Mutex<Console>>) {
        let crashed = !asked && code != Some(0);
        console.lock().unwrap_or_else(|p| p.into_inner()).push(
            "in",
            match code {
                Some(code) if crashed => {
                    format!("[Kiza] The server stopped unexpectedly (exit code {code})")
                }
                Some(code) => format!("[Kiza] Server stopped (exit code {code})"),
                None => "[Kiza] Server stopped".to_string(),
            },
        );
        self.with_entry(id, |entry| {
            entry.running = None;
            entry.status = ServerStatus {
                state: if crashed {
                    ServerState::Crashed
                } else {
                    ServerState::Offline
                },
                exit_code: code,
                last_error: crashed.then(|| {
                    format!(
                        "Exit code {}",
                        code.map_or("unknown".to_string(), |c| c.to_string())
                    )
                }),
                ..ServerStatus::offline()
            };
        });
        self.announce(id);
        self.console_changed(id);
    }

    /// A line into the server's stdin, echoed in the console.
    pub fn send(&self, id: &str, command: &str) -> Result<(), String> {
        let command = command.trim();
        if command.is_empty() {
            return Ok(());
        }
        let (running, console) =
            self.with_entry(id, |entry| (entry.running.clone(), entry.console.clone()));
        let running = running.ok_or_else(|| "The server is not running.".to_string())?;
        if command.eq_ignore_ascii_case("stop") {
            running.stop_requested.store(true, Ordering::SeqCst);
            self.set_status(id, |status| status.state = ServerState::Stopping);
        }
        let mut stdin = running.stdin.lock().unwrap_or_else(|p| p.into_inner());
        let handle = stdin
            .as_mut()
            .ok_or_else(|| "The server's input is closed.".to_string())?;
        writeln!(handle, "{command}")
            .and_then(|_| handle.flush())
            .map_err(|error| error.to_string())?;
        console
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .push("in", format!("> {command}"));
        self.console_changed(id);
        Ok(())
    }

    /// `stop`, then a kill if the process is still there after the grace.
    pub fn stop(self: &Arc<Self>, id: &str) -> Result<(), String> {
        self.send(id, "stop")?;
        let runtime = Arc::clone(self);
        let id = id.to_string();
        std::thread::spawn(move || {
            let deadline = Instant::now() + STOP_GRACE;
            while Instant::now() < deadline {
                if !runtime.is_running(&id) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
            let _ = runtime.kill(&id);
        });
        Ok(())
    }

    pub fn kill(&self, id: &str) -> Result<(), String> {
        let running = self.with_entry(id, |entry| entry.running.clone());
        let running = running.ok_or_else(|| "The server is not running.".to_string())?;
        running.stop_requested.store(true, Ordering::SeqCst);
        let mut child = running.child.lock().unwrap_or_else(|p| p.into_inner());
        child.kill().map_err(|error| error.to_string())
    }

    /// Kills a process a previous Kiza left behind, found through the pid file.
    pub fn kill_detached(&self, server_dir: &Path) -> Result<(), String> {
        let pid = detached_pid(server_dir).ok_or_else(|| "Nothing is running.".to_string())?;
        let mut system = sysinfo::System::new();
        system.refresh_processes(
            sysinfo::ProcessesToUpdate::Some(&[sysinfo::Pid::from_u32(pid)]),
            true,
        );
        if let Some(process) = system.process(sysinfo::Pid::from_u32(pid)) {
            process.kill();
        }
        let _ = std::fs::remove_file(server_dir.join(PID_FILE));
        Ok(())
    }

    pub fn world_bytes(&self, id: &str, world_dir: &Path) -> u64 {
        let cached = self.with_entry(id, |entry| entry.world_bytes);
        if let Some((at, bytes)) = cached {
            if at.elapsed() < Duration::from_secs(60) {
                return bytes;
            }
        }
        let bytes = dir_bytes(world_dir);
        self.with_entry(id, |entry| {
            entry.world_bytes = Some((Instant::now(), bytes))
        });
        bytes
    }
}

/// The text of a server log line, past `[12:00:00] [Server thread/INFO]: `.
pub fn message_of(line: &str) -> &str {
    match line.rfind("]: ") {
        Some(at) if line.starts_with('[') => &line[at + 3..],
        _ => line,
    }
}

/// The pid in the pid file, if that process is still alive.
pub fn detached_pid(server_dir: &Path) -> Option<u32> {
    let pid: u32 = std::fs::read_to_string(server_dir.join(PID_FILE))
        .ok()?
        .trim()
        .parse()
        .ok()?;
    let mut system = sysinfo::System::new();
    system.refresh_processes(
        sysinfo::ProcessesToUpdate::Some(&[sysinfo::Pid::from_u32(pid)]),
        true,
    );
    match system.process(sysinfo::Pid::from_u32(pid)) {
        Some(process) => {
            // The pid may have been reused by something that is not a JVM.
            let name = process.name().to_string_lossy().to_ascii_lowercase();
            if name.contains("java") {
                Some(pid)
            } else {
                let _ = std::fs::remove_file(server_dir.join(PID_FILE));
                None
            }
        }
        None => {
            let _ = std::fs::remove_file(server_dir.join(PID_FILE));
            None
        }
    }
}

/// What the overview shows about a running process.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "snake_case")]
pub struct ServerMetrics {
    pub uptime_s: Option<u64>,
    pub memory_bytes: Option<u64>,
    pub cpu_percent: Option<f32>,
    pub world_bytes: u64,
    pub port_open: bool,
}

pub fn process_metrics(pid: u32) -> (Option<u64>, Option<f32>) {
    let mut system = sysinfo::System::new();
    let target = sysinfo::Pid::from_u32(pid);
    system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[target]), true);
    // CPU is a rate: two samples a short moment apart.
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[target]), true);
    match system.process(target) {
        Some(process) => (Some(process.memory()), Some(process.cpu_usage())),
        None => (None, None),
    }
}

pub fn port_open(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(300),
    )
    .is_ok()
}

pub fn dir_bytes(path: &Path) -> u64 {
    walkdir::WalkDir::new(path)
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.metadata().ok())
        .filter(|meta| meta.is_file())
        .map(|meta| meta.len())
        .sum()
}

/// The address others on the same network type in. Found by asking the OS
/// which interface would route outward; no packet is sent.
pub fn lan_address() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:9").ok()?;
    let address = socket.local_addr().ok()?.ip();
    if address.is_loopback() || address.is_unspecified() {
        return None;
    }
    Some(address.to_string())
}

/// Builds the JVM command for a server: memory, extra arguments, then how
/// the folder said to start it.
pub fn command_for(
    java: &Path,
    server: &crate::server_host::HostedServer,
    launch: &crate::server_install::ServerLaunch,
) -> Command {
    let mut command = Command::new(java);
    command.arg(format!("-Xms{}M", server.min_memory_mb));
    command.arg(format!("-Xmx{}M", server.max_memory_mb));
    for argument in &server.jvm_args {
        command.arg(argument);
    }
    for argument in launch.arguments() {
        command.arg(argument);
    }
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_console_keeps_the_last_lines_and_hands_out_only_the_new_ones() {
        let mut console = Console::default();
        for i in 0..(CONSOLE_LINES + 5) {
            console.push("out", format!("line {i}"));
        }
        assert_eq!(console.lines.len(), CONSOLE_LINES);
        assert_eq!(console.lines.front().unwrap().text, "line 5");
        let tail = console.since(CONSOLE_LINES as u64 + 3);
        assert_eq!(
            tail.iter().map(|l| l.text.as_str()).collect::<Vec<_>>(),
            vec!["line 2003", "line 2004"]
        );
        assert!(console.since(u64::MAX).is_empty());
    }

    #[test]
    fn the_server_says_when_it_is_up_and_who_is_on() {
        let runtime = Arc::new(ServerRuntime::default());
        runtime.with_entry("s", |entry| entry.status.state = ServerState::Starting);
        runtime.observe(
            "s",
            "[20:01:02] [Server thread/INFO]: Preparing spawn area: 0%",
        );
        assert_eq!(
            runtime.with_entry("s", |e| e.status.state),
            ServerState::Starting
        );
        runtime.observe(
            "s",
            "[20:01:09] [Server thread/INFO]: Done (7.123s)! For help, type \"help\"",
        );
        assert_eq!(
            runtime.with_entry("s", |e| e.status.state),
            ServerState::Online
        );
        runtime.observe(
            "s",
            "[20:02:00] [Server thread/INFO]: Neferr joined the game",
        );
        runtime.observe(
            "s",
            "[20:02:01] [Server thread/INFO]: Neferr joined the game",
        );
        runtime.observe(
            "s",
            "[20:02:10] [Server thread/INFO]: Steve joined the game",
        );
        assert_eq!(
            runtime.with_entry("s", |e| e.status.players.clone()),
            vec!["Neferr", "Steve"]
        );
        runtime.observe("s", "[20:03:00] [Server thread/INFO]: Neferr left the game");
        assert_eq!(
            runtime.with_entry("s", |e| e.status.players.clone()),
            vec!["Steve"]
        );
        runtime.observe("s", "[20:04:00] [Server thread/INFO]: Stopping server");
        assert_eq!(
            runtime.with_entry("s", |e| e.status.state),
            ServerState::Stopping
        );
    }

    #[test]
    fn the_exit_code_decides_between_offline_and_crashed() {
        let runtime = Arc::new(ServerRuntime::default());
        let console = Arc::new(Mutex::new(Console::default()));
        runtime.exited("a", Some(1), false, &console);
        assert_eq!(
            runtime.with_entry("a", |e| e.status.state),
            ServerState::Crashed
        );
        assert_eq!(runtime.with_entry("a", |e| e.status.exit_code), Some(1));
        // A stop we asked for is not a crash, whatever the code.
        runtime.exited("b", Some(1), true, &console);
        assert_eq!(
            runtime.with_entry("b", |e| e.status.state),
            ServerState::Offline
        );
        runtime.exited("c", Some(0), false, &console);
        assert_eq!(
            runtime.with_entry("c", |e| e.status.state),
            ServerState::Offline
        );
        assert!(runtime.with_entry("c", |e| e.status.players.is_empty()));
    }

    #[test]
    fn a_stale_pid_file_is_not_a_running_server() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(detached_pid(dir.path()), None);
        // No process has pid 0 as a JVM, and after the check the file is gone.
        std::fs::write(dir.path().join(PID_FILE), "4294967295").unwrap();
        assert_eq!(detached_pid(dir.path()), None);
        assert!(!dir.path().join(PID_FILE).exists());
        let runtime = ServerRuntime::default();
        assert_eq!(runtime.status(dir.path(), "x").state, ServerState::Offline);
    }

    #[test]
    fn the_command_carries_memory_then_arguments_then_the_launch() {
        let server = crate::server_host::HostedServer {
            id: "s".into(),
            name: "S".into(),
            description: String::new(),
            mc_version: "1.21.1".into(),
            loader: crate::game_manager::MinecraftLoader::Vanilla,
            loader_version: None,
            preset: None,
            port: 25565,
            java_major: None,
            min_memory_mb: 1024,
            max_memory_mb: 4096,
            jvm_args: vec!["-XX:+UseG1GC".into()],
            linked_instance_id: None,
            created_from: None,
            created_at: String::new(),
            updated_at: None,
            auto_backup: Default::default(),
            kiza_address: None,
        };
        let command = command_for(
            Path::new("java"),
            &server,
            &crate::server_install::ServerLaunch::Jar("server.jar".into()),
        );
        let args: Vec<String> = command
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args,
            vec![
                "-Xms1024M",
                "-Xmx4096M",
                "-XX:+UseG1GC",
                "-jar",
                "server.jar",
                "nogui"
            ]
        );
    }

    #[test]
    fn message_of_strips_the_prefix_and_leaves_bare_lines_alone() {
        assert_eq!(
            message_of("[20:01:09] [Server thread/INFO]: Done (7s)!"),
            "Done (7s)!"
        );
        assert_eq!(
            message_of("Starting net.minecraft.server.Main"),
            "Starting net.minecraft.server.Main"
        );
    }
}
