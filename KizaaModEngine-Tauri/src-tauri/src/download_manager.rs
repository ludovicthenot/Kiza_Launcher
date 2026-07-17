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
    worker_notify: Arc<Notify>,
    app_handle: Option<tauri::AppHandle>,
    persistence_path: Option<PathBuf>,
}

impl DownloadManager {
    pub fn new(app_handle: Option<tauri::AppHandle>, persistence_path: Option<PathBuf>) -> Self {
        let restored_jobs = persistence_path
            .as_ref()
            .map(Self::load_jobs_from_disk)
            .unwrap_or_default();
        let manager = Self {
            jobs: Arc::new(Mutex::new(restored_jobs)),
            queue_semaphore: Arc::new(Semaphore::new(3)), // 3 concurrent downloads
            worker_notify: Arc::new(Notify::new()),
            app_handle,
            persistence_path,
        };

        manager.spawn_worker();
        manager
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
        let notify = self.worker_notify.clone();
        let app_handle = self.app_handle.clone();
        let persistence_path = self.persistence_path.clone();

        // Use Tauri's async runtime to ensure context is available
        tauri::async_runtime::spawn(async move {
            println!("[DownloadManager] Worker started");
            loop {
                // 1. Find a queued job
                let next_job_id = {
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

                    tauri::async_runtime::spawn(async move {
                        // Move permit inside to keep it alive until task finishes
                        let _permit = permit;
                        if let Err(e) = Self::process_download(
                            jobs_clone,
                            job_id,
                            app_handle_clone,
                            persistence_path_clone,
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
        let mut response = client.get(&url).send().await.map_err(|e| e.to_string())?;

        if !response.status().is_success() {
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

        let total_size = response.content_length();

        {
            let mut jobs_guard = Self::lock_jobs_arc(&jobs)?;
            if let Some(job) = jobs_guard.get_mut(&job_id) {
                job.total_bytes = total_size;
                Self::persist_jobs_snapshot(&jobs_guard, &persistence_path);
            }
        }

        // Stream to file
        use tokio::io::AsyncWriteExt;
        let mut file = tokio::fs::File::create(&temp_path)
            .await
            .map_err(|e| e.to_string())?;

        let mut downloaded: u64 = 0;
        let mut last_emit = Instant::now();

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
                            // TODO: Save offset for resume
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
