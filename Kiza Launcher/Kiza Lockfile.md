# Kiza Lockfile

Un fichier qui décrit une instance sans en contenir un seul octet. `src-tauri/src/lockfile.rs`, 8 tests.

## La différence avec un export

[[Import et export d'instance]] produit un zip : il **copie** ce qui est installé, mais il est incapable de dire ce que c'est. Un lockfile fait l'inverse — aucun octet, seulement l'**identité** de chaque fichier : quel projet, quelle version publiée, quelle empreinte le résultat doit avoir.

C'est ce qui le rend partageable. Il est assez petit pour vivre dans un dépôt git à côté de la config d'un serveur, et la reconstruction télécharge **depuis les plateformes d'origine**, pas depuis celui qui a fait l'archive.

## Deux règles d'honnêteté

**Un fichier sans origine connue est quand même verrouillé, par empreinte — mais signalé comme tel.** Personne d'autre ne peut le reconstruire, et le dire vaut mieux que produire silencieusement une instance différente. L'interface affiche la liste avant l'export.

**La sortie est ordonnée.** Deux exports d'une instance inchangée donnent les mêmes octets. Un lockfile qui bougeait à chaque export serait inutilisable dans git.

> Tests : `exporting_the_same_instance_twice_gives_the_same_bytes`, `a_hand_added_file_is_locked_by_hash_but_named_as_unreproducible`

## Réutilisation des points de restauration

`restore_points::inspect(game_dir)` décrit l'instance **sans rien stocker** : mêmes fichiers capturés, mêmes empreintes, aucune copie. Prendre un vrai instantané juste pour lire sa liste écrirait des centaines de mégaoctets pour répondre à une question.

> Test : `inspecting_describes_the_instance_without_copying_it` — la description doit être identique à ce qu'un point de restauration capturerait, sinon un export décrirait une autre instance que celle qu'une restauration remettrait.

## Le champ `format`

Lu **en premier**, avant tout le reste. Un lockfile écrit par une version plus récente de Kiza est refusé avec cette raison précise, au lieu d'une plainte confuse sur un champ manquant.

Lire des champs inconnus comme s'ils étaient les anciens reconstruirait la mauvaise instance — pire que refuser.

## Le diff

Quatre verdicts, et `Different` est séparé de `Missing` exprès :

| Verdict | Sens |
|---|---|
| `Match` | installé, exactement les octets verrouillés |
| `Missing` | absent |
| `Different` | présent sous ce chemin, mais pas ces octets |
| `Extra` | installé, absent du lockfile |

Un mod présent à la mauvaise version est une dérive normale. Un mod absent peut vouloir dire que le lockfile décrit une instance que celle-ci n'est pas.

`fetchable` / `unfetchable` séparent ensuite ce qu'une reconstruction peut télécharger de ce qu'elle ne pourra jamais satisfaire — et nommer le second est le but : le résultat ne correspondra pas, et l'utilisateur sait quels fichiers en sont responsables.

## Reconstruire

`lockfile_apply` prend un [[Points de restauration|point de restauration]] avant la première écriture, donc l'opération s'annule d'un bloc.

**Les fichiers en trop sont laissés en place.** Supprimer tout ce que le lockfile ne mentionne pas effacerait un mod privé, une config personnelle ou un pack ajouté exprès. Une reconstruction n'est pas un formatage.

**Trois dossiers seulement sont accessibles en écriture** : `mods`, `resourcepacks`, `shaderpacks`. Un lockfile vient de quelqu'un d'autre et nomme des chemins ; plutôt que d'essayer d'assainir un chemin arbitraire, on n'accepte que ceux qui reçoivent réellement du contenu téléchargeable, et le nom de fichier passe le même contrôle que n'importe quel téléchargement ([[Provenance du contenu]] enregistre ensuite l'origine).

## Interface

Panneau dans **Gérer l'instance** (`LockfilePanel.tsx`) : vérifier ce qui serait exporté, exporter, comparer à un lockfile, reconstruire.

## Liens

[[Points de restauration]] · [[Provenance du contenu]] · [[Import et export d'instance]] · [[Update Center]] · [[World Vault]]
