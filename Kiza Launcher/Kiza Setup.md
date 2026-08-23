# Kiza Setup

L'installateur de Kiza Launcher. Une application à part entière — Tauri + Rust, comme le launcher — et non plus l'assistant NSIS en quatre pages.

Source : `KizaaModEngine-Tauri/kiza-setup/`
Sortie : `releases/<version>/Kiza Launcher_<version>_x64-setup.exe`

## Pourquoi une application et pas un assistant

La première fenêtre que quelqu'un voit de Kiza doit ressembler à Kiza. Une seule fenêtre sombre, l'icône, deux cases, un bouton.

Ce choix a un prix, et il est réel : **l'installateur a besoin de WebView2 pour se dessiner**. Sur une machine qui ne l'a pas, il ne peut littéralement pas afficher l'écran qui expliquerait le problème. C'est pour ça que la détection tourne dans `main`, avant toute fenêtre, et que le seul message possible à ce moment-là est une boîte Windows. Voir `webview2.rs`.

## La ligne de commande n'est pas un choix

`tauri-plugin-updater` lance l'installateur téléchargé avec une ligne fixe :

```
KizaSetup.exe /P /R /UPDATE /ARGS <arguments du launcher>
```

Ces commutateurs doivent donc vouloir dire ici ce qu'ils veulent dire dans un installateur NSIS, sinon les mises à jour automatiques cassent **en silence** — le launcher continuerait d'annoncer que la mise à jour est passée.

| | |
|---|---|
| `/S` | aucune fenêtre |
| `/P` | fenêtre visible, rien à cliquer |
| `/R` | relancer le launcher à la fin |
| `/UPDATE` | remplacement d'une install existante |
| `/ARGS` | tout ce qui suit appartient au launcher |
| `/D=` | dossier d'installation — prend **le reste de la ligne brute**, non quoté, comme NSIS |

`cli.rs` réimplémente l'algorithme de découpage de `CommandLineToArgvW`, parce que l'updater échappe les arguments du launcher avec les règles MSVC : plus permissif, un chemin contenant un guillemet ou finissant par un antislash serait corrompu au passage.

## Ce qu'il fait

1. Vérifie que le dossier ne contient rien d'étranger — le désinstalleur le supprime en entier
2. Attend que le launcher en cours finisse de se fermer
3. Décompresse la charge utile (zstd, ~10 Mo pour 37 Mo)
4. Efface ce que l'ancien NSIS avait laissé : `KizaaMod.exe`, `uninstall.exe`
5. Se recopie comme désinstalleur
6. Crée les raccourcis demandés
7. Écrit l'entrée « Applications et fonctionnalités »

## Les pièges rencontrés

**Un exécutable en cours ne se supprime pas, mais il se renomme.** C'est tout le truc pour mettre à jour un launcher encore en train de s'éteindre : on pousse l'ancien de côté sous `.superseded`, on écrit le nouveau, on balaie au prochain lancement. `payload::replace_file`.

**L'ancien NSIS écrivait `InstallLocation` entre guillemets.** Lu tel quel, une mise à jour partirait vers un dossier dont le nom contient des guillemets — donc une deuxième copie de Kiza à côté de la première, au lieu d'un remplacement. `registry::unquote`.

**Tauri nomme le binaire d'après la caisse Cargo, pas d'après le produit.** Toutes les installs antérieures contiennent donc un `KizaaMod.exe`. Sans `layout::LEGACY_FILES`, le dossier serait lu comme « des fichiers de quelqu'un d'autre » et **tous** les utilisateurs existants se verraient refuser la mise à jour.

**Le Bureau n'est pas `%USERPROFILE%\Desktop`.** OneDrive le déplace. `folders.rs` demande les chemins à Windows.

**Le désinstalleur ne peut pas supprimer le dossier où il tourne.** Il se recopie dans `%TEMP%` et repasse la main.

## Ce qui n'est jamais supprimé sans qu'on le demande

`%APPDATA%\com.kizamods.engine` — instances, mondes, comptes. La case existe, elle est à part, en rouge, et jamais cochée d'avance.

## Voir l'écran sans construire

```
node scripts/setup-preview.mjs
```

Puis `?state=install | update | unattended | uninstall | error | no-payload`.

## Liens

[[Kiza Launcher]] · [[Build et release]] · [[Mises a jour du launcher]] · [[Tests et qualité]]
