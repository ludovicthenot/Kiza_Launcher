//! Flux Core: the engine Kizaflux runs, as Kiza Launcher sees it.
//!
//! Kizaflux does not write a Minecraft engine. It runs Horizon
//! (github.com/horizon-rust/horizon, MIT), a Rust rewrite of Minecraft: Java
//! Edition 26.3, as a separate program, the way the launcher runs Java: Kiza
//! installs a signed release, has it prepare its resources from the player's
//! own Minecraft files, and starts it in an instance's folder with the
//! signed-in account. docs/architecture.md explains why a process and not a
//! library.
//!
//! What lives here:
//!
//! - [`horizon::release`]: which release to install, from GitHub's list;
//! - [`horizon::signature`]: that its checksums are signed by Horizon's key;
//! - [`horizon::install`]: unpacking it, checked, into Kiza's folder;
//! - [`horizon::layout`]: what an installed release holds and plays;
//! - [`horizon::launch`]: the commands that prepare and play it.

pub mod horizon;
