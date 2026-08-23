# Provenance du contenu

Sait d'où vient chaque fichier installé. Sans ça, l'[[Update Center]] ne peut rien suivre.

## Où

- Module : `src-tauri/src/content_provenance.rs`
- Index : `<app_data>/minecraft/instances/<id>/content-provenance.json`
- Commandes : `content_origins`, `content_origin`, `content_set_pinned`, `content_forget_origin`

## Le problème qu'il résout

Avant, un mod installé depuis Modrinth n'enregistrait qu'une étiquette : `source: "modrinth"`. Jamais **quel** projet ni **quelle** version. Or un nom de fichier n'est pas une identité — deviner le projet par le nom finirait par remplacer le mauvais mod.

## Structure

```rust
ContentOrigin { provider, project_id, version_id, pinned }
```

Clé de l'index : le chemin **relatif au dossier de jeu**, en slashes — `mods/sodium.jar`.

## Deux routes d'installation, un seul index

C'est le piège de ce module. Les mods et les packs n'empruntent pas le même chemin :

| Contenu | Fonction | Fichier |
|---|---|---|
| Mods | `install_mod_file` via `ModManager` | `lib.rs` (~ligne 3200 Modrinth, ~3520 CurseForge) |
| Shaders, packs, datapacks | `install_remote_archive` | `content_manager.rs` |

Les deux écrivent maintenant dans le **même** index. Avoir raté ça aurait donné un Update Center aveugle à la moitié du contenu.

`Mod` et `ModMetadata` (dans `mod_manager.rs`) ont aussi des champs `project_id` / `version_id`, avec `#[serde(default)]` pour que les catalogues existants restent lisibles.

## Épinglage

`set_pinned()` refuse un fichier inconnu plutôt que d'inventer une entrée.

`record()` **conserve l'épinglage** lors d'une réinstallation du même chemin. L'épinglage est une décision de l'utilisateur, pas un effet de bord d'une opération. Test : `reinstalling_keeps_the_pin`.

## Ce qui n'a pas d'origine

- les mods installés **avant** l'existence de cet index
- les fichiers ajoutés à la main dans `mods/`
- OptiFine — récupéré directement sur optifine.net, aucun projet de plateforme

Ils ne seront jamais mis à jour automatiquement. C'est volontaire.

## Rattrapage par empreinte — fait pour Modrinth

`backfill_content_origins(instance_id)` dans `lib.rs`, bouton « Identifier le contenu » dans le panneau de l'[[Update Center]].

Il hache en SHA-1 chaque fichier de `mods/`, `resourcepacks/`, `shaderpacks/` sans origine connue, puis demande à Modrinth quelle version correspond à ces octets exacts :

```
GET https://api.modrinth.com/v2/version_file/{sha1}?algorithm=sha1
```

API : `modrinth_api::version_from_sha1()`. Un **404 signifie « inconnu »**, pas une erreur — il renvoie `Ok(None)`.

Les fichiers déjà identifiés sont sautés, épinglage compris. Ceux que Modrinth ne connaît pas restent sans origine plutôt que d'être attribués à quelque chose de plausible.

**CurseForge n'est pas couvert** : sa recherche par empreinte utilise un murmur2 avec un pré-traitement particulier, ce n'est pas un simple hash de fichier.
