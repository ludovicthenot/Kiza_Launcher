#[allow(unused_imports)]
use crate::path_security::safe_file_name;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tokio::sync::{Notify, Semaphore};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum DownloadState {
    Queued,
    Resolving,
    Downloading,
    Paused,
    Retrying,
    Finalizing,
    Downloaded,
    Failed(String),
    Canceled,
    // Install states
    ReadyToInstall,
    Installing,
    Installed(String), // String = Instance ID where it was installed
    InstallFailed(String),
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum DownloadInstallStatus {
    NotInstalled,
    ReadyToInstall,
    Installing,
    Installed,
    InstallFailed,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct DownloadJob {
    pub id: String,
    pub mod_name: String,
    pub file_name: String,
    pub file_name_display: String, // New field for UI display
    pub version: Option<String>,   // New field

    // Nexus Metadata
    pub game_domain: Option<String>,
    pub mod_id: Option<u64>,
    pub file_id: Option<u64>,

    pub url: Option<String>,
    pub destination: PathBuf,
    pub temp_path: PathBuf,

    pub state: DownloadState,

    // Install Status
    pub install_status: DownloadInstallStatus,
    pub installed_instance_id: Option<String>,
    pub install_error: Option<String>,
    pub installed_mod_id: Option<String>,

    pub progress_bytes: u64,
    pub total_bytes: Option<u64>,
    pub retries: u8,

    // Internal
    #[serde(skip)]
    pub last_update: Option<String>, // Timestamp for UI throttling?
}

pub struct DownloadManager {
    pub jobs: Arc<Mutex<HashMap<String, DownloadJob>>>,
    queue_semaphore: Arc<Semaphore>,
    /// What the user asked for. The semaphore catches up with it as running
    /// downloads release their slots.
    concurrency_target: Arc<std::sync::atomic::AtomicUsize>,
    /// What the semaphore currently holds.
    concurrency_now: Arc<std::sync::atomic::AtomicUsize>,
    /// How many times a failing transfer is retried before it is given up on.
    /// Held here rather than read from the config file on each attempt: the
    /// worker runs on its own thread and must not touch the disk to decide
    /// whether to try again.
    max_attempts: Arc<std::sync::atomic::AtomicU32>,
    /// Set while the game is running, when the user has asked for it. The
    /// worker stops picking up new jobs; transfers already in flight finish
    /// rather than being torn down, because abandoning one halfway costs the
    /// bytes it had already fetched.
    paused: Arc<std::sync::atomic::AtomicBool>,
    worker_notify: Arc<Notify>,
    app_handle: Option<tauri::AppHandle>,
    persistence_path: Option<PathBuf>,
}

/// What to do with the bytes already on disk once the server has answered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ResumePlan {
    /// Keep the partial file and append from this offset.
    Append(u64),
    /// Start over: either there was nothing, or the server ignored the range.
    Restart,
    /// We asked past the end, so every byte is already here.
    AlreadyComplete,
}

/// Decides from the status code alone, which is the only honest signal: a
/// server that does not support ranges answers 200 and sends the whole file,
/// and appending that to a partial file would silently corrupt it.
pub(crate) fn plan_resume(status: u16, requested_offset: u64) -> ResumePlan {
    if requested_offset == 0 {
        return ResumePlan::Restart;
    }
    match status {
        206 => ResumePlan::Append(requested_offset),
        416 => ResumePlan::AlreadyComplete,
        _ => ResumePlan::Restart,
    }
}

/// Total size of the resource.
///
/// On a 206 the Content-Length is only the *remaining* bytes, so using it as
/// the total would make every resumed download report a wrong size. The real
/// total is the tail of Content-Range.
pub(crate) fn resolved_total_size(
    status: u16,
    content_length: Option<u64>,
    content_range: Option<&str>,
) -> Option<u64> {
    if status == 206 {
        return content_range
            .and_then(|value| value.rsplit('/').next())
            .and_then(|total| total.trim().parse().ok());
    }
    content_length
}

/// How many downloads may run at once.
///
/// One is the floor because a queue with no parallelism stalls entirely on a
/// single slow host. Eight is the ceiling because past that a home connection
/// only divides the same bandwidth into more, slower streams while multiplying
/// the number of half-written files an interrupted session leaves behind.
/// Attempts per transfer, before and after which the queue gives up.
///
/// One is "try once and report"; more than six turns a genuinely dead host
/// into a queue that looks stuck rather than failed.
pub const MIN_ATTEMPTS: u32 = 1;
pub const MAX_ATTEMPTS: u32 = 6;
pub const DEFAULT_ATTEMPTS: u32 = 4;

pub fn clamp_attempts(wanted: u32) -> u32 {
    wanted.clamp(MIN_ATTEMPTS, MAX_ATTEMPTS)
}

pub const MIN_CONCURRENCY: usize = 1;
pub const MAX_CONCURRENCY: usize = 8;
pub const DEFAULT_CONCURRENCY: usize = 3;

pub fn clamp_concurrency(wanted: usize) -> usize {
    wanted.clamp(MIN_CONCURRENCY, MAX_CONCURRENCY)
}

/// What has to happen to the semaphore to move from `current` to `wanted`.
///
/// Taking permits away can only reach the ones nobody is holding: a download
/// already running keeps its slot until it finishes. So the reduction is
/// applied again on each pass of the worker, and this returns how far the last
/// pass actually got rather than what was asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PermitChange {
    Add(usize),
    Remove(usize),
    Nothing,
}

pub(crate) fn permit_change(current: usize, wanted: usize) -> PermitChange {
    use std::cmp::Ordering;
    match wanted.cmp(&current) {
        Ordering::Greater => PermitChange::Add(wanted - current),
        Ordering::Less => PermitChange::Remove(current - wanted),
        Ordering::Equal => PermitChange::Nothing,
    }
}

/// Exponential backoff, capped so a dead host does not stall the queue.
pub(crate) fn retry_delay(attempt: u32) -> Duration {
    Duration::from_millis(500u64.saturating_mul(1u64 << attempt.min(5)).min(16_000))
}

impl DownloadManager {
    pub fn new(app_handle: Option<tauri::AppHandle>, persistence_path: Option<PathBuf>) -> Self {
        let restored_jobs = persistence_path
            .as_ref()
            .map(Self::load_jobs_from_disk)
            .unwrap_or_default();
        let manager = Self {
            jobs: Arc::new(Mutex::new(restored_jobs)),
            queue_semaphore: Arc::new(Semaphore::new(DEFAULT_CONCURRENCY)),
            concurrency_target: Arc::new(std::sync::atomic::AtomicUsize::new(DEFAULT_CONCURRENCY)),
            concurrency_now: Arc::new(std::sync::atomic::AtomicUsize::new(DEFAULT_CONCURRENCY)),
            max_attempts: Arc::new(std::sync::atomic::AtomicU32::new(DEFAULT_ATTEMPTS)),
            paused: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            worker_notify: Arc::new(Notify::new()),
            app_handle,
            persistence_path,
        };

        manager.spawn_worker();
        manager
    }

    /// How many downloads may run at once, as it stands right now.
    pub fn concurrency(&self) -> usize {
        self.concurrency_target
            .load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Changes how many downloads may run at once.
    ///
    /// Raising it takes effect immediately. Lowering it frees only the slots
    /// nobody is using; the rest are taken back as the running downloads
    /// finish, which is why the worker reconciles on every pass rather than
    /// trusting one call to have done the job.
    pub fn is_paused(&self) -> bool {
        self.paused.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Holds or releases the queue.
    ///
    /// Releasing notifies the worker so a queue held for an hour restarts at
    /// once rather than on its next idle poll.
    pub fn set_paused(&self, paused: bool) {
        self.paused
            .store(paused, std::sync::atomic::Ordering::Relaxed);
        if !paused {
            self.worker_notify.notify_one();
        }
    }

    pub fn max_attempts(&self) -> u32 {
        self.max_attempts.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Takes effect on the next transfer that fails, not on one already
    /// retrying: a job halfway through its attempts keeps the budget it
    /// started with rather than gaining or losing tries mid-flight.
    pub fn set_max_attempts(&self, wanted: u32) -> u32 {
        let wanted = clamp_attempts(wanted);
        self.max_attempts
            .store(wanted, std::sync::atomic::Ordering::Relaxed);
        wanted
    }

    pub fn set_concurrency(&self, wanted: usize) -> usize {
        let wanted = clamp_concurrency(wanted);
        self.concurrency_target
            .store(wanted, std::sync::atomic::Ordering::Relaxed);
        Self::reconcile_permits(
            &self.queue_semaphore,
            &self.concurrency_target,
            &self.concurrency_now,
        );
        wanted
    }

    fn reconcile_permits(
        semaphore: &Arc<Semaphore>,
        target: &Arc<std::sync::atomic::AtomicUsize>,
        now: &Arc<std::sync::atomic::AtomicUsize>,
    ) {
        use std::sync::atomic::Ordering::Relaxed;
        let wanted = target.load(Relaxed);
        let current = now.load(Relaxed);

        match permit_change(current, wanted) {
            PermitChange::Add(count) => {
                semaphore.add_permits(count);
                now.store(current + count, Relaxed);
            }
            PermitChange::Remove(count) => {
                // Returns what it could actually take, which is only the free
                // slots. Recording that rather than `wanted` keeps the next
                // pass working from the truth.
                let removed = semaphore.forget_permits(count);
                now.store(current - removed, Relaxed);
            }
            PermitChange::Nothing => {}
        }
    }

    pub fn lock_jobs(&self) -> Result<MutexGuard<'_, HashMap<String, DownloadJob>>, String> {
        self.jobs
            .lock()
            .map_err(|_| "Download manager lock is poisoned".to_string())
    }

    fn lock_jobs_arc(
        jobs: &Arc<Mutex<HashMap<String, DownloadJob>>>,
    ) -> Result<MutexGuard<'_, HashMap<String, DownloadJob>>, String> {
        jobs.lock()
            .map_err(|_| "Download manager lock is poisoned".to_string())
    }

    fn load_jobs_from_disk(path: &PathBuf) -> HashMap<String, DownloadJob> {
        let content = match std::fs::read_to_string(path) {
            Ok(content) => content,
            Err(_) => return HashMap::new(),
        };

        let mut jobs = match serde_json::from_str::<HashMap<String, DownloadJob>>(&content) {
            Ok(jobs) => jobs,
            Err(e) => {
                eprintln!(
                    "[WARN] [DownloadManager] Failed to restore downloads: {}",
                    e
                );
                return HashMap::new();
            }
        };

        for job in jobs.values_mut() {
            match job.state {
                DownloadState::Downloading
                | DownloadState::Resolving
                | DownloadState::Retrying
                | DownloadState::Finalizing
                | DownloadState::Queued => {
                    job.state = DownloadState::Paused;
                }
                _ => {}
            }
        }

        jobs
    }

    fn persist_jobs_snapshot(jobs: &HashMap<String, DownloadJob>, path: &Option<PathBuf>) {
        let Some(path) = path else {
            return;
        };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let Ok(content) = serde_json::to_string_pretty(jobs) else {
            return;
        };
        let tmp = path.with_extension("tmp");
        if std::fs::write(&tmp, content).is_ok() {
            let _ = std::fs::rename(&tmp, path);
        }
    }

    pub fn persist_jobs(&self) {
        match self.lock_jobs() {
            Ok(jobs) => Self::persist_jobs_snapshot(&jobs, &self.persistence_path),
            Err(e) => eprintln!("[DownloadManager] {e}"),
        }
    }

    fn spawn_worker(&self) {
        let jobs = self.jobs.clone();
        let semaphore = self.queue_semaphore.clone();
        let concurrency_target = self.concurrency_target.clone();
        let concurrency_now = self.concurrency_now.clone();
        let max_attempts = self.max_attempts.clone();
        let paused = self.paused.clone();
        let notify = self.worker_notify.clone();
        let app_handle = self.app_handle.clone();
        let persistence_path = self.persistence_path.clone();

        // Use Tauri's async runtime to ensure context is available
        tauri::async_runtime::spawn(async move {
            println!("[DownloadManager] Worker started");
            loop {
                // 1. Find a queued job — unless the queue is held.
                let next_job_id = if paused.load(std::sync::atomic::Ordering::Relaxed) {
                    None
                } else {
                    let jobs_guard = match Self::lock_jobs_arc(&jobs) {
                        Ok(guard) => guard,
                        Err(e) => {
                            eprintln!("[DownloadManager] {e}");
                            break;
                        }
                    };
                    jobs_guard
                        .iter()
                        .find(|(_, job)| job.state == DownloadState::Queued)
                        .map(|(id, _)| id.clone())
                };

                if let Some(job_id) = next_job_id {
                    // Bring the semaphore in line with the setting first. A
                    // reduction can only take the free slots, so this runs on
                    // every pass until the ones held by running downloads come
                    // back.
                    Self::reconcile_permits(&semaphore, &concurrency_target, &concurrency_now);

                    // 2. Acquire semaphore (limit concurrency)
                    // We clone semaphore because acquire_owned consumes the Arc
                    let permit = match semaphore.clone().acquire_owned().await {
                        Ok(p) => p,
                        Err(e) => {
                            eprintln!("[DownloadManager] Semaphore error: {}", e);
                            break; // Stop worker if semaphore is closed
                        }
                    };

                    // 3. Start download task
                    let jobs_clone = jobs.clone();
                    let app_handle_clone = app_handle.clone();
                    let persistence_path_clone = persistence_path.clone();
                    // Read once, here, so a job keeps the budget it started
                    // with even if the setting changes mid-transfer.
                    let attempts_for_job = max_attempts.load(std::sync::atomic::Ordering::Relaxed);

                    tauri::async_runtime::spawn(async move {
                        // Move permit inside to keep it alive until task finishes
                        let _permit = permit;
                        if let Err(e) = Self::process_download(
                            jobs_clone,
                            job_id,
                            app_handle_clone,
                            persistence_path_clone,
                            attempts_for_job,
                        )
                        .await
                        {
                            eprintln!("[DownloadManager] Download failed: {}", e);
                        }
                    });
                } else {
                    // Wait for new jobs
                    notify.notified().await;
                }
            }
        });
    }

    async fn process_download(
        jobs: Arc<Mutex<HashMap<String, DownloadJob>>>,
        job_id: String,
        _app_handle: Option<tauri::AppHandle>,
        persistence_path: Option<PathBuf>,
        attempts: u32,
    ) -> Result<(), String> {
        // Update state to Downloading
        let (url, temp_path, mut final_path) = {
            let mut jobs_guard = Self::lock_jobs_arc(&jobs)?;
            let values = if let Some(job) = jobs_guard.get_mut(&job_id) {
                if job.state == DownloadState::Canceled || job.state == DownloadState::Paused {
                    return Ok(());
                }
                job.state = DownloadState::Downloading;
                (
                    job.url.clone(),
                    job.temp_path.clone(),
                    job.destination.clone(),
                )
            } else {
                return Err("Job not found".to_string());
            };
            Self::persist_jobs_snapshot(&jobs_guard, &persistence_path);
            values
        };

        let url = url.ok_or("No URL provided".to_string())?;

        // Setup Client
        let client = reqwest::Client::new();

        // Bytes already on disk from an interrupted run. Asking for the rest is
        // what makes a resume a resume rather than a restart.
        let resume_offset = tokio::fs::metadata(&temp_path)
            .await
            .map(|metadata| metadata.len())
            .unwrap_or(0);

        let mut response = None;
        let mut last_error = String::new();
        for attempt in 0..attempts {
            let mut request = client.get(&url);
            if resume_offset > 0 {
                request = request.header(reqwest::header::RANGE, format!("bytes={resume_offset}-"));
            }
            match request.send().await {
                Ok(answer) => {
                    response = Some(answer);
                    break;
                }
                Err(error) => {
                    last_error = error.to_string();
                    if attempt + 1 < attempts {
                        {
                            let mut jobs_guard = Self::lock_jobs_arc(&jobs)?;
                            if let Some(job) = jobs_guard.get_mut(&job_id) {
                                job.state = DownloadState::Retrying;
                            }
                        }
                        tokio::time::sleep(retry_delay(attempt)).await;
                    }
                }
            }
        }
        let mut response = response.ok_or(last_error)?;
        let mut file_is_complete = false;

        let status_code = response.status().as_u16();
        let plan = plan_resume(status_code, resume_offset);

        if plan == ResumePlan::AlreadyComplete {
            file_is_complete = true;
        } else if !response.status().is_success() {
            {
                let mut jobs_guard = Self::lock_jobs_arc(&jobs)?;
                if let Some(job) = jobs_guard.get_mut(&job_id) {
                    job.state = DownloadState::Failed(format!("HTTP {}", response.status()));
                    Self::persist_jobs_snapshot(&jobs_guard, &persistence_path);
                }
            }
            return Err(format!("HTTP {}", response.status()));
        }

        // Try to update filename from Content-Disposition
        let mut new_filename: Option<String> = None;
        if let Some(disposition) = response.headers().get(reqwest::header::CONTENT_DISPOSITION) {
            if let Ok(disp_str) = disposition.to_str() {
                // primitive parsing for filename=
                if let Some(idx) = disp_str.find("filename=") {
                    let mut name = disp_str[idx + 9..].to_string();
                    if name.starts_with('"') && name.ends_with('"') {
                        name = name[1..name.len() - 1].to_string();
                    }
                    if let Ok(name) = safe_file_name(&name, &[]) {
                        new_filename = Some(name);
                    }
                }
            }
        }

        if let Some(name) = new_filename {
            let parent = final_path
                .parent()
                .map(|path| path.to_path_buf())
                .ok_or_else(|| "Download destination has no parent directory".to_string())?;
            let destination = parent.join(&name);
            final_path = destination.clone();

            let mut jobs_guard = Self::lock_jobs_arc(&jobs)?;
            if let Some(job) = jobs_guard.get_mut(&job_id) {
                job.file_name = name.clone();
                job.file_name_display = name;
                job.destination = destination;
            }
            Self::persist_jobs_snapshot(&jobs_guard, &persistence_path);
        }

        let content_range = response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let total_size = resolved_total_size(
            status_code,
            response.content_length(),
            content_range.as_deref(),
        );

        {
            let mut jobs_guard = Self::lock_jobs_arc(&jobs)?;
            if let Some(job) = jobs_guard.get_mut(&job_id) {
                job.total_bytes = total_size;
                Self::persist_jobs_snapshot(&jobs_guard, &persistence_path);
            }
        }

        // Stream to file. Appending is the whole point of a resume: creating
        // the file would truncate the bytes we already have.
        use tokio::io::AsyncWriteExt;
        let mut downloaded: u64 = match plan {
            ResumePlan::Append(offset) => offset,
            ResumePlan::AlreadyComplete => resume_offset,
            ResumePlan::Restart => 0,
        };
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(matches!(plan, ResumePlan::Append(_)))
            .truncate(matches!(plan, ResumePlan::Restart))
            .open(&temp_path)
            .await
            .map_err(|e| e.to_string())?;

        let mut last_emit = Instant::now();

        // A 416 means every byte is already on disk: nothing left to stream.
        if !file_is_complete {
            while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
                file.write_all(&chunk).await.map_err(|e| e.to_string())?;
                downloaded += chunk.len() as u64;

                // Throttle updates (e.g. every 200ms)
                if last_emit.elapsed() > Duration::from_millis(200) {
                    let mut should_abort = false;
                    {
                        let mut jobs_guard = Self::lock_jobs_arc(&jobs)?;
                        if let Some(job) = jobs_guard.get_mut(&job_id) {
                            // Check for pause/cancel during loop
                            if job.state == DownloadState::Canceled {
                                should_abort = true;
                            } else if job.state == DownloadState::Paused {
                                // Record how far we got and leave the partial file
                                // in place; the next run asks for the rest.
                                job.progress_bytes = downloaded;
                                Self::persist_jobs_snapshot(&jobs_guard, &persistence_path);
                                return Ok(());
                            } else {
                                job.progress_bytes = downloaded;
                            }
                        }
                    }

                    if should_abort {
                        let _ = tokio::fs::remove_file(&temp_path).await;
                        return Ok(());
                    }
                    last_emit = Instant::now();
                }
            }
        }

        // Finalize
        file.flush().await.map_err(|e| e.to_string())?;

        // Atomic Rename
        tokio::fs::rename(&temp_path, &final_path)
            .await
            .map_err(|e| e.to_string())?;

        {
            let mut jobs_guard = Self::lock_jobs_arc(&jobs)?;
            if let Some(job) = jobs_guard.get_mut(&job_id) {
                job.state = DownloadState::ReadyToInstall; // Changed from Downloaded to ReadyToInstall
                job.install_status = DownloadInstallStatus::ReadyToInstall; // Sync status
                job.progress_bytes = downloaded;
                Self::persist_jobs_snapshot(&jobs_guard, &persistence_path);
            }
        }

        Ok(())
    }

    pub fn create_job(
        &self,
        url: String,
        file_name: String,
        destination_dir: PathBuf,
    ) -> Result<String, String> {
        let file_name = safe_file_name(&file_name, &[])
            .map_err(|e| format!("Invalid download file name: {e}"))?;
        let id = uuid::Uuid::new_v4().to_string();
        std::fs::create_dir_all(&destination_dir).map_err(|e| e.to_string())?;
        let temp_path = destination_dir.join(format!("{}.part", id));
        let final_path = destination_dir.join(&file_name);

        let job = DownloadJob {
            id: id.clone(),
            mod_name: "Unknown Mod".to_string(),
            file_name: file_name.clone(),
            file_name_display: file_name.clone(), // Default to filename
            version: None,
            game_domain: None,
            mod_id: None,
            file_id: None,
            url: Some(url),
            destination: final_path,
            temp_path,
            state: DownloadState::Queued,

            install_status: DownloadInstallStatus::NotInstalled,
            installed_instance_id: None,
            install_error: None,
            installed_mod_id: None,

            progress_bytes: 0,
            total_bytes: None,
            retries: 0,
            last_update: None,
        };

        let mut jobs = self.lock_jobs()?;
        jobs.insert(id.clone(), job);
        Self::persist_jobs_snapshot(&jobs, &self.persistence_path);

        // Notify worker to pick up job
        self.worker_notify.notify_one();

        Ok(id)
    }

    pub fn get_jobs(&self) -> Vec<DownloadJob> {
        match self.lock_jobs() {
            Ok(jobs) => jobs.values().cloned().collect(),
            Err(e) => {
                eprintln!("[DownloadManager] {e}");
                Vec::new()
            }
        }
    }

    pub fn pause_job(&self, job_id: &str) -> Result<(), String> {
        let mut jobs = self.lock_jobs()?;
        if let Some(job) = jobs.get_mut(job_id) {
            if job.state == DownloadState::Downloading || job.state == DownloadState::Queued {
                job.state = DownloadState::Paused;
                Self::persist_jobs_snapshot(&jobs, &self.persistence_path);
                Ok(())
            } else {
                Err("Job is not in a pausable state".to_string())
            }
        } else {
            Err("Job not found".to_string())
        }
    }

    pub fn resume_job(&self, job_id: &str) -> Result<(), String> {
        let mut jobs = self.lock_jobs()?;
        if let Some(job) = jobs.get_mut(job_id) {
            if job.state == DownloadState::Paused || job.state == DownloadState::Queued {
                // Or Failed?
                job.state = DownloadState::Queued;
                Self::persist_jobs_snapshot(&jobs, &self.persistence_path);
                // Notify worker to pick it up again
                self.worker_notify.notify_one();
                Ok(())
            } else {
                Err("Job is not in a resumable state".to_string())
            }
        } else {
            Err("Job not found".to_string())
        }
    }

    pub fn cancel_job(&self, job_id: &str) -> Result<(), String> {
        let mut jobs = self.lock_jobs()?;
        if let Some(job) = jobs.get_mut(job_id) {
            // If downloading, the worker will see Canceled state and abort/cleanup
            job.state = DownloadState::Canceled;
            Self::persist_jobs_snapshot(&jobs, &self.persistence_path);

            // If already downloaded or queued, we might want to cleanup files immediately here?
            // For now, let's just mark it. Worker handles active ones.
            Ok(())
        } else {
            Err("Job not found".to_string())
        }
    }
}

#[cfg(test)]
mod resume_tests {
    use super::*;

    #[test]
    fn a_partial_file_is_appended_to_only_when_the_server_agrees() {
        // 206 is the only answer that means "here is the rest".
        assert_eq!(plan_resume(206, 1024), ResumePlan::Append(1024));
        // 200 means the server ignored Range and is resending everything;
        // appending that to the partial file would corrupt it.
        assert_eq!(plan_resume(200, 1024), ResumePlan::Restart);
        // 416 means we asked past the end: the bytes are all there already.
        assert_eq!(plan_resume(416, 1024), ResumePlan::AlreadyComplete);
        // Nothing on disk: nothing to resume, whatever the server says.
        assert_eq!(plan_resume(206, 0), ResumePlan::Restart);
        assert_eq!(plan_resume(200, 0), ResumePlan::Restart);
    }

    #[test]
    fn the_total_size_of_a_resumed_download_comes_from_content_range() {
        // On a 206 the Content-Length is the remainder, not the total: using it
        // would show a wrong size for every resumed file.
        assert_eq!(
            resolved_total_size(206, Some(824), Some("bytes 200-1023/1024")),
            Some(1024)
        );
        // Plain responses have the real total in Content-Length.
        assert_eq!(resolved_total_size(200, Some(1024), None), Some(1024));
        // An unknown total stays unknown rather than becoming a wrong number.
        assert_eq!(
            resolved_total_size(206, Some(824), Some("bytes 200-1023/*")),
            None
        );
        assert_eq!(resolved_total_size(200, None, None), None);
    }

    #[test]
    fn a_concurrency_setting_is_kept_inside_what_helps() {
        // One is the floor: a queue with no parallelism stops dead on one slow
        // host. Eight is the ceiling: past that the same bandwidth is only cut
        // into more, slower streams.
        assert_eq!(clamp_concurrency(0), MIN_CONCURRENCY);
        assert_eq!(clamp_concurrency(1), 1);
        assert_eq!(clamp_concurrency(3), 3);
        assert_eq!(clamp_concurrency(8), 8);
        assert_eq!(clamp_concurrency(9), MAX_CONCURRENCY);
        assert_eq!(clamp_concurrency(usize::MAX), MAX_CONCURRENCY);
    }

    #[test]
    fn moving_the_setting_asks_for_the_difference_and_not_the_total() {
        // Adding `wanted` permits instead of the difference would multiply the
        // limit on every visit to the settings page.
        assert_eq!(permit_change(3, 6), PermitChange::Add(3));
        assert_eq!(permit_change(6, 3), PermitChange::Remove(3));
        assert_eq!(permit_change(3, 3), PermitChange::Nothing);
    }

    #[tokio::test]
    async fn raising_the_limit_takes_effect_at_once() {
        let semaphore = Arc::new(Semaphore::new(1));
        let target = Arc::new(std::sync::atomic::AtomicUsize::new(4));
        let now = Arc::new(std::sync::atomic::AtomicUsize::new(1));

        DownloadManager::reconcile_permits(&semaphore, &target, &now);

        assert_eq!(semaphore.available_permits(), 4);
    }

    #[tokio::test]
    async fn lowering_the_limit_waits_for_the_downloads_already_running() {
        // Three permits, two of them held by downloads in flight. Asking for
        // one can only take the free slot now; the rest arrive as those two
        // finish, which is what the worker's repeated reconcile is for.
        let semaphore = Arc::new(Semaphore::new(3));
        let held_a = semaphore.clone().acquire_owned().await.unwrap();
        let held_b = semaphore.clone().acquire_owned().await.unwrap();

        let target = Arc::new(std::sync::atomic::AtomicUsize::new(1));
        let now = Arc::new(std::sync::atomic::AtomicUsize::new(3));

        DownloadManager::reconcile_permits(&semaphore, &target, &now);

        assert_eq!(semaphore.available_permits(), 0);
        // Two slots are still out on loan, so the books say two, not one.
        assert_eq!(now.load(std::sync::atomic::Ordering::Relaxed), 2);

        drop(held_a);
        DownloadManager::reconcile_permits(&semaphore, &target, &now);
        assert_eq!(now.load(std::sync::atomic::Ordering::Relaxed), 1);

        drop(held_b);
        // Settled: the last returned permit brings it to the requested limit.
        assert_eq!(semaphore.available_permits(), 1);
    }

    #[test]
    fn an_attempt_budget_is_kept_inside_what_helps() {
        // One is "try once and report". More than six turns a genuinely dead
        // host into a queue that looks stuck rather than failed.
        assert_eq!(clamp_attempts(0), MIN_ATTEMPTS);
        assert_eq!(clamp_attempts(1), 1);
        assert_eq!(clamp_attempts(4), 4);
        assert_eq!(clamp_attempts(99), MAX_ATTEMPTS);
    }

    #[test]
    fn retries_back_off_and_stay_bounded() {
        assert!(retry_delay(0) < retry_delay(1));
        assert!(retry_delay(1) < retry_delay(2));
        // A dead host must not stall the queue for minutes.
        assert!(retry_delay(20) <= Duration::from_millis(16_000));
    }
}
