//! Turning a compatibility report into something that can be done about it.
//!
//! The report has always been able to say what is wrong. It could not say
//! what to do, and the person reading it was left to work that out one line
//! at a time: find the mod, find a version, check it does not break the mod
//! next to it, repeat. That is a loop with rules, and a loop with rules is a
//! program.
//!
//! This is that program, in two halves. [`plan`] reads the report and every
//! constraint in the mods folder and decides, for each problem, the one thing
//! that would resolve it -- or says plainly that nothing would. It is pure:
//! given the same facts and the same catalogue it gives the same plan, and it
//! runs against a fake catalogue in the tests. Applying the plan is the other
//! half, in `lib.rs`, where the downloads are.
//!
//! # What "fix" is allowed to mean
//!
//! Only what the loader would accept. A dependency asked for by four mods is
//! moved to a version all four accept, never to one that satisfies the loudest
//! complaint and breaks the other three. A mod made for another Minecraft is
//! moved to a release for this one if its author published one, and left
//! alone with a reason if not. A conflict between two mods is not fixed at
//! all: one of them has to go, and which one is a choice the launcher has no
//! business making.
//!
//! # What it refuses to touch
//!
//! A jar nobody told the launcher the origin of. Fixing means replacing, and
//! replacing means knowing what to replace it with; a mod dropped into the
//! folder by hand has no catalogue behind it. Rather than guess from the file
//! name, the plan says it does not know where the mod came from, which is
//! true, and leaves it.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

use crate::content_provenance::ContentOrigin;
use crate::mod_compat::{self, CompatReport, IssueKind, ModRequirement, ProvidedMod};

/// One release of a project, as the catalogue lists it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Candidate {
    pub version_id: String,
    pub version_number: String,
}

/// Where fixes come from. Real over the network; fake in tests.
pub trait Catalogue {
    /// Releases of a project for this Minecraft and loader, newest first.
    fn versions_of(&self, project_id: &str, mc_version: &str, loader: &str) -> Vec<Candidate>;
    /// The project publishing the mod with this id, if any.
    fn project_for_mod_id(&self, mod_id: &str) -> Option<(String, String)>;
}

/// A catalogue filled in ahead of time, so planning stays pure.
///
/// The network happens before the plan and not inside it: the command asks
/// what the plan will need, fetches it, and hands over the answers. The plan
/// is then a function of facts, which is what lets it be tested without a
/// network and reasoned about without one.
#[derive(Default)]
pub struct Prefetched {
    pub projects: HashMap<String, (String, String)>,
    pub versions: HashMap<String, Vec<Candidate>>,
}

impl Catalogue for Prefetched {
    fn versions_of(&self, project_id: &str, _mc: &str, _loader: &str) -> Vec<Candidate> {
        self.versions.get(project_id).cloned().unwrap_or_default()
    }

    fn project_for_mod_id(&self, mod_id: &str) -> Option<(String, String)> {
        self.projects.get(mod_id).cloned()
    }
}

/// What the plan is going to ask the catalogue for.
///
/// Returned as two lists because they are answered in two rounds: a mod id
/// has to become a project before that project's releases can be listed.
pub struct Lookups {
    /// Mod ids that are required, absent, and of unknown origin.
    pub mod_ids: Vec<String>,
    /// Projects whose releases are needed.
    pub project_ids: Vec<String>,
}

pub fn lookups(facts: &Facts<'_>) -> Lookups {
    let mut mod_ids = Vec::new();
    let mut project_ids = Vec::new();
    let push = |list: &mut Vec<String>, value: String| {
        if !list.contains(&value) {
            list.push(value);
        }
    };

    for entry in &facts.report.mods {
        for issue in &entry.issues {
            match &issue.kind {
                IssueKind::MissingDependency { dep_id, .. }
                | IssueKind::DependencyVersion { dep_id, .. } => {
                    let installed = facts.provided.iter().find(|p| p.id == *dep_id);
                    match installed.and_then(|file| facts.origins.get(&file.file_name)) {
                        Some(origin) => push(&mut project_ids, origin.project_id.clone()),
                        None if installed.is_none() => push(&mut mod_ids, dep_id.clone()),
                        None => {}
                    }
                }
                IssueKind::WrongMinecraft { .. } => {
                    if let Some(origin) = facts.origins.get(&entry.file_name) {
                        push(&mut project_ids, origin.project_id.clone());
                    }
                }
                _ => {}
            }
        }
    }
    Lookups {
        mod_ids,
        project_ids,
    }
}

/// One thing the plan proposes.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum FixStep {
    /// Fetch a mod that is required and absent.
    Install {
        dep_id: String,
        project_id: String,
        name: String,
        /// The release chosen, satisfying every range that asks for it.
        version_id: String,
        version: String,
    },
    /// Swap an installed jar for another release of the same project.
    Replace {
        file_name: String,
        mod_id: String,
        project_id: String,
        version_id: String,
        version: String,
        /// Why: what the current file fails.
        reason: String,
    },
    /// Offered, never done unasked: the file cannot load here at all.
    Disable { file_name: String, reason: String },
    /// Named so the person knows the launcher looked, and why it stopped.
    Unfixable { file_name: String, reason: String },
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct FixPlan {
    pub steps: Vec<FixStep>,
}

impl FixPlan {
    /// Whether anything in here is actually going to be done.
    #[cfg(test)]
    pub fn has_work(&self) -> bool {
        self.steps
            .iter()
            .any(|step| matches!(step, FixStep::Install { .. } | FixStep::Replace { .. }))
    }
}

/// The facts the plan is drawn from.
pub struct Facts<'a> {
    pub report: &'a CompatReport,
    pub provided: &'a [ProvidedMod],
    pub required: &'a [ModRequirement],
    /// File name to where the launcher got it, for files it installed.
    pub origins: &'a BTreeMap<String, ContentOrigin>,
    pub mc_version: &'a str,
    pub loader: &'a str,
}

/// Decides what to do about every problem in the report.
pub fn plan(facts: &Facts<'_>, catalogue: &dyn Catalogue) -> FixPlan {
    let mut steps = Vec::new();
    // Each dependency is solved once, however many mods complained about it.
    let mut solved_dependencies: HashMap<String, ()> = HashMap::new();

    for entry in &facts.report.mods {
        for issue in &entry.issues {
            match &issue.kind {
                IssueKind::MissingDependency { dep_id, .. }
                | IssueKind::DependencyVersion { dep_id, .. } => {
                    if solved_dependencies.contains_key(dep_id) {
                        continue;
                    }
                    solved_dependencies.insert(dep_id.clone(), ());
                    steps.push(solve_dependency(facts, catalogue, dep_id, &entry.file_name));
                }
                IssueKind::WrongMinecraft { .. } => {
                    steps.push(solve_wrong_minecraft(facts, catalogue, entry));
                }
                IssueKind::WrongLoader => steps.push(FixStep::Disable {
                    file_name: entry.file_name.clone(),
                    reason: issue.message.clone(),
                }),
                IssueKind::Conflict { with_id, .. } => steps.push(FixStep::Unfixable {
                    file_name: entry.file_name.clone(),
                    reason: format!(
                        "It declares that it cannot run beside {with_id}. One of the two has to go, and that is your call."
                    ),
                }),
                IssueKind::Other => {}
            }
        }
    }

    FixPlan { steps }
}

/// The one release of a dependency that every mod asking for it accepts.
///
/// All the ranges are gathered first, and each candidate is checked against
/// all of them. Satisfying the range that produced the issue is not enough:
/// that is how a fix for one mod becomes a new problem for the mod next to it,
/// and the report would simply move rather than shrink.
fn solve_dependency(
    facts: &Facts<'_>,
    catalogue: &dyn Catalogue,
    dep_id: &str,
    asked_by: &str,
) -> FixStep {
    let ranges: Vec<&serde_json::Value> = facts
        .required
        .iter()
        .filter(|requirement| requirement.dep_id == dep_id)
        .map(|requirement| &requirement.range)
        .collect();
    let askers: Vec<&str> = facts
        .required
        .iter()
        .filter(|requirement| requirement.dep_id == dep_id)
        .map(|requirement| requirement.mod_id.as_str())
        .collect();

    // Is it installed already, and if so where did it come from?
    let installed = facts.provided.iter().find(|provided| provided.id == dep_id);

    let (project_id, name) = match installed.and_then(|file| facts.origins.get(&file.file_name)) {
        Some(origin) => (origin.project_id.clone(), dep_id.to_string()),
        None => match installed {
            // Installed by hand: nothing to replace it with that is known to
            // be the same mod.
            Some(file) => {
                return FixStep::Unfixable {
                    file_name: file.file_name.clone(),
                    reason: format!(
                        "{dep_id} is installed from a file the launcher did not fetch, so it does not know which project to look in for another version."
                    ),
                };
            }
            None => match catalogue.project_for_mod_id(dep_id) {
                Some(found) => found,
                None => {
                    return FixStep::Unfixable {
                        file_name: asked_by.to_string(),
                        reason: format!("No catalogue publishes a mod called {dep_id}."),
                    };
                }
            },
        },
    };

    let candidates = catalogue.versions_of(&project_id, facts.mc_version, facts.loader);
    let chosen = candidates.iter().find(|candidate| {
        ranges
            .iter()
            .all(|range| mod_compat::range_accepts(range, &candidate.version_number) != Some(false))
    });

    match (chosen, installed) {
        (Some(candidate), Some(file)) => FixStep::Replace {
            file_name: file.file_name.clone(),
            mod_id: dep_id.to_string(),
            project_id,
            version_id: candidate.version_id.clone(),
            version: candidate.version_number.clone(),
            reason: format!(
                "{} is installed, and {} need {}.",
                file.version,
                askers.join(", "),
                describe_ranges(&ranges)
            ),
        },
        (Some(candidate), None) => FixStep::Install {
            dep_id: dep_id.to_string(),
            project_id,
            name,
            version_id: candidate.version_id.clone(),
            version: candidate.version_number.clone(),
        },
        (None, _) => FixStep::Unfixable {
            file_name: installed
                .map(|file| file.file_name.clone())
                .unwrap_or_else(|| asked_by.to_string()),
            reason: if candidates.is_empty() {
                format!(
                    "{name} has no release for Minecraft {} on {}.",
                    facts.mc_version, facts.loader
                )
            } else {
                format!(
                    "No release of {name} satisfies every mod that needs it: {} ask for {}.",
                    askers.join(", "),
                    describe_ranges(&ranges)
                )
            },
        },
    }
}

/// Another release of the same mod, made for this Minecraft.
fn solve_wrong_minecraft(
    facts: &Facts<'_>,
    catalogue: &dyn Catalogue,
    entry: &mod_compat::ModCompatEntry,
) -> FixStep {
    let Some(origin) = facts.origins.get(&entry.file_name) else {
        return FixStep::Unfixable {
            file_name: entry.file_name.clone(),
            reason: "It was not fetched by the launcher, so it does not know where to look for a release made for this Minecraft.".to_string(),
        };
    };

    let candidates = catalogue.versions_of(&origin.project_id, facts.mc_version, facts.loader);
    // Anything the catalogue lists for this version and loader is, by the
    // catalogue's own account, made for it. The newest is the usual answer;
    // the report will say so if it is somehow not.
    match candidates.first() {
        Some(candidate) => FixStep::Replace {
            file_name: entry.file_name.clone(),
            mod_id: entry.mod_id.clone().unwrap_or_default(),
            project_id: origin.project_id.clone(),
            version_id: candidate.version_id.clone(),
            version: candidate.version_number.clone(),
            reason: format!(
                "Made for another Minecraft; this release is for {}.",
                facts.mc_version
            ),
        },
        None => FixStep::Unfixable {
            file_name: entry.file_name.clone(),
            reason: format!(
                "Its author has published no release for Minecraft {} on {}.",
                facts.mc_version, facts.loader
            ),
        },
    }
}

fn describe_ranges(ranges: &[&serde_json::Value]) -> String {
    let mut seen: Vec<String> = Vec::new();
    for range in ranges {
        let text = match range {
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        if !seen.contains(&text) {
            seen.push(text);
        }
    }
    seen.join(" and ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mod_compat::{CompatIssue, ModCompatEntry};

    /// A catalogue with exactly what a test says it has.
    struct Fake {
        projects: HashMap<&'static str, (&'static str, &'static str)>,
        versions: HashMap<&'static str, Vec<(&'static str, &'static str)>>,
    }

    impl Catalogue for Fake {
        fn versions_of(&self, project_id: &str, _mc: &str, _loader: &str) -> Vec<Candidate> {
            self.versions
                .get(project_id)
                .map(|list| {
                    list.iter()
                        .map(|(id, number)| Candidate {
                            version_id: id.to_string(),
                            version_number: number.to_string(),
                        })
                        .collect()
                })
                .unwrap_or_default()
        }

        fn project_for_mod_id(&self, mod_id: &str) -> Option<(String, String)> {
            self.projects
                .get(mod_id)
                .map(|(id, name)| (id.to_string(), name.to_string()))
        }
    }

    fn entry(file: &str, mod_id: &str, kind: IssueKind) -> ModCompatEntry {
        ModCompatEntry {
            file_name: file.to_string(),
            mod_id: Some(mod_id.to_string()),
            name: None,
            version: None,
            minecraft_ok: None,
            issues: vec![CompatIssue {
                severity: "error".to_string(),
                message: String::new(),
                kind,
                missing_dependency: None,
            }],
        }
    }

    fn report(mods: Vec<ModCompatEntry>) -> CompatReport {
        CompatReport {
            instance_id: "i".to_string(),
            mc_version: "1.21.1".to_string(),
            errors: mods.len(),
            warnings: 0,
            mods,
        }
    }

    fn require(file: &str, mod_id: &str, dep: &str, range: &str) -> ModRequirement {
        ModRequirement {
            file_name: file.to_string(),
            mod_id: mod_id.to_string(),
            dep_id: dep.to_string(),
            range: serde_json::Value::String(range.to_string()),
        }
    }

    fn origin(project: &str) -> ContentOrigin {
        ContentOrigin {
            provider: "modrinth".to_string(),
            project_id: project.to_string(),
            version_id: "old".to_string(),
            pinned: false,
        }
    }

    /// The case from the tester's screenshot, once the false alarms were
    /// gone and one real one remained: two add-ons wanting different ranges
    /// of the same library.
    ///
    /// The right release is the one both accept -- not the newest, which
    /// the second add-on refuses, and not the one that quiets only the mod
    /// that complained loudest.
    #[test]
    fn a_shared_dependency_is_moved_to_the_version_everyone_accepts() {
        let catalogue = Fake {
            projects: HashMap::new(),
            versions: HashMap::from([(
                "easy-npc",
                vec![
                    ("v8", "8.0.0"),
                    ("v7_11", "7.11.0"),
                    ("v7_2", "7.2.0"),
                    ("v6", "6.21.0"),
                ],
            )]),
        };
        let rep = report(vec![entry(
            "bundle.jar",
            "easy_npc_bundle",
            IssueKind::DependencyVersion {
                dep_id: "easy_npc".to_string(),
                range: serde_json::Value::String("[7.11.0,8.0.0)".to_string()),
                installed: "6.21.0".to_string(),
            },
        )]);
        let provided = vec![ProvidedMod {
            file_name: "easy_npc-6.21.0.jar".to_string(),
            id: "easy_npc".to_string(),
            version: "6.21.0".to_string(),
        }];
        let required = vec![
            require(
                "bundle.jar",
                "easy_npc_bundle",
                "easy_npc",
                "[7.11.0,8.0.0)",
            ),
            // A second add-on narrows it: it will not take 8.
            require("ui.jar", "easy_npc_config_ui", "easy_npc", "[7.0.0,7.12.0)"),
        ];
        let origins = BTreeMap::from([("easy_npc-6.21.0.jar".to_string(), origin("easy-npc"))]);

        let facts = Facts {
            report: &rep,
            provided: &provided,
            required: &required,
            origins: &origins,
            mc_version: "1.21.1",
            loader: "neoforge",
        };
        let plan = plan(&facts, &catalogue);

        assert_eq!(plan.steps.len(), 1);
        match &plan.steps[0] {
            FixStep::Replace {
                file_name,
                version,
                version_id,
                ..
            } => {
                assert_eq!(file_name, "easy_npc-6.21.0.jar");
                // 8.0.0 is newest and the first add-on would take it; the
                // second would not. 7.11.0 is the one both accept.
                assert_eq!(version, "7.11.0");
                assert_eq!(version_id, "v7_11");
            }
            other => panic!("expected a replacement, got {other:?}"),
        }
        assert!(plan.has_work());
    }

    #[test]
    fn a_missing_dependency_is_installed_from_the_catalogue() {
        let catalogue = Fake {
            projects: HashMap::from([("fabric-api", ("P1", "Fabric API"))]),
            versions: HashMap::from([("P1", vec![("va", "0.100.0"), ("vb", "0.99.0")])]),
        };
        let rep = report(vec![entry(
            "sodium.jar",
            "sodium",
            IssueKind::MissingDependency {
                dep_id: "fabric-api".to_string(),
                range: serde_json::Value::String(">=0.99".to_string()),
            },
        )]);
        let required = vec![require("sodium.jar", "sodium", "fabric-api", ">=0.99")];
        let facts = Facts {
            report: &rep,
            provided: &[],
            required: &required,
            origins: &BTreeMap::new(),
            mc_version: "1.21.1",
            loader: "fabric",
        };
        let plan = plan(&facts, &catalogue);
        assert_eq!(
            plan.steps,
            vec![FixStep::Install {
                dep_id: "fabric-api".to_string(),
                project_id: "P1".to_string(),
                name: "Fabric API".to_string(),
                version_id: "va".to_string(),
                version: "0.100.0".to_string(),
            }]
        );
    }

    /// Four mods complaining about one library is one problem, not four.
    #[test]
    fn one_dependency_is_solved_once_however_many_mods_complain() {
        let catalogue = Fake {
            projects: HashMap::new(),
            versions: HashMap::from([("lib", vec![("v2", "2.0.0")])]),
        };
        let complaint = || IssueKind::DependencyVersion {
            dep_id: "lib".to_string(),
            range: serde_json::Value::String("[2.0.0,)".to_string()),
            installed: "1.0.0".to_string(),
        };
        let rep = report(vec![
            entry("a.jar", "a", complaint()),
            entry("b.jar", "b", complaint()),
            entry("c.jar", "c", complaint()),
        ]);
        let provided = vec![ProvidedMod {
            file_name: "lib-1.jar".to_string(),
            id: "lib".to_string(),
            version: "1.0.0".to_string(),
        }];
        let required = vec![
            require("a.jar", "a", "lib", "[2.0.0,)"),
            require("b.jar", "b", "lib", "[2.0.0,)"),
            require("c.jar", "c", "lib", "[2.0.0,)"),
        ];
        let origins = BTreeMap::from([("lib-1.jar".to_string(), origin("lib"))]);
        let facts = Facts {
            report: &rep,
            provided: &provided,
            required: &required,
            origins: &origins,
            mc_version: "1.21.1",
            loader: "fabric",
        };
        assert_eq!(plan(&facts, &catalogue).steps.len(), 1);
    }

    /// What the plan refuses, and says why.
    #[test]
    fn it_says_what_it_cannot_do_rather_than_guessing() {
        let catalogue = Fake {
            projects: HashMap::new(),
            versions: HashMap::from([("lib", vec![("v3", "3.0.0")])]),
        };

        // Installed by hand: no origin, so nothing to replace it with.
        let rep = report(vec![entry(
            "a.jar",
            "a",
            IssueKind::DependencyVersion {
                dep_id: "lib".to_string(),
                range: serde_json::Value::String("[2.0.0,3.0.0)".to_string()),
                installed: "1.0.0".to_string(),
            },
        )]);
        let provided = vec![ProvidedMod {
            file_name: "lib-1.jar".to_string(),
            id: "lib".to_string(),
            version: "1.0.0".to_string(),
        }];
        let required = vec![require("a.jar", "a", "lib", "[2.0.0,3.0.0)")];
        let facts = Facts {
            report: &rep,
            provided: &provided,
            required: &required,
            origins: &BTreeMap::new(),
            mc_version: "1.21.1",
            loader: "fabric",
        };
        let by_hand = plan(&facts, &catalogue);
        assert!(
            matches!(&by_hand.steps[0], FixStep::Unfixable { reason, .. } if reason.contains("did not fetch"))
        );
        assert!(!by_hand.has_work());

        // Known origin, but no release satisfies the range: said, not forced.
        let origins = BTreeMap::from([("lib-1.jar".to_string(), origin("lib"))]);
        let facts = Facts {
            origins: &origins,
            ..facts
        };
        let nothing_fits = plan(&facts, &catalogue);
        assert!(
            matches!(&nothing_fits.steps[0], FixStep::Unfixable { reason, .. } if reason.contains("satisfies every mod"))
        );

        // A conflict is never fixed: one of the two has to go, and which is
        // not the launcher's decision.
        let rep = report(vec![entry(
            "a.jar",
            "a",
            IssueKind::Conflict {
                with_id: "b".to_string(),
                installed: "1.0".to_string(),
            },
        )]);
        let facts = Facts {
            report: &rep,
            ..facts
        };
        let conflict = plan(&facts, &catalogue);
        assert!(
            matches!(&conflict.steps[0], FixStep::Unfixable { reason, .. } if reason.contains("your call"))
        );
    }

    #[test]
    fn a_mod_for_another_minecraft_is_moved_to_a_release_for_this_one() {
        let catalogue = Fake {
            projects: HashMap::new(),
            versions: HashMap::from([("iris", vec![("new", "1.8.12+1.21.1")])]),
        };
        let rep = report(vec![entry(
            "iris-1.20.jar",
            "iris",
            IssueKind::WrongMinecraft {
                range: serde_json::Value::String("[1.20,1.21)".to_string()),
            },
        )]);
        let origins = BTreeMap::from([("iris-1.20.jar".to_string(), origin("iris"))]);
        let facts = Facts {
            report: &rep,
            provided: &[],
            required: &[],
            origins: &origins,
            mc_version: "1.21.1",
            loader: "fabric",
        };
        match &plan(&facts, &catalogue).steps[0] {
            FixStep::Replace { version_id, .. } => assert_eq!(version_id, "new"),
            other => panic!("{other:?}"),
        }
    }
}
