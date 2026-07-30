use crate::app_error::AppError;
use crate::curseforge_api;
use crate::game_manager::{GameInstance, MinecraftLoader};
use crate::mod_manager::{DeleteModResult, Mod, ModManager, ModMetadata};
use crate::modrinth_api;
use crate::path_security;
use futures::future::BoxFuture;
use futures::FutureExt;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

const REGISTRY_SCHEMA_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, Hash, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ModProvider {
    Modrinth,
    Curseforge,
}

impl ModProvider {
    fn as_str(self) -> &'static str {
        match self {
            Self::Modrinth => "modrinth",
            Self::Curseforge => "curseforge",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, Hash, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DependencyKind {
    Required,
    Optional,
    Incompatible,
}

#[derive(Serialize, Deserialize, Clone, Debug, Eq, Hash, PartialEq)]
pub struct ProjectIdentity {
    pub provider: ModProvider,
    pub project_id: String,
}

impl ProjectIdentity {
    fn registry_key(&self) -> String {
        format!("{}:{}", self.provider.as_str(), self.project_id)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DependencyTarget {
    pub provider: ModProvider,
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub file_id: Option<u64>,
}

impl DependencyTarget {
    fn identity(&self) -> Option<ProjectIdentity> {
        self.project_id.as_ref().map(|project_id| ProjectIdentity {
            provider: self.provider,
            project_id: project_id.clone(),
        })
    }

    fn display_id(&self) -> String {
        self.project_id
            .clone()
            .or_else(|| self.version_id.clone())
            .or_else(|| self.file_id.map(|value| value.to_string()))
            .unwrap_or_else(|| "unknown".to_string())
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DependencyDeclaration {
    pub target: DependencyTarget,
    pub kind: DependencyKind,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResolveDependenciesRequest {
    pub instance_id: String,
    pub source: ModProvider,
    pub project_id: String,
    pub version_id: Option<String>,
    pub file_id: Option<u64>,
    #[serde(default)]
    pub author: Option<String>,
}

fn apply_request_metadata(
    resolution: &mut DependencyResolution,
    request: &ResolveDependenciesRequest,
) {
    let author = request
        .author
        .as_ref()
        .filter(|value| !value.trim().is_empty())
        .cloned();
    let Some(author) = author else {
        return;
    };

    if let Some(root) = resolution.root.as_mut() {
        root.artifact.author = Some(author.clone());
    }
    if let Some(root_artifact) = resolution.install_order.iter_mut().find(|artifact| {
        artifact.project.provider == request.source
            && artifact.project.project_id == request.project_id
    }) {
        root_artifact.author = Some(author);
    }
}

impl ResolveDependenciesRequest {
    fn target(&self) -> DependencyTarget {
        DependencyTarget {
            provider: self.source,
            project_id: Some(self.project_id.clone()),
            version_id: self.version_id.clone(),
            file_id: self.file_id,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityContext {
    pub minecraft_version: String,
    pub loader: String,
}

impl CompatibilityContext {
    pub fn from_instance(instance: &GameInstance) -> Result<Self, String> {
        let minecraft = instance
            .minecraft
            .as_ref()
            .ok_or_else(|| "The instance has no Minecraft configuration".to_string())?;
        let loader = match minecraft.loader {
            MinecraftLoader::Vanilla => "vanilla",
            MinecraftLoader::Fabric => "fabric",
            MinecraftLoader::Forge => "forge",
        };
        Ok(Self {
            minecraft_version: minecraft.mc_version.clone(),
            loader: loader.to_string(),
        })
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedArtifact {
    pub project: ProjectIdentity,
    pub version_id: String,
    pub file_id: Option<u64>,
    pub name: String,
    pub version: String,
    pub file_name: String,
    pub download_url: String,
    pub sha1: Option<String>,
    pub file_size: Option<u64>,
    pub description: Option<String>,
    pub author: Option<String>,
    pub homepage_url: Option<String>,
    pub cover_url: Option<String>,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub updated_at: Option<String>,
    pub dependencies: Vec<DependencyDeclaration>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlannedMod {
    pub artifact: ResolvedArtifact,
    pub already_installed: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DependencyNotice {
    pub required_by: ProjectIdentity,
    pub target: DependencyTarget,
    pub kind: DependencyKind,
    pub installed: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UnresolvedDependency {
    pub required_by: Option<ProjectIdentity>,
    pub target: DependencyTarget,
    pub reason: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedDependencyEdge {
    pub from: ProjectIdentity,
    pub to: DependencyTarget,
    pub kind: DependencyKind,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DependencyResolution {
    pub context: CompatibilityContext,
    pub root: Option<PlannedMod>,
    pub required: Vec<PlannedMod>,
    pub optional: Vec<DependencyNotice>,
    pub incompatible: Vec<DependencyNotice>,
    pub conflicts: Vec<DependencyNotice>,
    pub unresolved_required: Vec<UnresolvedDependency>,
    pub cycles: Vec<Vec<ProjectIdentity>>,
    pub edges: Vec<ResolvedDependencyEdge>,
    pub install_order: Vec<ResolvedArtifact>,
    pub can_install: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum InstallationStatus {
    Installed,
    NoChanges,
    Blocked,
    RolledBack,
    RollbackIncomplete,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstalledArtifact {
    pub project: ProjectIdentity,
    pub mod_id: String,
    pub name: String,
    pub file_name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InstallationFailure {
    pub project: Option<ProjectIdentity>,
    pub message: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DependencyInstallationState {
    pub status: InstallationStatus,
    pub installed: Vec<InstalledArtifact>,
    pub skipped: Vec<ProjectIdentity>,
    pub rolled_back: Vec<InstalledArtifact>,
    pub rollback_failures: Vec<InstallationFailure>,
    pub failure: Option<InstallationFailure>,
    pub reference_counts: HashMap<String, usize>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DependencyInstallResult {
    pub before: DependencyResolution,
    pub after: DependencyInstallationState,
}

pub trait DependencySource: Send + Sync {
    fn resolve<'a>(
        &'a self,
        target: &'a DependencyTarget,
        context: &'a CompatibilityContext,
    ) -> BoxFuture<'a, Result<ResolvedArtifact, String>>;
}

pub struct ApiDependencySource {
    curseforge_api_key: Option<String>,
}

impl ApiDependencySource {
    pub fn new(curseforge_api_key: Option<String>) -> Self {
        Self { curseforge_api_key }
    }

    async fn resolve_modrinth(
        &self,
        target: &DependencyTarget,
        context: &CompatibilityContext,
    ) -> Result<ResolvedArtifact, String> {
        let version = if let Some(version_id) = target.version_id.as_deref() {
            modrinth_api::get_version(version_id).await?
        } else {
            let project_id = target.project_id.as_deref().ok_or_else(|| {
                "Modrinth dependency has neither project_id nor version_id".to_string()
            })?;
            let mut versions = modrinth_api::get_versions(project_id).await?;
            versions.sort_by(|left, right| right.date_published.cmp(&left.date_published));
            versions
                .into_iter()
                .find(|version| modrinth_compatible(version, context))
                .ok_or_else(|| compatibility_error(project_id, context))?
        };
        if !modrinth_compatible(&version, context) {
            return Err(compatibility_error(&version.project_id, context));
        }

        let project = modrinth_api::get_project(&version.project_id)
            .await
            .unwrap_or_else(|_| modrinth_api::ModrinthProject {
                id: version.project_id.clone(),
                slug: version.project_id.clone(),
                title: version.project_id.clone(),
                description: String::new(),
                icon_url: None,
            });
        artifact_from_modrinth(&project, &version, context)
    }

    async fn resolve_curseforge(
        &self,
        target: &DependencyTarget,
        context: &CompatibilityContext,
    ) -> Result<ResolvedArtifact, String> {
        let api_key = self
            .curseforge_api_key
            .as_deref()
            .ok_or_else(|| "CurseForge is not configured".to_string())?;
        let mod_id = target
            .project_id
            .as_deref()
            .ok_or_else(|| "CurseForge dependency is missing modId".to_string())?
            .parse::<u64>()
            .map_err(|_| "CurseForge modId is invalid".to_string())?;
        let file = if let Some(file_id) = target.file_id {
            curseforge_api::get_file(api_key, mod_id, file_id).await?
        } else {
            let mut files = curseforge_api::list_files(
                api_key,
                mod_id,
                Some(&context.minecraft_version),
                Some(&context.loader),
                50,
                0,
            )
            .await?
            .data;
            files.sort_by(|left, right| right.file_date.cmp(&left.file_date));
            files
                .into_iter()
                .find(|file| curseforge_compatible(file, context))
                .ok_or_else(|| compatibility_error(&mod_id.to_string(), context))?
        };
        if !curseforge_compatible(&file, context) {
            return Err(compatibility_error(&mod_id.to_string(), context));
        }

        let project = curseforge_api::get_mod(api_key, mod_id).await.unwrap_or(
            curseforge_api::CurseForgeMod {
                id: mod_id,
                class_id: None,
                allow_mod_distribution: None,
                name: mod_id.to_string(),
                summary: None,
                download_count: None,
                links: None,
                logo: None,
                authors: Vec::new(),
                latest_files_indexes: Vec::new(),
            },
        );
        curseforge_api::require_distribution_allowed(&project)?;
        let download_url = match file.download_url.clone() {
            Some(url) if !url.trim().is_empty() => url,
            _ => curseforge_api::get_download_url(api_key, mod_id, file.id)
                .await
                .map_err(|error| format!("CurseForge download URL is unavailable: {error}"))?,
        };
        artifact_from_curseforge(&project, &file, download_url, context)
    }
}

impl DependencySource for ApiDependencySource {
    fn resolve<'a>(
        &'a self,
        target: &'a DependencyTarget,
        context: &'a CompatibilityContext,
    ) -> BoxFuture<'a, Result<ResolvedArtifact, String>> {
        async move {
            match target.provider {
                ModProvider::Modrinth => self.resolve_modrinth(target, context).await,
                ModProvider::Curseforge => self.resolve_curseforge(target, context).await,
            }
        }
        .boxed()
    }
}

fn compatibility_error(project_id: &str, context: &CompatibilityContext) -> String {
    format!(
        "No file for project {project_id} proves compatibility with Minecraft {} and loader {}",
        context.minecraft_version, context.loader
    )
}

fn modrinth_compatible(
    version: &modrinth_api::ModrinthVersion,
    context: &CompatibilityContext,
) -> bool {
    version
        .game_versions
        .iter()
        .any(|value| value == &context.minecraft_version)
        && version
            .loaders
            .iter()
            .any(|value| value.eq_ignore_ascii_case(&context.loader))
}

fn curseforge_compatible(
    file: &curseforge_api::CurseForgeFile,
    context: &CompatibilityContext,
) -> bool {
    if !file
        .game_versions
        .iter()
        .any(|value| value == &context.minecraft_version)
    {
        return false;
    }

    let known_loaders = ["forge", "fabric", "quilt", "neoforge"];
    let declared_loaders: Vec<&str> = file
        .game_versions
        .iter()
        .filter_map(|value| {
            known_loaders
                .iter()
                .find(|loader| value.eq_ignore_ascii_case(loader))
                .copied()
        })
        .collect();
    // Version-only files (no loader tag) or files listing several loaders are
    // still installable as long as the instance loader is covered.
    declared_loaders.is_empty()
        || declared_loaders
            .iter()
            .any(|loader| loader.eq_ignore_ascii_case(&context.loader))
}

fn dependency_kind(value: &str) -> Option<DependencyKind> {
    match value {
        "required" => Some(DependencyKind::Required),
        "optional" => Some(DependencyKind::Optional),
        "incompatible" => Some(DependencyKind::Incompatible),
        _ => None,
    }
}

pub(crate) fn artifact_from_modrinth(
    project: &modrinth_api::ModrinthProject,
    version: &modrinth_api::ModrinthVersion,
    context: &CompatibilityContext,
) -> Result<ResolvedArtifact, String> {
    if !modrinth_compatible(version, context) {
        return Err(compatibility_error(&project.id, context));
    }
    let file = version
        .files
        .iter()
        .find(|file| file.primary)
        .or_else(|| version.files.first())
        .ok_or_else(|| format!("Modrinth version {} has no downloadable file", version.id))?;
    if file.url.trim().is_empty() {
        return Err(format!(
            "Modrinth version {} has no download URL",
            version.id
        ));
    }

    let dependencies = version
        .dependencies
        .iter()
        .filter_map(|dependency| {
            dependency_kind(&dependency.dependency_type).map(|kind| DependencyDeclaration {
                target: DependencyTarget {
                    provider: ModProvider::Modrinth,
                    project_id: dependency.project_id.clone(),
                    version_id: dependency.version_id.clone(),
                    file_id: None,
                },
                kind,
            })
        })
        .collect();

    Ok(ResolvedArtifact {
        project: ProjectIdentity {
            provider: ModProvider::Modrinth,
            project_id: project.id.clone(),
        },
        version_id: version.id.clone(),
        file_id: None,
        name: project.title.clone(),
        version: version.version_number.clone(),
        file_name: file.filename.clone(),
        download_url: file.url.clone(),
        sha1: Some(file.hashes.sha1.clone()),
        file_size: Some(file.size),
        description: Some(project.description.clone()),
        author: None,
        homepage_url: Some(format!("https://modrinth.com/mod/{}", project.slug)),
        cover_url: project.icon_url.clone(),
        game_versions: version.game_versions.clone(),
        loaders: version.loaders.clone(),
        updated_at: Some(version.date_published.clone()),
        dependencies,
    })
}

pub(crate) fn artifact_from_curseforge(
    project: &curseforge_api::CurseForgeMod,
    file: &curseforge_api::CurseForgeFile,
    download_url: String,
    context: &CompatibilityContext,
) -> Result<ResolvedArtifact, String> {
    if !curseforge_compatible(file, context) {
        return Err(compatibility_error(&project.id.to_string(), context));
    }
    if file.file_name.trim().is_empty() || download_url.trim().is_empty() {
        return Err(format!("CurseForge file {} is incomplete", file.id));
    }
    let dependencies = file
        .dependencies
        .iter()
        .filter_map(|dependency| {
            let kind = match dependency.relation_type {
                2 => DependencyKind::Optional,
                3 => DependencyKind::Required,
                5 => DependencyKind::Incompatible,
                _ => return None,
            };
            Some(DependencyDeclaration {
                target: DependencyTarget {
                    provider: ModProvider::Curseforge,
                    project_id: Some(dependency.mod_id.to_string()),
                    version_id: None,
                    file_id: None,
                },
                kind,
            })
        })
        .collect();
    let sha1 = file
        .hashes
        .iter()
        .find(|hash| hash.algo == 1)
        .map(|hash| hash.value.clone());
    let loaders = file
        .game_versions
        .iter()
        .filter(|value| {
            ["forge", "fabric", "quilt", "neoforge"]
                .iter()
                .any(|loader| value.eq_ignore_ascii_case(loader))
        })
        .map(|value| value.to_ascii_lowercase())
        .collect();

    Ok(ResolvedArtifact {
        project: ProjectIdentity {
            provider: ModProvider::Curseforge,
            project_id: project.id.to_string(),
        },
        version_id: file.id.to_string(),
        file_id: Some(file.id),
        name: project.name.clone(),
        version: file.file_name.clone(),
        file_name: file.file_name.clone(),
        download_url,
        sha1,
        file_size: file.file_length,
        description: project.summary.clone(),
        author: (!project.authors.is_empty()).then(|| {
            project
                .authors
                .iter()
                .map(|author| author.name.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        }),
        homepage_url: project
            .links
            .as_ref()
            .and_then(|links| links.website_url.clone()),
        cover_url: project
            .logo
            .as_ref()
            .and_then(|logo| logo.thumbnail_url.clone()),
        game_versions: file.game_versions.clone(),
        loaders,
        updated_at: Some(file.file_date.clone()),
        dependencies,
    })
}

#[derive(Default)]
struct ResolverState {
    artifacts: HashMap<ProjectIdentity, ResolvedArtifact>,
    order: Vec<ProjectIdentity>,
    stack: Vec<ProjectIdentity>,
    optional: Vec<DependencyNotice>,
    incompatible: Vec<DependencyNotice>,
    conflicts: Vec<DependencyNotice>,
    unresolved: Vec<UnresolvedDependency>,
    cycles: Vec<Vec<ProjectIdentity>>,
    edges: Vec<ResolvedDependencyEdge>,
}

fn visit<'a, S: DependencySource + ?Sized>(
    source: &'a S,
    target: DependencyTarget,
    context: &'a CompatibilityContext,
    installed: &'a HashSet<ProjectIdentity>,
    required_by: Option<ProjectIdentity>,
    state: &'a mut ResolverState,
) -> BoxFuture<'a, Option<ProjectIdentity>> {
    async move {
        if let Some(identity) = target.identity() {
            if state.artifacts.contains_key(&identity) {
                return Some(identity);
            }
            if let Some(position) = state.stack.iter().position(|item| item == &identity) {
                let mut cycle = state.stack[position..].to_vec();
                cycle.push(identity.clone());
                state.cycles.push(cycle);
                return Some(identity);
            }
        }

        let artifact = match source.resolve(&target, context).await {
            Ok(artifact) => artifact,
            Err(reason) => {
                state.unresolved.push(UnresolvedDependency {
                    required_by,
                    target,
                    reason,
                });
                return None;
            }
        };
        let identity = artifact.project.clone();
        if state.artifacts.contains_key(&identity) {
            return Some(identity);
        }
        if let Some(position) = state.stack.iter().position(|item| item == &identity) {
            let mut cycle = state.stack[position..].to_vec();
            cycle.push(identity.clone());
            state.cycles.push(cycle);
            return Some(identity);
        }

        state.stack.push(identity.clone());
        for dependency in artifact.dependencies.clone() {
            state.edges.push(ResolvedDependencyEdge {
                from: identity.clone(),
                to: dependency.target.clone(),
                kind: dependency.kind,
            });
            match dependency.kind {
                DependencyKind::Required => {
                    visit(
                        source,
                        dependency.target,
                        context,
                        installed,
                        Some(identity.clone()),
                        state,
                    )
                    .await;
                }
                DependencyKind::Optional | DependencyKind::Incompatible => {
                    let notice = DependencyNotice {
                        required_by: identity.clone(),
                        installed: dependency
                            .target
                            .identity()
                            .is_some_and(|item| installed.contains(&item)),
                        target: dependency.target,
                        kind: dependency.kind,
                    };
                    if dependency.kind == DependencyKind::Optional {
                        state.optional.push(notice);
                    } else {
                        if notice.installed {
                            state.conflicts.push(notice.clone());
                        }
                        state.incompatible.push(notice);
                    }
                }
            }
        }
        state.stack.pop();
        state.artifacts.insert(identity.clone(), artifact);
        state.order.push(identity.clone());
        Some(identity)
    }
    .boxed()
}

pub async fn resolve_with_source<S: DependencySource + ?Sized>(
    source: &S,
    root_target: DependencyTarget,
    context: CompatibilityContext,
    installed: HashSet<ProjectIdentity>,
) -> DependencyResolution {
    let mut state = ResolverState::default();
    let root_identity = visit(source, root_target, &context, &installed, None, &mut state).await;

    dedupe_notices(&mut state.optional);
    dedupe_notices(&mut state.incompatible);
    dedupe_notices(&mut state.conflicts);
    dedupe_cycles(&mut state.cycles);

    let root = root_identity
        .as_ref()
        .and_then(|identity| state.artifacts.get(identity))
        .cloned()
        .map(|artifact| PlannedMod {
            already_installed: installed.contains(&artifact.project),
            artifact,
        });
    let required = state
        .order
        .iter()
        .filter(|identity| Some(*identity) != root_identity.as_ref())
        .filter_map(|identity| state.artifacts.get(identity).cloned())
        .map(|artifact| PlannedMod {
            already_installed: installed.contains(&artifact.project),
            artifact,
        })
        .collect::<Vec<_>>();
    let install_order = state
        .order
        .iter()
        .filter(|identity| !installed.contains(*identity))
        .filter_map(|identity| state.artifacts.get(identity).cloned())
        .collect::<Vec<_>>();
    let can_install = root.is_some() && state.unresolved.is_empty() && state.conflicts.is_empty();

    DependencyResolution {
        context,
        root,
        required,
        optional: state.optional,
        incompatible: state.incompatible,
        conflicts: state.conflicts,
        unresolved_required: state.unresolved,
        cycles: state.cycles,
        edges: state.edges,
        install_order,
        can_install,
    }
}

fn dedupe_notices(notices: &mut Vec<DependencyNotice>) {
    let mut seen = HashSet::new();
    notices.retain(|notice| {
        seen.insert((
            notice.required_by.clone(),
            notice.target.provider,
            notice.target.display_id(),
            notice.kind,
        ))
    });
}

fn dedupe_cycles(cycles: &mut Vec<Vec<ProjectIdentity>>) {
    let mut seen = HashSet::new();
    cycles.retain(|cycle| {
        let mut keys = cycle
            .iter()
            .map(ProjectIdentity::registry_key)
            .collect::<Vec<_>>();
        keys.sort();
        seen.insert(keys.join("|"))
    });
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct RegisteredPackage {
    project: ProjectIdentity,
    version_id: String,
    file_id: Option<u64>,
    mod_id: String,
    name: String,
    file_name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct RegisteredRoot {
    project: ProjectIdentity,
    required_projects: Vec<ProjectIdentity>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct RegisteredEdge {
    root: ProjectIdentity,
    from: ProjectIdentity,
    to: ProjectIdentity,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct DependencyRegistry {
    schema_version: u32,
    packages: HashMap<String, RegisteredPackage>,
    roots: HashMap<String, RegisteredRoot>,
    edges: Vec<RegisteredEdge>,
}

impl Default for DependencyRegistry {
    fn default() -> Self {
        Self {
            schema_version: REGISTRY_SCHEMA_VERSION,
            packages: HashMap::new(),
            roots: HashMap::new(),
            edges: Vec::new(),
        }
    }
}

impl DependencyRegistry {
    fn reference_counts(&self) -> HashMap<String, usize> {
        self.packages
            .keys()
            .map(|key| {
                let count = self
                    .roots
                    .values()
                    .filter(|root| {
                        root.project.registry_key() == *key
                            || root
                                .required_projects
                                .iter()
                                .any(|project| project.registry_key() == *key)
                    })
                    .count();
                (key.clone(), count)
            })
            .collect()
    }

    fn installed_projects(&self) -> HashSet<ProjectIdentity> {
        self.packages
            .values()
            .map(|package| package.project.clone())
            .collect()
    }
}

fn registry_path(app_data_dir: &Path, instance_id: &str) -> PathBuf {
    app_data_dir
        .join("config")
        .join(format!("{instance_id}_dependency_registry.json"))
}

fn load_registry(app_data_dir: &Path, instance_id: &str) -> Result<DependencyRegistry, String> {
    let path = registry_path(app_data_dir, instance_id);
    if !path.exists() {
        return Ok(DependencyRegistry::default());
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read dependency registry: {error}"))?;
    serde_json::from_str(&content)
        .map_err(|error| format!("Dependency registry is invalid: {error}"))
}

fn save_registry(
    app_data_dir: &Path,
    instance_id: &str,
    registry: &DependencyRegistry,
) -> Result<(), String> {
    let path = registry_path(app_data_dir, instance_id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create registry directory: {error}"))?;
    }
    let temp_path = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let backup_path = path.with_extension(format!("{}.bak", Uuid::new_v4()));
    let content = serde_json::to_vec_pretty(registry)
        .map_err(|error| format!("Failed to serialize dependency registry: {error}"))?;
    fs::write(&temp_path, content)
        .map_err(|error| format!("Failed to write dependency registry: {error}"))?;

    let had_registry = path.exists();
    if had_registry {
        fs::rename(&path, &backup_path).map_err(|error| {
            let _ = fs::remove_file(&temp_path);
            format!("Failed to stage dependency registry: {error}")
        })?;
    }
    if let Err(error) = fs::rename(&temp_path, &path) {
        if had_registry {
            let _ = fs::rename(&backup_path, &path);
        }
        let _ = fs::remove_file(&temp_path);
        return Err(format!("Failed to commit dependency registry: {error}"));
    }
    if had_registry {
        if let Err(error) = fs::remove_file(&backup_path) {
            eprintln!(
                "[WARN] [DependencyResolver] Failed to remove registry backup '{}': {error}",
                backup_path.display()
            );
        }
    }
    Ok(())
}

fn sync_registry_with_mods(registry: &mut DependencyRegistry, mods: &[Mod]) {
    let mod_ids = mods
        .iter()
        .map(|item| item.id.as_str())
        .collect::<HashSet<_>>();
    registry
        .packages
        .retain(|_, package| mod_ids.contains(package.mod_id.as_str()));
    registry
        .roots
        .retain(|key, _| registry.packages.contains_key(key));
    registry.edges.retain(|edge| {
        registry.roots.contains_key(&edge.root.registry_key())
            && registry.packages.contains_key(&edge.from.registry_key())
            && registry.packages.contains_key(&edge.to.registry_key())
    });

    for item in mods {
        let Some(project) = infer_project_identity(item) else {
            continue;
        };
        let key = project.registry_key();
        registry.packages.entry(key).or_insert(RegisteredPackage {
            project,
            version_id: item.version.clone(),
            file_id: None,
            mod_id: item.id.clone(),
            name: item.name.clone(),
            file_name: item
                .files
                .first()
                .and_then(|path| Path::new(path).file_name())
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| item.name.clone()),
        });
    }
}

fn infer_project_identity(item: &Mod) -> Option<ProjectIdentity> {
    let provider = match item.source.as_deref()? {
        "modrinth" => ModProvider::Modrinth,
        "curseforge" => ModProvider::Curseforge,
        _ => return None,
    };
    let url = item.homepage_url.as_deref()?;
    let project_id = match provider {
        ModProvider::Modrinth => url
            .split("/mod/")
            .nth(1)
            .and_then(|tail| tail.split(['/', '?', '#']).next())?
            .to_string(),
        ModProvider::Curseforge => return None,
    };
    Some(ProjectIdentity {
        provider,
        project_id,
    })
}

pub async fn resolve_for_instance(
    app_data_dir: &Path,
    instance: &GameInstance,
    request: &ResolveDependenciesRequest,
    curseforge_api_key: Option<String>,
) -> Result<DependencyResolution, String> {
    if request.instance_id != instance.id {
        return Err("Dependency request targets another instance".to_string());
    }
    let context = CompatibilityContext::from_instance(instance)?;
    let manager = ModManager::new(app_data_dir.to_path_buf());
    let mods = manager.load_mods(&instance.id);
    let mut registry = load_registry(app_data_dir, &instance.id)?;
    sync_registry_with_mods(&mut registry, &mods);
    let source = ApiDependencySource::new(curseforge_api_key);
    let mut resolution = resolve_with_source(
        &source,
        request.target(),
        context,
        registry.installed_projects(),
    )
    .await;
    apply_request_metadata(&mut resolution, request);
    Ok(resolution)
}

pub async fn install_for_instance(
    app_data_dir: &Path,
    instance: &GameInstance,
    request: &ResolveDependenciesRequest,
    curseforge_api_key: Option<String>,
) -> Result<DependencyInstallResult, String> {
    let manager = ModManager::new(app_data_dir.to_path_buf());
    let mods = manager.load_mods(&instance.id);
    let mut registry = load_registry(app_data_dir, &instance.id)?;
    sync_registry_with_mods(&mut registry, &mods);
    let source = ApiDependencySource::new(curseforge_api_key);
    let mut before = resolve_with_source(
        &source,
        request.target(),
        CompatibilityContext::from_instance(instance)?,
        registry.installed_projects(),
    )
    .await;
    apply_request_metadata(&mut before, request);

    let skipped = before
        .root
        .iter()
        .chain(before.required.iter())
        .filter(|item| item.already_installed)
        .map(|item| item.artifact.project.clone())
        .collect::<Vec<_>>();
    if !before.can_install {
        return Ok(DependencyInstallResult {
            before,
            after: DependencyInstallationState {
                status: InstallationStatus::Blocked,
                installed: Vec::new(),
                skipped,
                rolled_back: Vec::new(),
                rollback_failures: Vec::new(),
                failure: None,
                reference_counts: registry.reference_counts(),
            },
        });
    }

    let mut installed = Vec::new();
    let mut new_packages = Vec::new();
    for artifact in &before.install_order {
        match install_artifact(app_data_dir, instance, &manager, artifact).await {
            Ok((installed_artifact, package)) => {
                installed.push(installed_artifact);
                new_packages.push(package);
            }
            Err(message) => {
                let after = rollback_installation(
                    &manager,
                    instance,
                    installed,
                    InstallationFailure {
                        project: Some(artifact.project.clone()),
                        message,
                    },
                    skipped,
                    registry.reference_counts(),
                );
                return Ok(DependencyInstallResult { before, after });
            }
        }
    }

    if let Err(message) = manager.deploy(&instance.id, "minecraft", &instance.install_path) {
        let after = rollback_installation(
            &manager,
            instance,
            installed,
            InstallationFailure {
                project: before
                    .root
                    .as_ref()
                    .map(|item| item.artifact.project.clone()),
                message: format!("Deployment failed: {message}"),
            },
            skipped,
            registry.reference_counts(),
        );
        return Ok(DependencyInstallResult { before, after });
    }

    for package in new_packages {
        registry
            .packages
            .insert(package.project.registry_key(), package);
    }
    register_root(&mut registry, &before)?;
    if let Err(message) = save_registry(app_data_dir, &instance.id, &registry) {
        let after = rollback_installation(
            &manager,
            instance,
            installed,
            InstallationFailure {
                project: before
                    .root
                    .as_ref()
                    .map(|item| item.artifact.project.clone()),
                message,
            },
            skipped,
            HashMap::new(),
        );
        return Ok(DependencyInstallResult { before, after });
    }

    let status = if installed.is_empty() {
        InstallationStatus::NoChanges
    } else {
        InstallationStatus::Installed
    };
    Ok(DependencyInstallResult {
        before,
        after: DependencyInstallationState {
            status,
            installed,
            skipped,
            rolled_back: Vec::new(),
            rollback_failures: Vec::new(),
            failure: None,
            reference_counts: registry.reference_counts(),
        },
    })
}

async fn install_artifact(
    app_data_dir: &Path,
    instance: &GameInstance,
    manager: &ModManager,
    artifact: &ResolvedArtifact,
) -> Result<(InstalledArtifact, RegisteredPackage), String> {
    let file_name = path_security::safe_file_name(&artifact.file_name, &["jar"])
        .map_err(|error| format!("Invalid mod file name: {error}"))?;
    let downloads_dir = app_data_dir.join("downloads").join("minecraft");
    let download_path = download_artifact(&downloads_dir, artifact).await?;
    let target_rel = format!("mods/{file_name}");
    let installed_mod = manager.install_mod_file(
        &instance.id,
        &download_path.to_string_lossy(),
        &target_rel,
        Some(ModMetadata {
            name: Some(artifact.name.clone()),
            version: Some(artifact.version.clone()),
            description: artifact.description.clone(),
            source: Some(artifact.project.provider.as_str().to_string()),
            author: artifact.author.clone(),
            homepage_url: artifact.homepage_url.clone(),
            cover_url: artifact.cover_url.clone(),
            file_size: artifact.file_size,
            game_versions: artifact.game_versions.clone(),
            loaders: artifact.loaders.clone(),
            updated_at: artifact.updated_at.clone(),
        }),
    );
    let _ = tokio::fs::remove_file(&download_path).await;
    let installed_mod = installed_mod?;
    let installed_artifact = InstalledArtifact {
        project: artifact.project.clone(),
        mod_id: installed_mod.id.clone(),
        name: artifact.name.clone(),
        file_name: file_name.clone(),
    };
    let package = RegisteredPackage {
        project: artifact.project.clone(),
        version_id: artifact.version_id.clone(),
        file_id: artifact.file_id,
        mod_id: installed_mod.id,
        name: artifact.name.clone(),
        file_name,
    };
    Ok((installed_artifact, package))
}

async fn download_artifact(
    downloads_dir: &Path,
    artifact: &ResolvedArtifact,
) -> Result<PathBuf, String> {
    tokio::fs::create_dir_all(downloads_dir)
        .await
        .map_err(|error| format!("Failed to create download directory: {error}"))?;
    let safe_name = path_security::safe_file_name(&artifact.file_name, &["jar"])
        .map_err(|error| format!("Invalid mod file name: {error}"))?;
    let final_path = downloads_dir.join(format!("{}-{safe_name}", Uuid::new_v4()));
    let partial_path = final_path.with_extension("part");

    let result = async {
        let client = reqwest::Client::builder()
            .user_agent("KizaLauncherAlpha/0.1")
            .build()
            .map_err(|error| error.to_string())?;
        let mut response = client
            .get(&artifact.download_url)
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if !response.status().is_success() {
            return Err(format!("HTTP {}", response.status()));
        }
        let mut file = tokio::fs::File::create(&partial_path)
            .await
            .map_err(|error| error.to_string())?;
        let mut hasher = Sha1::new();
        while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
            hasher.update(&chunk);
            file.write_all(&chunk)
                .await
                .map_err(|error| error.to_string())?;
        }
        file.flush().await.map_err(|error| error.to_string())?;
        if let Some(expected) = artifact.sha1.as_deref() {
            let actual = format!("{:x}", hasher.finalize());
            if !actual.eq_ignore_ascii_case(expected) {
                return Err("SHA1 mismatch".to_string());
            }
        }
        tokio::fs::rename(&partial_path, &final_path)
            .await
            .map_err(|error| error.to_string())?;
        Ok(final_path.clone())
    }
    .await;

    if result.is_err() {
        let _ = tokio::fs::remove_file(&partial_path).await;
        let _ = tokio::fs::remove_file(&final_path).await;
    }
    result
}

fn rollback_installation(
    manager: &ModManager,
    instance: &GameInstance,
    installed: Vec<InstalledArtifact>,
    failure: InstallationFailure,
    skipped: Vec<ProjectIdentity>,
    reference_counts: HashMap<String, usize>,
) -> DependencyInstallationState {
    let mut rolled_back = Vec::new();
    let mut rollback_failures = Vec::new();
    for item in installed.into_iter().rev() {
        match manager.delete_mod(&instance.id, &item.mod_id, &instance.install_path) {
            Ok(_) => rolled_back.push(item),
            Err(error) => rollback_failures.push(InstallationFailure {
                project: Some(item.project),
                message: error.to_string(),
            }),
        }
    }
    let status = if rollback_failures.is_empty() {
        InstallationStatus::RolledBack
    } else {
        InstallationStatus::RollbackIncomplete
    };
    DependencyInstallationState {
        status,
        installed: Vec::new(),
        skipped,
        rolled_back,
        rollback_failures,
        failure: Some(failure),
        reference_counts,
    }
}

fn register_root(
    registry: &mut DependencyRegistry,
    resolution: &DependencyResolution,
) -> Result<(), String> {
    let root = resolution
        .root
        .as_ref()
        .ok_or_else(|| "Cannot register an unresolved root".to_string())?
        .artifact
        .project
        .clone();
    let required_projects = resolution
        .required
        .iter()
        .map(|item| item.artifact.project.clone())
        .collect::<Vec<_>>();
    let root_key = root.registry_key();
    registry.roots.insert(
        root_key.clone(),
        RegisteredRoot {
            project: root.clone(),
            required_projects,
        },
    );
    registry.edges.retain(|edge| edge.root != root);
    for edge in resolution
        .edges
        .iter()
        .filter(|edge| edge.kind == DependencyKind::Required)
    {
        if let Some(to) = edge.to.identity() {
            registry.edges.push(RegisteredEdge {
                root: root.clone(),
                from: edge.from.clone(),
                to,
            });
        }
    }
    Ok(())
}

#[derive(Clone, Debug)]
struct RegistryDeletionPlan {
    selected_key: Option<String>,
    orphan_keys: Vec<String>,
    preserved_shared_keys: Vec<String>,
    next_registry: DependencyRegistry,
}

fn plan_registry_deletion(
    registry: &DependencyRegistry,
    mod_id: &str,
) -> Result<RegistryDeletionPlan, String> {
    let Some((selected_key, selected_package)) = registry
        .packages
        .iter()
        .find(|(_, package)| package.mod_id == mod_id)
    else {
        return Ok(RegistryDeletionPlan {
            selected_key: None,
            orphan_keys: Vec::new(),
            preserved_shared_keys: Vec::new(),
            next_registry: registry.clone(),
        });
    };
    let selected_key = selected_key.clone();
    let counts = registry.reference_counts();
    let selected_is_root = registry.roots.contains_key(&selected_key);
    let other_references = counts
        .get(&selected_key)
        .copied()
        .unwrap_or(0)
        .saturating_sub(usize::from(selected_is_root));
    if other_references > 0 {
        return Err(format!(
            "{} is still required by {other_references} installed root mod(s)",
            selected_package.name
        ));
    }

    let selected_required_keys = registry
        .roots
        .get(&selected_key)
        .map(|root| {
            root.required_projects
                .iter()
                .map(ProjectIdentity::registry_key)
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    let mut next_registry = registry.clone();
    next_registry.roots.remove(&selected_key);
    next_registry
        .edges
        .retain(|edge| edge.root.registry_key() != selected_key);
    next_registry.packages.remove(&selected_key);
    let next_counts = next_registry.reference_counts();
    let orphan_keys = registry
        .packages
        .keys()
        .filter(|key| *key != &selected_key)
        .filter(|key| counts.get(*key).copied().unwrap_or(0) > 0)
        .filter(|key| next_counts.get(*key).copied().unwrap_or(0) == 0)
        .cloned()
        .collect::<Vec<_>>();
    let preserved_shared_keys = selected_required_keys
        .into_iter()
        .filter(|key| next_counts.get(key).copied().unwrap_or(0) > 0)
        .collect::<Vec<_>>();

    Ok(RegistryDeletionPlan {
        selected_key: Some(selected_key),
        orphan_keys,
        preserved_shared_keys,
        next_registry,
    })
}

pub fn delete_managed_mod(
    app_data_dir: &Path,
    manager: &ModManager,
    instance: &GameInstance,
    mod_id: &str,
) -> Result<DeleteModResult, AppError> {
    let mut registry = load_registry(app_data_dir, &instance.id).map_err(|error| {
        AppError::new(
            "dependency_registry_invalid",
            error,
            true,
            Some("Repair the dependency registry before deleting this mod."),
        )
    })?;
    sync_registry_with_mods(&mut registry, &manager.load_mods(&instance.id));
    let plan = plan_registry_deletion(&registry, mod_id).map_err(|error| {
        AppError::new(
            "dependency_still_required",
            error,
            false,
            Some("Remove the root mods that use this dependency first."),
        )
    })?;
    let mut result = manager.delete_mod(&instance.id, mod_id, &instance.install_path)?;
    if plan.selected_key.is_none() {
        return Ok(result);
    }

    result.shared_dependencies_preserved = plan.preserved_shared_keys.len();
    let mut next_registry = plan.next_registry;
    for orphan_key in plan.orphan_keys {
        let Some(package) = registry.packages.get(&orphan_key) else {
            continue;
        };
        match manager.delete_mod(&instance.id, &package.mod_id, &instance.install_path) {
            Ok(_) => {
                result.orphan_dependencies_removed += 1;
                next_registry.packages.remove(&orphan_key);
            }
            Err(_) => {
                result.cleanup_pending = true;
                result.orphan_dependencies_preserved += 1;
                next_registry.packages.insert(orphan_key, package.clone());
            }
        }
    }
    save_registry(app_data_dir, &instance.id, &next_registry).map_err(|error| {
        AppError::new(
            "dependency_registry_write_failed",
            error,
            true,
            Some("Retry after checking write permissions for the launcher data directory."),
        )
    })?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct ModrinthFixture {
        projects: Vec<ModrinthFixtureProject>,
    }

    #[derive(Deserialize)]
    struct ModrinthFixtureProject {
        project: modrinth_api::ModrinthProject,
        versions: Vec<modrinth_api::ModrinthVersion>,
    }

    struct FixtureSource {
        artifacts: HashMap<ProjectIdentity, ResolvedArtifact>,
    }

    impl DependencySource for FixtureSource {
        fn resolve<'a>(
            &'a self,
            target: &'a DependencyTarget,
            _context: &'a CompatibilityContext,
        ) -> BoxFuture<'a, Result<ResolvedArtifact, String>> {
            async move {
                let identity = target
                    .identity()
                    .ok_or_else(|| "fixture target missing project id".to_string())?;
                self.artifacts
                    .get(&identity)
                    .cloned()
                    .ok_or_else(|| format!("fixture file missing for {}", identity.project_id))
            }
            .boxed()
        }
    }

    fn fabric_context() -> CompatibilityContext {
        CompatibilityContext {
            minecraft_version: "1.21.1".to_string(),
            loader: "fabric".to_string(),
        }
    }

    fn modrinth_fixture_source() -> FixtureSource {
        let fixture: ModrinthFixture = serde_json::from_str(include_str!(
            "../tests/fixtures/dependencies/modrinth_graph.json"
        ))
        .expect("valid Modrinth fixture");
        let context = fabric_context();
        let artifacts = fixture
            .projects
            .into_iter()
            .map(|entry| {
                let artifact = artifact_from_modrinth(
                    &entry.project,
                    entry.versions.first().expect("fixture version"),
                    &context,
                )
                .expect("compatible fixture");
                (artifact.project.clone(), artifact)
            })
            .collect();
        FixtureSource { artifacts }
    }

    #[tokio::test]
    async fn resolves_shared_graph_once_and_reports_cycle_and_optional() {
        let source = modrinth_fixture_source();
        let plan = resolve_with_source(
            &source,
            DependencyTarget {
                provider: ModProvider::Modrinth,
                project_id: Some("root".to_string()),
                version_id: None,
                file_id: None,
            },
            fabric_context(),
            HashSet::new(),
        )
        .await;

        assert!(plan.can_install);
        assert_eq!(
            plan.required
                .iter()
                .filter(|item| item.artifact.project.project_id == "fabric-api")
                .count(),
            1
        );
        assert_eq!(plan.optional.len(), 1);
        assert_eq!(plan.incompatible.len(), 1);
        assert_eq!(plan.cycles.len(), 1);
        assert_eq!(plan.install_order.len(), 4);
    }

    #[test]
    fn rejects_a_loader_mismatch_and_a_missing_file() {
        let fixture: ModrinthFixture = serde_json::from_str(include_str!(
            "../tests/fixtures/dependencies/modrinth_graph.json"
        ))
        .expect("valid Modrinth fixture");
        let root = &fixture.projects[0];
        let forge_context = CompatibilityContext {
            minecraft_version: "1.21.1".to_string(),
            loader: "forge".to_string(),
        };
        assert!(artifact_from_modrinth(&root.project, &root.versions[0], &forge_context).is_err());

        let mut missing_file = root.versions[0].clone();
        missing_file.files.clear();
        assert!(artifact_from_modrinth(&root.project, &missing_file, &fabric_context()).is_err());
    }

    #[test]
    fn curseforge_relation_types_and_exact_loader_are_mapped() {
        #[derive(Deserialize)]
        struct CurseFixture {
            project: curseforge_api::CurseForgeMod,
            file: curseforge_api::CurseForgeFile,
        }
        let fixture: CurseFixture = serde_json::from_str(include_str!(
            "../tests/fixtures/dependencies/curseforge_file.json"
        ))
        .expect("valid CurseForge fixture");
        let artifact = artifact_from_curseforge(
            &fixture.project,
            &fixture.file,
            "https://example.invalid/root.jar".to_string(),
            &fabric_context(),
        )
        .expect("compatible fixture");
        assert_eq!(artifact.dependencies.len(), 3);
        assert!(artifact
            .dependencies
            .iter()
            .any(|dependency| dependency.kind == DependencyKind::Optional));

        let quilt_context = CompatibilityContext {
            minecraft_version: "1.21.1".to_string(),
            loader: "quilt".to_string(),
        };
        assert!(artifact_from_curseforge(
            &fixture.project,
            &fixture.file,
            "https://example.invalid/root.jar".to_string(),
            &quilt_context,
        )
        .is_err());
    }

    #[test]
    fn prevents_deleting_a_dependency_still_used_by_another_root() {
        let dependency = ProjectIdentity {
            provider: ModProvider::Modrinth,
            project_id: "fabric-api".to_string(),
        };
        let root_a = ProjectIdentity {
            provider: ModProvider::Modrinth,
            project_id: "root-a".to_string(),
        };
        let root_b = ProjectIdentity {
            provider: ModProvider::Modrinth,
            project_id: "root-b".to_string(),
        };
        let mut registry = DependencyRegistry::default();
        for (project, mod_id) in [
            (dependency.clone(), "dep-mod"),
            (root_a.clone(), "root-a-mod"),
            (root_b.clone(), "root-b-mod"),
        ] {
            registry.packages.insert(
                project.registry_key(),
                RegisteredPackage {
                    project,
                    version_id: "1".to_string(),
                    file_id: None,
                    mod_id: mod_id.to_string(),
                    name: mod_id.to_string(),
                    file_name: format!("{mod_id}.jar"),
                },
            );
        }
        for root in [root_a, root_b] {
            registry.roots.insert(
                root.registry_key(),
                RegisteredRoot {
                    project: root,
                    required_projects: vec![dependency.clone()],
                },
            );
        }

        let error = plan_registry_deletion(&registry, "dep-mod").expect_err("dependency is used");
        assert!(error.contains("2 installed root"));
        let plan = plan_registry_deletion(&registry, "root-a-mod").expect("root deletion plan");
        assert!(plan.orphan_keys.is_empty());
        assert_eq!(plan.preserved_shared_keys, vec![dependency.registry_key()]);
    }
}
