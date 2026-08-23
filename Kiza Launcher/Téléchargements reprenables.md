# Téléchargements reprenables

Reprise HTTP à l'octet près. Avant, une pause faisait tout recommencer.

## Où

`src-tauri/src/download_manager.rs` — helpers en haut du fichier, boucle de téléchargement dans la tâche.

## Le vrai défaut

Ce n'était pas l'absence d'en-tête `Range`. C'était `File::create(&temp_path)`, qui **tronque** le fichier à chaque appel. Le code contenait littéralement `// TODO: Save offset for resume`, et la pause sortait de la fonction sans conserver l'offset.

L'ouverture se fait maintenant en **ajout** quand on reprend, en troncature seulement quand on repart du début.

## Les trois helpers testables

```rust
plan_resume(status, requested_offset) -> ResumePlan
resolved_total_size(status, content_length, content_range) -> Option<u64>
retry_delay(attempt) -> Duration
```

Ils sont purs, donc testés sans réseau (`mod resume_tests`).

## `plan_resume` : ne pas faire confiance au serveur

Seul le **code de statut** décide :

| Statut | Plan | Pourquoi |
|---|---|---|
| 206 | `Append(offset)` | le serveur envoie bien la suite |
| 416 | `AlreadyComplete` | on a demandé au-delà de la fin, tout est là |
| 200 | `Restart` | **le serveur a ignoré `Range`** et renvoie tout |
| offset = 0 | `Restart` | rien à reprendre |

Le cas 200 est le piège : ajouter un fichier complet derrière un fichier partiel le corrompt **en silence**, sans erreur visible.

## `resolved_total_size` : le second piège

Sur un **206**, `Content-Length` ne contient que le **reste** à télécharger. L'utiliser comme total afficherait une taille fausse pour chaque fichier repris.

Le vrai total est en fin de `Content-Range` : `bytes 200-1023/1024`. Si le serveur écrit `/*`, on renvoie « inconnu » plutôt qu'un chiffre inventé.

## Réessais

4 tentatives, délai exponentiel plafonné à 16 s (`retry_delay`). Un hôte mort ne doit pas bloquer la file.

## Détail clippy qui valait le détour

Ma boucle testait `while !file_is_complete`, une condition qui ne change jamais à l'intérieur — clippy l'a signalé (`while_immutable_condition`). Le comportement était juste, l'intention illisible. Réécrit en `if` explicite.

Lié : [[Update Center]] en bénéficie directement.
