# World Vault

Sauvegardes des mondes d'une instance. `src-tauri/src/world_vault.rs`, 10 tests.

## Pourquoi un magasin séparé

Un monde est **la seule chose d'une instance qui ne se retéléchargera jamais**. Les mods, packs et configs se reprennent depuis Modrinth ou CurseForge ; un monde perdu est perdu.

C'est aussi la raison pour laquelle les mondes sont **délibérément exclus** des [[Points de restauration]] : un instantané doit rester assez léger pour être pris avant chaque modification de mods, et un seul monde peut peser plus que tout le reste de l'instance réunie. Un point de restauration se souvient seulement de **quel checkpoint de monde** l'accompagnait, via `world_checkpoint_id`.

## Différentiel par contenu

Même schéma que les points de restauration : magasin adressé par contenu, `world-vault/objects/<sha[..2]>/<sha256>`. Un fichier de région inchangé entre deux checkpoints est stocké **une fois**.

Concrètement : jouer dans un coin de la carte coûte, par sauvegarde, à peu près les chunks touchés.

> Test : `an_untouched_region_file_is_stored_once_across_backups` — les chunks du spawn ne sont pas restockés.

Les deux magasins (points de restauration et World Vault) sont **indépendants** : chacun a son propre ramasse-miettes, aucun ne peut supprimer les objets de l'autre.

## Jamais pendant que le jeu écrit

Un monde copié en pleine sauvegarde donne des fichiers de région à moitié écrits, et il se restaure exactement aussi mal qu'il a été capturé. Donc : **checkpoint refusé si l'instance tourne**.

Le signal est le registre `running_games` du launcher, **pas** la présence de `session.lock`. Minecraft laisse ce fichier derrière lui après chaque session : sa présence ne dit rien, et s'en servir refuserait la sauvegarde de tout monde ayant déjà été ouvert une fois.

`session.lock` est aussi exclu du contenu sauvegardé, et supprimé après une restauration : il appartient à une session terminée.

> Tests : `a_backup_is_refused_while_the_game_is_running`, `the_session_lock_is_never_part_of_a_backup`

## Le vrai nom du monde

Le dossier sous `saves/` porte le nom qu'avait le monde **le jour de sa création** — Minecraft ne renomme jamais le dossier. Afficher le dossier, c'est afficher le mauvais nom.

Le vrai nom est dans `level.dat`, qui est du NBT gzippé. D'où [[Lecteur NBT]] : un lecteur minimal qui en tire `LevelName`, `LastPlayed`, `Version.Name`, `hardcore` et `GameType`, et saute tout le reste.

Un `level.dat` illisible **n'empêche pas** la sauvegarde : on retombe sur le nom du dossier.

L'aperçu utilise `icon.png`, la vignette que Minecraft écrit lui-même dans le dossier du monde — aucune génération d'image de notre côté.

## Rétention par monde

`prune(app_data_dir, instance_id, folder, keep)` garde les `keep` plus récentes **d'un monde**, pas de l'instance.

Garder « les dix plus récentes » toutes instances confondues supprimerait silencieusement l'unique sauvegarde d'un monde qu'on n'a pas touché depuis des mois — c'est-à-dire exactement celui dont la sauvegarde compte le plus.

> Test : `retention_is_per_world_not_per_instance`

## Restaurer

Restaurer remet les fichiers du checkpoint **et supprime ceux apparus depuis**. Sinon le monde serait un mélange de deux états de la même carte : anciens chunks restaurés, nouveaux chunks conservés.

L'interface le dit avant de le faire — voir `WorldVaultPanel.tsx` et sa `ConfirmActionDialog`.

## Interface

Onglet **Mondes et sauvegardes** de l'instance (`WorldsTab.tsx`), pas dans les réglages : enterrer les sauvegardes à côté d'un bouton de suppression n'est pas où quelqu'un irait les chercher.

## Liens

[[Points de restauration]] · [[Lecteur NBT]] · [[Kiza Lockfile]] · [[Architecture]] · [[Tests et qualité]]
