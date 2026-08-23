# Import et export d'instance

Partager une instance complète sous forme de zip.

## Où

- Export : `export_instance()` dans `src-tauri/src/minecraft_manager.rs`
- Import : `import_instance_archive()` dans `src-tauri/src/content_manager.rs`
- UI : bouton scindé « Nouvelle instance | ou importer » dans `src/components/views/LibraryView.tsx`

## Format

Manifeste CurseForge, avec une différence assumée :

```json
{
  "minecraft": { "version": "...", "modLoaders": [{ "id": "forge-47.4.21", "primary": true }] },
  "manifestType": "minecraftModpack",
  "files": [],
  "overrides": "overrides"
}
```

`"files": []` et les jars sont **embarqués** dans `overrides/mods`. Le zip se suffit donc à lui-même : l'ami l'importe et a tout, sans rien retélécharger.

L'import **refuse** les packs dont `files` n'est pas vide (ils référencent des fichiers distants) et renvoie vers Recherche de contenu > Modpacks.

## Le bug de l'identifiant de loader

CurseForge rejetait les exports avec « Unsupported mod loader ».

Cause : on écrivait `forge-11.15.1.2318-1.8.9`, alors que CurseForge attend `forge-11.15.1.2318`. La version de Minecraft ne doit **pas** être répétée dans l'identifiant du loader.

Corrigé par `manifest_loader_version()`, qui retire le suffixe `-1.8.9` comme le préfixe `1.8.9-`. Deux tests verrouillent le format.

## Ce qui est capturé

`overrides/mods` et `overrides/config`. Pas les mondes.

À ne pas confondre avec les [[Points de restauration]], qui capturent davantage et servent à revenir en arrière, pas à partager.
