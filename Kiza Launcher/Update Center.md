# Update Center

Détecte, compare et applique les mises à jour de contenu Modrinth / CurseForge.

## Où

- Décision (pure, sans réseau) : `src-tauri/src/update_center.rs`
- Commandes : `check_instance_updates`, `apply_instance_updates` dans `lib.rs`
- Application unitaire : `apply_one_update()` dans `lib.rs`
- Hooks : `useInstanceUpdates`, `useApplyInstanceUpdates`, `useSetContentPinned`
- Panneau : `src/components/instance/UpdateCenterPanel.tsx`
- Monté dans : `src/components/instance/mods/ModsTab.tsx`, en haut

## Dépend de

- [[Provenance du contenu]] — sans identifiant de projet, rien n'est suivi
- [[Points de restauration]] — un snapshot est pris avant la première écriture
- [[Verrou d'instance]] — tenu pendant toute l'application
- [[Téléchargements reprenables]] — les téléchargements ne repartent plus de zéro

## Les quatre statuts

`UpdateStatus` :

- `Available` — version plus récente **et** compatible
- `Pinned` — mise à jour existante mais fichier épinglé ; visible, jamais appliquée
- `UpToDate` — rien de plus récent
- `NoCompatibleRelease` — du plus récent existe, mais pour une autre version de Minecraft ou un autre loader

Distinguer les deux derniers est essentiel : dire « à jour » alors qu'une version existe est un mensonge, dire « disponible » alors qu'elle ne marchera pas est un piège.

## Règles encodées dans `evaluate()`

**Jamais de retour en arrière.** La comparaison se fait sur `released_at` par rapport à la version installée, pas sur l'ordre de la liste — les plateformes ne trient pas pareil.

**Une version récente incompatible ne masque pas une version compatible plus ancienne.** Si v3 est pour 1.22 et v2 pour 1.21, c'est v2 qui est proposée.

**Si la version installée a disparu du catalogue**, rien n'est proposé : sans point de référence, « plus récent » n'a pas de sens.

**Le contenu sans loader** (packs de ressources, shaders) reste éligible — `supports()` accepte une liste de loaders vide.

## Le piège CurseForge

CurseForge met les loaders **dans le même tableau** que les versions de jeu : `["1.21", "Fabric"]`. Sans séparation, « Fabric » serait traité comme une version de Minecraft et ne correspondrait à rien.

`split_curseforge_game_versions()` les sépare. Noms reconnus : Forge, Fabric, Quilt, NeoForge, LiteLoader.

## Application

`apply_instance_updates(instance_id, paths)` :

1. relance la vérification (l'état a pu changer)
2. filtre par `applicable()` — un chemin épinglé passé en argument est **ignoré**, le filtre est côté backend
3. prend le [[Verrou d'instance]]
4. crée un [[Points de restauration|point de restauration]] et renvoie son id
5. applique chaque mise à jour ; un échec n'interrompt pas le lot

`apply_one_update()` télécharge **d'abord**, supprime l'ancien fichier **ensuite**. Une nouvelle version a presque toujours un nom de fichier différent — laisser l'ancien ferait charger deux versions du même mod, crash garanti.

## Rattraper le contenu non suivi

Bouton « Identifier le contenu » — voir [[Provenance du contenu#Rattrapage par empreinte — fait pour Modrinth]].

## Ce qui manque

- **Changelog** : les deux API l'exposent, mais dans un champ séparé demandant un appel par version. `AvailableVersion.changelog` existe et vaut `None`.
- **Dépendances modifiées** : pas encore affichées.
- **Rétrogradation volontaire** vers une version antérieure choisie.
