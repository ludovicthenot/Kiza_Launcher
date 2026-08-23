# Pack de branding KizaClient

Le resource pack `KizaClient.zip` déposé dans `resourcepacks/` de chaque instance et activé automatiquement dans `options.txt`.

## Où

`src-tauri/src/minecraft_manager.rs` :

- `KIZA_PACK_FILE = "KizaClient.zip"`
- `build_kiza_branding_pack(game_dir, pack_format)`
- `enable_kiza_pack_in_options(game_dir)`

Régénéré à **chaque lancement**.

## Contenu

Uniquement du **côté vanilla** — ce que le mod ne peut pas fournir :

- `assets/minecraft/textures/gui/title/edition.png` — la bannière « KIZA CLIENT »
- `assets/minecraft/texts/splashes.txt` — les splash lines
- `assets/minecraft/textures/gui/sprites/widget/*.png` — le skin des boutons modernes
- `assets/minecraft/textures/gui/widgets.png` — idem pour 1.7-1.12
- `pack.mcmeta`, `pack.png`

## Ce qui en a été retiré

Il embarquait aussi `kiza_launcher_logo.png`, `kiza_client_header.png` et `kiza_menu_background.png` sous `assets/kiza_base_mod/…` — **exactement les mêmes octets** que ceux déjà dans le jar du mod.

Inutile : personne ne lit le namespace `kiza_base_mod` si le mod n'est pas chargé, et s'il l'est, le jar les fournit. C'était **2,4 Mo sur 2,46 Mo**, recopiés dans chaque instance à chaque lancement.

Le pack fait maintenant ~15 Ko. Un test (`branding_pack_ships_only_what_the_jar_cannot_provide`) échoue s'il repasse au-dessus de 64 Ko ou si le namespace du mod y revient.

## Pourquoi il reste indispensable

C'est la **seule** marque Kiza sur une instance **vanilla**, où aucun mod ne peut être chargé. Et il habille tous les écrans que le menu Kiza ne remplace pas.

Voir [[Compatibilité des versions]] pour le tableau complet.

## pack_format

Lu depuis le `version.json` **à l'intérieur du jar client** (`client_jar_pack_format`). Le manifeste émet `pack_format`, `min_format` et `max_format` — les clés inconnues sont ignorées de part et d'autre, donc le pack reste chargeable partout.
