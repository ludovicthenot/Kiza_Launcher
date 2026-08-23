# Architecture

[[Kiza Launcher]] est fait de trois morceaux qui ne partagent aucun code.

## 1. Backend Rust (Tauri 2)

`src-tauri/src/` — toute la logique métier. Les modules communiquent avec l'interface par des commandes Tauri.

Modules principaux :

| Module | Rôle |
|---|---|
| `minecraft_manager.rs` | téléchargement du jeu, Java, classpath, lancement |
| `forge.rs` | installation Forge, résolution des builds |
| `content_manager.rs` | installation de mods, packs, shaders, mondes |
| `mod_manager.rs` | catalogue des mods, déploiement, profils |
| `dependency_resolver.rs` | dépendances entre mods, avec rollback |
| `download_manager.rs` | file de téléchargement — voir [[Téléchargements reprenables]] |
| `crash_doctor.rs` | voir [[Crash Doctor]] |
| `restore_points.rs` | voir [[Points de restauration]] |
| `update_center.rs` | voir [[Update Center]] |
| `content_provenance.rs` | voir [[Provenance du contenu]] |
| `instance_lock.rs` | voir [[Verrou d'instance]] |
| `offline_accounts.rs` | voir [[Profils hors ligne]] |
| `safe_mode.rs` | voir [[Mode sans echec]] |
| `server_hub.rs` | voir [[Server Hub]] |
| `world_vault.rs` | voir [[World Vault]] |
| `nbt.rs` | voir [[Lecteur NBT]] |
| `lockfile.rs` | voir [[Kiza Lockfile]] |
| `performance_advisor.rs` | voir [[Performance Advisor]] |
| `minecraft_auth.rs` | connexion Microsoft |

## 2. Frontend React + TypeScript

`src/` — React 18, TanStack Query, Zustand, Tailwind, sonner, GSAP.

Les appels backend passent tous par `src/lib/queries.ts`, qui expose un hook par commande. C'est le seul fichier qui appelle `invoke`.

L'interface est en anglais dans le code ; `src/lib/i18n.tsx` traduit vers le français. **Les chaînes anglaises sont les clés** — une clé en double casse la compilation (TS1117), ce qui est arrivé plusieurs fois.

## 3. Kiza Base Mod (Java)

`kiza-base-mod/` — le mod injecté dans l'instance, qui dessine le menu Kiza. Voir [[Moteur de rendu in-game]] et [[Compatibilité des versions]].

Quatre jars sont produits par `build.mjs` :

- `kiza-base-mod-fabric.jar` — Java 16, mixins
- `kiza-base-mod-forge.jar` — Java 16, `mods.toml`
- `kiza-base-mod-forge-mid.jar` — Java 8, `mods.toml` `[1.13,1.17)`
- `kiza-base-mod-forge-legacy.jar` — Java 8, `mcmod.info`

Ils sont embarqués dans le binaire Rust par `include_bytes!` et déposés dans `mods/` au lancement.

## Ce qui relie les trois

Le launcher passe des propriétés système au jeu (`-Dkiza.*`) : version du client, version de Minecraft, loader, pseudo. Le mod les lit pour afficher le bon titre de fenêtre et la bonne ligne F3.

Un pont de fichier (`runtime/player-state.json`) permet au mod de dire au launcher si le joueur est en menu, en solo ou en multi — c'est ce qui alimente Discord Rich Presence.

Le **premier** battement de cœur de ce pont sert aussi de chronomètre : c'est le moment où le jeu a atteint le menu, la seule mesure de démarrage que le [[Performance Advisor]] peut prendre depuis l'extérieur du jeu.
