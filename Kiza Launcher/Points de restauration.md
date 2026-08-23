# Points de restauration

Capture une instance avant une modification risquée, pour pouvoir revenir en arrière.

## Où

- Module : `src-tauri/src/restore_points.rs`
- Index : `<app_data>/restore-points/<instance_id>/index.json`
- Objets : `<app_data>/restore-points/objects/<2 premiers caractères>/<sha256>`
- Commandes : `restore_points_list`, `restore_point_create`, `restore_point_apply`, `restore_points_prune`, `restore_points_stored_bytes`

## Ce qui est capturé

Par **liste blanche** — `CAPTURED_DIRS` et `CAPTURED_FILES` :

- `mods/`, `resourcepacks/`, `shaderpacks/`, `config/`
- `options.txt`, `servers.dat`

Tout le reste est exclu par omission : `saves/`, `logs/`, `crash-reports/`, `screenshots/`.

## Les mondes sont dehors, exprès

Un snapshot doit rester assez léger pour être pris à **chaque** changement de mod. Un seul monde peut peser plus lourd que tout le reste de l'instance.

Les mondes appartiendront au World Vault ([[Feuille de route 0.0.300]]). Le lien entre les deux est un simple `world_checkpoint_id` optionnel dans le snapshot — aucune duplication.

À la restauration, l'utilisateur choisira « Instance uniquement » ou « Instance + mondes associés ».

## Déduplication par contenu

Chaque fichier est stocké une fois, sous son SHA-256. Deux snapshots successifs où seul `options.txt` change ne coûtent que la différence.

Mesuré par le test `an_unchanged_file_is_stored_once_across_snapshots` — il compare `stored_bytes()` avant et après.

Vingt snapshots d'un modpack de 300 Mo coûtent 300 Mo plus ce qui a réellement changé.

Le nom de dossier est fragmenté sur les 2 premiers caractères du hash : Windows supporte mal un dossier contenant des dizaines de milliers de fichiers.

## Restaurer, c'est aussi enlever

`restore()` ne se contente pas de recopier : il **supprime** les fichiers ajoutés depuis le snapshot, dans les zones capturées uniquement. Sinon un mod ajouté après coup survivrait à la restauration.

## Nettoyage

`prune(keep)` garde les N plus récents, puis `collect_garbage()` supprime les objets que plus aucun point ne référence — toutes instances confondues.

`stored_bytes()` donne la taille réelle après déduplication, pour un quota disque.

Le nettoyage des snapshots et celui du World Vault resteront **indépendants**.

## Pas de compression

Décision assumée : les jars de mods sont déjà des ZIP, les recompresser coûte du CPU pour un gain proche de zéro. Seules les configurations compresseraient bien, et elles sont marginales face aux mods. À reconsidérer si une mesure le justifie, pas par principe.

## Cohérence

Assurée par le [[Verrou d'instance]], pas par une surveillance des écritures du jeu. Capturer pendant qu'une installation écrit produirait un snapshot à moitié fait — et le restaurerait fidèlement plus tard.
