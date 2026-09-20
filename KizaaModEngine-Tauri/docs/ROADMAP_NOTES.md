# Notes de conception — septembre 2026

Ce document répond à deux demandes : préciser les fonctionnalités « qui
manquent » (comparées à Modrinth App, Prism, CurseForge App), et réfléchir
— sans encore le construire — au **profil / amis dans le jeu** et au
**signalement de bug depuis le jeu**.

---

## 1. Fonctionnalités à préciser

### 1.1 Mise à jour d'un modpack (pack entier, pas mod par mod)

**Aujourd'hui.** `update_center` sait proposer une nouvelle release de chaque
mod dont la provenance est connue. Un pack installé depuis le catalogue porte
un marqueur `Modpack curseforge:285109` mais rien ne compare la version du
pack installée à celle publiée.

**Cible.** Sur une instance qui porte le marqueur, un bandeau « RLCraft 2.9.4
est disponible (tu as 2.9.3) ». Le bouton fait :

1. point de restauration (existant) ;
2. téléchargement du nouveau manifest ;
3. diff des fichiers : ajoutés / retirés / changés de version — appliqué via
   le pipeline `fetch_pack_files` (déjà en trois phases) ;
4. overrides : les fichiers de config du nouveau pack **remplacent** ceux du
   pack, mais un fichier que le joueur a modifié depuis l'installation est
   conservé et listé (« 3 configs gardées, à vérifier ») — détection par hash
   au moment de l'installation initiale (à stocker dans
   `content-provenance.json`, section `overrides`) ;
5. les mondes ne sont jamais touchés.

**Effort.** 2–3 jours. Le seul morceau neuf est le diff d'overrides.

### 1.2 Import depuis d'autres launchers

**Fait** (0.0.344) : CurseForge App, Modrinth App, Prism, MultiMC, launcher
officiel. Reste : GDLauncher, ATLauncher, Technic — chacun est une demi-journée
(format connu, même copie).

### 1.3 Partage d'instance par lien / code

**Aujourd'hui.** Export en zip (avec `kiza.json`), import du zip. Le zip transite
par Discord ou Drive à la main.

**Cible.** « Partager » produit un **code court** (`KZ-7F3A2Q`). Le launcher
envoie au worker uniquement le **lockfile** (identités des mods : plateforme,
projet, version, hash — jamais les jars, jamais les mondes), stocké dans R2
sous `shares/<code>.json`, 30 jours. L'ami colle le code dans « Importer →
depuis un code » : Kiza reconstruit l'instance en téléchargeant chaque mod
depuis sa plateforme d'origine. Les mods bloqués sur CurseForge passent par la
même fenêtre « mods manquants » qu'un pack.

Pourquoi le lockfile et pas le zip : un lockfile fait 20 Ko, le zip 300 Mo ; le
lockfile ne redistribue aucun fichier d'auteur.

**Effort.** Worker : un endpoint POST/GET (1 jour). Launcher : réutilise
`lockfile_export` et `lockfile_apply` (existants) — 1 jour + l'UI.

### 1.4 Versions d'un mod, changelog, retour arrière

**Aujourd'hui.** `list_content_versions` / `set_content_version` existent ;
le changelog CurseForge est récupéré (`get_file_changelog`). Le dialogue mod
montre la version courante.

**Cible.** Dans `ModInfoDialog`, un onglet « Versions » : liste des releases
compatibles (Minecraft + loader de l'instance), la courante marquée, le
changelog déplié au clic, un bouton « Installer cette version » qui passe par
un point de restauration. « Revenir à la version précédente » = même chose,
pré-sélectionnée.

**Effort.** 1 jour, tout le backend est là.

### 1.5 Serveurs multijoueur côté client

**Aujourd'hui.** `HostView` héberge des serveurs. Côté client, rien : la liste
de serveurs est celle de Minecraft (`servers.dat`).

**Cible.** Dans une instance, un onglet « Serveurs » qui lit `servers.dat`
(le module `nbt` existe), pingue chaque serveur (protocole *Server List Ping*,
un handshake + status en TCP — 40 lignes en Rust), affiche joueurs en ligne /
version / MOTD, et un bouton **Rejoindre** qui lance l'instance avec
`--quickPlayMultiplayer <adresse>` (1.20+) ou `--server/--port` (avant).
Bonus : « Ajouter le serveur d'un ami » à partir d'un code Kiza Play.

**Effort.** 2 jours.

### 1.6 Sauvegardes de mondes

**Aujourd'hui.** `world_vault` fait des checkpoints manuels et par
programmation ; l'UI (`WorldVaultPanel`) existe.

**À vérifier** (audit rapide à faire) : une sauvegarde **automatique** avant
chaque lancement d'un pack qui vient d'être mis à jour, et une planification
(« tous les jours à la fermeture du jeu, garder 7 »). Le module a `prune` ;
il manque le déclencheur dans le watcher de sortie du jeu.

**Effort.** Une demi-journée.

### 1.7 Langues

Le système supporte n langues ; seules EN et FR sont remplies (1 250 chaînes).
Ajouter ES / DE / PT-BR = traduire un fichier. Proposition : ne le faire que
quand la communauté le demande, et accepter les contributions via un fichier
`i18n/<lang>.json` séparé (aujourd'hui les chaînes sont dans `i18n.tsx`).

---

## 2. Profil et amis dans le jeu — conception

### 2.1 Ce qu'on veut

Dans le menu principal, **en haut à gauche**, un bouton avec la **même
animation que le chip de profil du launcher** : la tête du skin + le pseudo.
Au clic : un panneau **Amis** — qui est en ligne, sur quelle instance / quel
serveur, « Rejoindre », « Inviter ». Plus tard : aperçu du skin des amis.

### 2.2 Où ça vit

Trois couches, chacune fait ce qu'elle sait faire :

| Couche | Rôle |
|---|---|
| **Worker Cloudflare** (`/v1/presence`) | Registre de présence : « le compte X est dans l'instance Y (nom public), sur le serveur Z (si l'ami l'autorise) ». Liste d'amis par compte (demandes, acceptations). Stockage KV, TTL 90 s sur la présence. Auth = le pass Kiza existant (`gate.js`). |
| **Launcher** | Seul à parler au worker (il a le pass). Pousse sa présence toutes les 60 s (état lu via le state bridge : menu / survie / multi + adresse si autorisée). Reçoit la liste d'amis et la pousse au client par le **state bridge** (fichier JSON atomique, même mécanisme que `client-runtime.json`, sens launcher → jeu cette fois). |
| **Client (kiza-base-mod)** | Ne fait aucun réseau. Lit `friends.json`, dessine le bouton et le panneau dans le title screen avec les mêmes primitives que le menu Kiza (`KizaPanel`, `KizaText`, `KizaCanvas`). « Rejoindre » écrit une demande dans `client-actions.json` ; le launcher la lit et connecte (`--quickPlayMultiplayer`) ou lance l'instance qu'il faut. |

Aucune requête HTTP depuis le mod : c'est ce qui le garde compatible de 1.7 à
26.x et ce qui évite d'embarquer des secrets dans un jar.

### 2.3 Mod-friendly, comme le reste

Le bouton respecte `Courtesies.menu()` : si CustomMainMenu / FancyMenu
dessine le menu, on **ne dessine pas** par-dessus. À la place, l'overlay amis
est accessible par une touche (`F8` par défaut, configurable) et un petit
toast « 2 amis en ligne — F8 » à l'ouverture du menu. Le bouton profil n'est
qu'un raccourci vers le même panneau.

### 2.4 Vie privée

- Présence **opt-in**, réglage dans le launcher (« Montrer à mes amis ce que je
  joue »). Trois niveaux : rien / l'instance / l'instance et le serveur.
- Les amis sont des comptes Kiza (pass), pas des UUID Minecraft publics.
- Le worker ne garde que le dernier état, 90 s.

### 2.5 Étapes

1. Worker : `/v1/friends` (liste, demande, accepter, retirer) + `/v1/presence`
   (POST le mien, GET ceux de mes amis). — 2 jours.
2. Launcher : page **Amis** dans les réglages ou le titre (chip profil →
   « Amis »), pousse la présence, écrit `friends.json` dans le runtime de
   l'instance en cours. — 2 jours.
3. Client : bouton + panneau (Fabric moderne et Forge moderne d'abord, legacy
   ensuite), lecture de `friends.json`, écriture des actions. — 3 jours.
4. Rejoindre : lecture des actions côté launcher, Quick Play. — 1 jour.
5. Skins des amis : le launcher a déjà `minecraft_skins` ; il dépose les têtes
   PNG dans le runtime, le client les charge comme textures dynamiques. — 1 jour.

### 2.6 Signaler un bug depuis le jeu

Même canal : une touche (`F9`) dans le client ouvre un petit formulaire (titre,
une ligne), prend une **capture d'écran** (le framebuffer, sauvée en PNG dans
`runtime/reports/`), et écrit `client-actions.json { report: … }`. Le launcher
le voit, compose le ticket via `support::prepare` (existant) avec la capture
en pièce jointe, et l'envoie par `/v1/support`. Le joueur n'a pas à quitter le
jeu ni à retrouver un log. — 2 jours (le worker doit accepter une image :
1 jour de plus).

---

## 3. Ce qui reste hors périmètre pour l'instant

- CI (décision : pas maintenant).
- Benchmark automatique de profil de performance (pas convaincant).
- Hub communautaire de packs vérifiés.
