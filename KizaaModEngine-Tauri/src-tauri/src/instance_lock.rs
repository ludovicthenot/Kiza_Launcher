//! One launcher operation at a time per instance.
//!
//! A snapshot taken while mods are being installed would capture a half-written
//! instance and restore it faithfully — which is worse than not snapshotting at
//! all. The lock covers *launcher* operations only. It says nothing about the
//! game writing to a world; that is the World Vault's problem, and the two
//! systems stay separate.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

fn held() -> &'static Mutex<HashMap<String, &'static str>> {
    static HELD: OnceLock<Mutex<HashMap<String, &'static str>>> = OnceLock::new();
    HELD.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Releases the instance when it goes out of scope, including on an early
/// return or a panic, so a failed operation cannot wedge the instance.
#[derive(Debug)]
pub struct InstanceGuard {
    instance_id: String,
}

impl Drop for InstanceGuard {
    fn drop(&mut self) {
        if let Ok(mut guard) = held().lock() {
            guard.remove(&self.instance_id);
        }
    }
}

/// Takes the instance for `operation`, or explains who already has it.
pub fn acquire(instance_id: &str, operation: &'static str) -> Result<InstanceGuard, String> {
    let mut guard = held()
        .lock()
        .map_err(|_| "The instance lock is poisoned; restart Kiza Launcher.".to_string())?;

    if let Some(current) = guard.get(instance_id) {
        return Err(format!(
            "Another operation is already running on this instance: {current}. Wait for it to finish."
        ));
    }
    guard.insert(instance_id.to_string(), operation);
    Ok(InstanceGuard {
        instance_id: instance_id.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_operation_is_refused_and_told_what_is_running() {
        let _guard = acquire("instance-a", "installing mods").unwrap();

        let error = acquire("instance-a", "taking a restore point").unwrap_err();
        // The message has to name the holder, or the user cannot act on it.
        assert!(error.contains("installing mods"), "got {error}");
    }

    #[test]
    fn the_instance_is_free_again_once_the_guard_is_dropped() {
        {
            let _guard = acquire("instance-b", "restoring").unwrap();
        }
        // A failed operation must not wedge the instance forever.
        assert!(acquire("instance-b", "installing mods").is_ok());
    }

    #[test]
    fn instances_do_not_block_each_other() {
        let _first = acquire("instance-c", "installing mods").unwrap();
        assert!(acquire("instance-d", "installing mods").is_ok());
    }
}
