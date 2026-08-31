//! Which Kiza this binary is.
//!
//! One codebase, three products, decided when the binary is compiled. The
//! frontend has the same three names in `src/lib/edition.ts`, and a test in
//! this module reads both files so they cannot drift.
//!
//! The edition is not the update channel. The edition is what this binary is;
//! the channel is which stream of releases it follows. Keeping them apart is
//! what makes "a Stable user must never be handed a Maker build" enforceable:
//! the channel a build may ask for comes from its edition, not from a string in
//! a settings file that anyone can edit.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Edition {
    #[default]
    Stable,
    Maker,
    Experimental,
}

impl Edition {
    /// The name on the wire and in an R2 prefix.
    pub fn slug(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Maker => "maker",
            Self::Experimental => "experimental",
        }
    }

    /// The name a person reads.
    pub fn display_name(self) -> &'static str {
        match self {
            Self::Stable => "Kiza Launcher",
            Self::Maker => "Kiza Maker",
            Self::Experimental => "Kiza Experimental",
        }
    }

    /// The update channels this edition may follow, the default first.
    ///
    /// Stable has two because a beta of Stable is still Stable. Neither of the
    /// others has more than one: an Experimental build following `stable` would
    /// be told to downgrade, and a Maker build following anything but `maker`
    /// would lose the tools it exists for.
    pub fn channels(self) -> &'static [&'static str] {
        match self {
            Self::Stable => &["stable", "beta"],
            Self::Maker => &["maker"],
            Self::Experimental => &["experimental"],
        }
    }

    /// Whether this edition may follow that channel.
    pub fn allows(self, channel: &str) -> bool {
        let asked = channel.trim().to_ascii_lowercase();
        self.channels().contains(&asked.as_str())
    }

    /// The channel to use when a stored one is not allowed here.
    ///
    /// A settings file copied from a Stable install into a Maker one carries
    /// `stable`, which the Maker build must not follow. It falls back rather
    /// than refusing to check for updates.
    pub fn default_channel(self) -> &'static str {
        self.channels()[0]
    }
}

/// This binary's edition.
///
/// `option_env!` reads the variable at compile time, so a build with nothing
/// set is Stable — the safe answer, since Stable is the edition with no extra
/// powers.
pub fn current() -> Edition {
    match option_env!("KIZA_EDITION") {
        Some("maker") => Edition::Maker,
        Some("experimental") => Edition::Experimental,
        _ => Edition::Stable,
    }
}

#[cfg(test)]
mod tests {
    use super::{current, Edition};

    #[test]
    fn an_edition_only_follows_its_own_releases() {
        assert!(Edition::Stable.allows("stable"));
        assert!(Edition::Stable.allows("beta"));
        // The whole point: no path from a Stable install to a Maker build.
        assert!(!Edition::Stable.allows("maker"));
        assert!(!Edition::Stable.allows("experimental"));

        assert!(Edition::Maker.allows("maker"));
        assert!(!Edition::Maker.allows("stable"));
        assert!(Edition::Experimental.allows("experimental"));
        assert!(!Edition::Experimental.allows("stable"));

        // A settings file carried over from another edition falls back rather
        // than leaving the launcher unable to update at all.
        assert_eq!(Edition::Maker.default_channel(), "maker");
        assert_eq!(Edition::Stable.default_channel(), "stable");
    }

    /// Nothing set is Stable, because Stable is the edition with no extra
    /// powers: a build that forgot to declare itself must not be the one that
    /// ships the Maker tools.
    #[test]
    fn a_build_that_says_nothing_is_the_plain_one() {
        if option_env!("KIZA_EDITION").is_none() {
            assert_eq!(current(), Edition::Stable);
        }
    }

    /// The frontend decides what to draw from its own copy of these names, and
    /// the backend decides what to serve from this one. Two hand-written lists
    /// that nothing compares is how `ModInfo.files` reached the interface as
    /// `undefined`.
    #[test]
    fn the_frontend_knows_the_same_three_editions() {
        const FRONTEND: &str = include_str!("../../src/lib/edition.ts");

        for edition in [Edition::Stable, Edition::Maker, Edition::Experimental] {
            let quoted = format!("\"{}\"", edition.slug());
            assert!(
                FRONTEND.contains(&quoted),
                "the interface does not know the {} edition",
                edition.slug()
            );
            assert!(
                FRONTEND.contains(edition.display_name()),
                "the interface does not name {}",
                edition.display_name()
            );
        }

        // And the channel lists have to agree, or a build would ask for a
        // channel its own backend refuses.
        for (edition, line) in [
            (Edition::Stable, "stable: [\"stable\", \"beta\"]"),
            (Edition::Maker, "maker: [\"maker\"]"),
            (Edition::Experimental, "experimental: [\"experimental\"]"),
        ] {
            assert!(
                FRONTEND.contains(line),
                "the interface disagrees about which channels {} may follow",
                edition.slug()
            );
        }
    }
}
