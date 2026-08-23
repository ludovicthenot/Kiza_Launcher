# Verrou d'instance

Une seule opération du launcher à la fois par instance.

## Où

`src-tauri/src/instance_lock.rs`

```rust
let _guard = instance_lock::acquire(&instance_id, "taking a restore point")?;
```

## Portée

Il couvre les **opérations du launcher**, pas le jeu. Il ne dit rien sur Minecraft en train d'écrire dans un monde — c'est une contrainte du World Vault, et les deux systèmes restent séparés.

Posé aujourd'hui sur :

- `restore_point_create`
- `restore_point_apply`
- `apply_instance_updates` (toute la durée du lot)

## Trois propriétés testées

**Le refus nomme le tenant.** « Another operation is already running on this instance: installing mods ». Un refus anonyme laisse l'utilisateur sans recours.

**Libération par `Drop`**, donc y compris sur erreur ou panique. Sans ça, une installation qui échoue bloquerait l'instance jusqu'au redémarrage du launcher — le défaut classique de ce genre de mécanisme.

**Par instance, pas global.** Deux instances différentes ne se bloquent pas.

## Implémentation

Registre statique `OnceLock<Mutex<HashMap<String, &'static str>>>`. Le processus est unique (plugin single-instance), donc un verrou en mémoire suffit — pas besoin de fichier de verrou.

Lié : [[Points de restauration]], [[Update Center]].
