//! Whether a mod's Minecraft requirement covers the engine's version.
//!
//! Two grammars reach here: Fabric and Quilt's npm-like comparators
//! (`>=1.21 <1.22`, `1.21.x`, `~1.21`, a list of alternatives) and Forge and
//! NeoForge's Maven ranges (`[1.20.1,1.21)`, `[1.21,)`). Anything else -- a
//! placeholder such as `${minecraft_version}`, a snapshot name -- is
//! `Unknown`, never a guess.

use serde::Serialize;
use std::cmp::Ordering;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VersionMatch {
    /// The requirement includes the engine's version.
    Matches,
    /// The requirement excludes it: the mod was made for another Minecraft.
    Differs,
    /// No requirement, or one this module cannot read.
    Unknown,
}

/// A Fabric or Quilt requirement: any of `alternatives` may hold, and each
/// is a space-separated list of comparators that must all hold.
pub fn fabric_matches(alternatives: &[String], version: &str) -> VersionMatch {
    let Some(target) = Version::parse(version) else {
        return VersionMatch::Unknown;
    };
    if alternatives.is_empty() {
        return VersionMatch::Unknown;
    }
    let mut readable = false;
    for alternative in alternatives {
        match comparators_hold(alternative, &target) {
            Some(true) => return VersionMatch::Matches,
            Some(false) => readable = true,
            None => {}
        }
    }
    if readable {
        VersionMatch::Differs
    } else {
        VersionMatch::Unknown
    }
}

fn comparators_hold(text: &str, target: &Version) -> Option<bool> {
    let mut all = true;
    let mut any = false;
    for word in text.split_whitespace() {
        any = true;
        all &= comparator_holds(word, target)?;
    }
    any.then_some(all)
}

fn comparator_holds(word: &str, target: &Version) -> Option<bool> {
    if word == "*" {
        return Some(true);
    }
    let (operator, rest) = split_operator(word);
    // `1.21.x`: the wildcard segment and everything after it match anything.
    if let Some(prefix) = wildcard_prefix(rest) {
        let prefix = Version::parse(&prefix)?;
        let starts = target.starts_with(&prefix);
        return match operator {
            "" | "=" => Some(starts),
            _ => None,
        };
    }
    let bound = Version::parse(rest)?;
    let order = target.cmp(&bound);
    Some(match operator {
        "" | "=" => order == Ordering::Equal,
        ">=" => order != Ordering::Less,
        ">" => order == Ordering::Greater,
        "<=" => order != Ordering::Greater,
        "<" => order == Ordering::Less,
        // ~1.21.1: at least that, same minor. ~1.21: same minor.
        "~" => order != Ordering::Less && target.starts_with(&bound.truncated(2)),
        // ^1.21: at least that, same major.
        "^" => order != Ordering::Less && target.starts_with(&bound.truncated(1)),
        _ => return None,
    })
}

fn split_operator(word: &str) -> (&str, &str) {
    for operator in [">=", "<=", ">", "<", "=", "~", "^"] {
        if let Some(rest) = word.strip_prefix(operator) {
            return (operator, rest);
        }
    }
    ("", word)
}

fn wildcard_prefix(text: &str) -> Option<String> {
    let segments: Vec<&str> = text.split('.').collect();
    let wild = segments
        .iter()
        .position(|s| matches!(*s, "x" | "X" | "*"))?;
    (wild > 0).then(|| segments[..wild].join("."))
}

/// A Forge or NeoForge Maven range: one or more `[a,b)`-style intervals,
/// or a bare version, which Forge treats as "this one".
pub fn maven_matches(range: &str, version: &str) -> VersionMatch {
    let Some(target) = Version::parse(version) else {
        return VersionMatch::Unknown;
    };
    let range = range.trim();
    if range.is_empty() || range.contains("${") {
        return VersionMatch::Unknown;
    }
    if !range.starts_with(['[', '(']) {
        return match Version::parse(range) {
            Some(exact) if exact == target => VersionMatch::Matches,
            Some(_) => VersionMatch::Differs,
            None => VersionMatch::Unknown,
        };
    }
    let mut rest = range;
    let mut readable = false;
    while let Some(start) = rest.find(['[', '(']) {
        let Some(end) = rest[start..].find([']', ')']).map(|e| start + e) else {
            break;
        };
        let interval = &rest[start..=end];
        rest = &rest[end + 1..];
        match interval_holds(interval, &target) {
            Some(true) => return VersionMatch::Matches,
            Some(false) => readable = true,
            None => return VersionMatch::Unknown,
        }
    }
    if readable {
        VersionMatch::Differs
    } else {
        VersionMatch::Unknown
    }
}

fn interval_holds(interval: &str, target: &Version) -> Option<bool> {
    let lower_inclusive = interval.starts_with('[');
    let upper_inclusive = interval.ends_with(']');
    let inner = &interval[1..interval.len() - 1];
    let (low, high) = match inner.split_once(',') {
        Some(pair) => pair,
        // `[1.21]`: exactly that version.
        None => (inner, inner),
    };
    let low = low.trim();
    let high = high.trim();
    if !low.is_empty() {
        let bound = Version::parse(low)?;
        match target.cmp(&bound) {
            Ordering::Less => return Some(false),
            Ordering::Equal if !lower_inclusive => return Some(false),
            _ => {}
        }
    }
    if !high.is_empty() {
        let bound = Version::parse(high)?;
        match target.cmp(&bound) {
            Ordering::Greater => return Some(false),
            Ordering::Equal if !upper_inclusive => return Some(false),
            _ => {}
        }
    }
    Some(true)
}

/// A release version: dotted numbers, with an optional `-pre1`-style
/// suffix that sorts before the release it precedes.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Version {
    parts: Vec<u64>,
    pre: Option<String>,
}

impl Version {
    fn parse(text: &str) -> Option<Self> {
        let text = text.trim().trim_start_matches('v');
        let (numbers, pre) = match text.split_once(['-', '+']) {
            Some((numbers, suffix)) => (numbers, Some(suffix.to_string())),
            None => (text, None),
        };
        if numbers.is_empty() {
            return None;
        }
        let parts = numbers
            .split('.')
            .map(|part| part.parse::<u64>().ok())
            .collect::<Option<Vec<_>>>()?;
        Some(Self { parts, pre })
    }

    fn part(&self, index: usize) -> u64 {
        self.parts.get(index).copied().unwrap_or(0)
    }

    fn truncated(&self, len: usize) -> Self {
        Self {
            parts: self.parts.iter().copied().take(len).collect(),
            pre: None,
        }
    }

    fn starts_with(&self, prefix: &Self) -> bool {
        (0..prefix.parts.len()).all(|i| self.part(i) == prefix.part(i))
    }
}

impl Ord for Version {
    fn cmp(&self, other: &Self) -> Ordering {
        let len = self.parts.len().max(other.parts.len());
        for i in 0..len {
            match self.part(i).cmp(&other.part(i)) {
                Ordering::Equal => {}
                order => return order,
            }
        }
        match (&self.pre, &other.pre) {
            (None, None) => Ordering::Equal,
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (Some(a), Some(b)) => a.cmp(b),
        }
    }
}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fabric(alternatives: &[&str], version: &str) -> VersionMatch {
        let list: Vec<String> = alternatives.iter().map(|s| s.to_string()).collect();
        fabric_matches(&list, version)
    }

    #[test]
    fn fabric_comparators() {
        assert_eq!(fabric(&[">=1.21 <1.22"], "1.21.4"), VersionMatch::Matches);
        assert_eq!(fabric(&[">=1.21 <1.22"], "26.3"), VersionMatch::Differs);
        assert_eq!(fabric(&["1.21.x"], "1.21.11"), VersionMatch::Matches);
        assert_eq!(fabric(&["1.21.x"], "1.20.1"), VersionMatch::Differs);
        assert_eq!(fabric(&["~1.21"], "1.21.5"), VersionMatch::Matches);
        assert_eq!(fabric(&["~1.21.2"], "1.21.1"), VersionMatch::Differs);
        assert_eq!(fabric(&["*"], "26.3"), VersionMatch::Matches);
        assert_eq!(fabric(&["1.20.1", "26.3"], "26.3"), VersionMatch::Matches);
        assert_eq!(fabric(&[">=26.3-alpha.1"], "26.3"), VersionMatch::Matches);
    }

    #[test]
    fn unreadable_requirements_are_unknown() {
        assert_eq!(fabric(&[], "26.3"), VersionMatch::Unknown);
        assert_eq!(fabric(&["${minecraft}"], "26.3"), VersionMatch::Unknown);
        assert_eq!(maven_matches("${mc_range}", "26.3"), VersionMatch::Unknown);
        assert_eq!(maven_matches("", "26.3"), VersionMatch::Unknown);
    }

    #[test]
    fn maven_ranges() {
        assert_eq!(
            maven_matches("[1.21.1,1.22)", "1.21.1"),
            VersionMatch::Matches
        );
        assert_eq!(
            maven_matches("[1.21.1,1.22)", "1.22"),
            VersionMatch::Differs
        );
        assert_eq!(
            maven_matches("(1.21.1,1.22]", "1.21.1"),
            VersionMatch::Differs
        );
        assert_eq!(maven_matches("[1.20,)", "26.3"), VersionMatch::Matches);
        assert_eq!(maven_matches("[1.20.1]", "1.20.1"), VersionMatch::Matches);
        assert_eq!(
            maven_matches("[1.0,1.1),[26.3,)", "26.3"),
            VersionMatch::Matches
        );
        assert_eq!(maven_matches("1.20.1", "26.3"), VersionMatch::Differs);
    }
}
