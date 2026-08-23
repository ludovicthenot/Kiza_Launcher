# Build et release

## La commande

```bash
cd "C:\Users\nefer\Desktop\Projet\Kiza Mods\KizaaModEngine-Tauri"
npm run bump-version
npm run build:installer
```

Une seule commande, une seule sortie : [[Kiza Setup]]. Elle construit le launcher, l'emballe dans l'installateur, signe le tout et écrit `latest.json`.

L'assistant NSIS n'est plus livré. `npx tauri build` sait toujours en fabriquer un — la configuration garde ses cibles — mais plus rien ne l'utilise.

Variables d'environnement nécessaires :

- `KIZAMODS_CURSEFORGE_API_KEY` — lue depuis les variables utilisateur Windows
- `TAURI_SIGNING_PRIVATE_KEY` — contenu de `.tauri-keys/kizamods-updater.key`

## Règle du projet

Chaque modification importante produit un setup, copié dans :

```
C:\Users\nefer\Desktop\Projet\Kiza Mods\releases\<version>\
```

⚠️ **Pas** dans `KizaaModEngine-Tauri/releases`. Le dossier est au niveau **parent**.

## Ce que la commande produit

```
releases/<version>/
  Kiza Launcher_<version>_x64-setup.exe        ~12,6 Mo
  Kiza Launcher_<version>_x64-setup.exe.sig
  latest.json
```

Publication : `npm run release:publish` envoie vers Cloudflare R2. Le secours GitHub part avec le tag.

Les trois partent ensemble ou aucun. `latest.json` nomme l'installateur par son URL, et **GitHub remplace les espaces d'un nom d'asset par des points** — une URL construite depuis le nom tel qu'il est sur le disque renverrait un 404 à tout le monde.

## Le piège du code de sortie

`npx tauri build` renvoyait régulièrement **exit 4** alors que le journal se terminait proprement sur « Finished 2 bundles ». `scripts/build-installer.mjs` ne s'y fie plus : il vérifie l'existence de chaque fichier attendu et s'arrête sur le premier manquant.

## Vérifier qu'un setup contient bien les changements

Erreur déjà commise : annoncer qu'un setup contenait une fonctionnalité alors que l'exe était **antérieur** à la modification du code.

Comparer les dates :

```bash
ls -la --time-style=+%H:%M:%S dist/assets/*.js
ls -la --time-style=+%H:%M:%S "src-tauri/target/release/bundle/nsis/Kiza Launcher_<v>_x64-setup.exe"
```

L'exe doit être **postérieur** au bundle web. On peut aussi chercher une chaîne du changement dans `dist/assets/*.js`.

## Ne jamais pousser

- `.claude` et les dossiers en point
- `graphify-out/` (déjà dans `.gitignore`, ligne 68)

## Commits

Pas de co-auteur Claude sur les commits de ce projet.

Lié : [[Kiza Setup]], [[Tests et qualité]], [[Mises a jour du launcher]], [[Kiza Launcher]].
