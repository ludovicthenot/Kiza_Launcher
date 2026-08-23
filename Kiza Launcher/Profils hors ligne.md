# Profils hors ligne

Jouer sans compte Microsoft, avec un pseudo enregistré et éventuellement un skin.

## Où

- Module : `src-tauri/src/offline_accounts.rs`
- Stockage : `<app_data>/config/offline_accounts.json`, skins dans `<app_data>/minecraft/skins/<id>.png`
- Commandes : `offline_accounts_list`, `offline_account_create`, `offline_account_rename`, `offline_account_delete`, `offline_account_import_skin`
- UI : `src/components/settings/OfflineProfiles.tsx`, dans l'onglet **Minecraft** des paramètres
- Sélection au lancement : `src/components/instance/InstanceHeader.tsx`

## L'UUID hors ligne

Le point le plus important de ce module.

```rust
offline_uuid(name) = MD5("OfflinePlayer:" + name), bits de version forcés
```

C'est exactement ce que fait `UUID.nameUUIDFromBytes` dans le jeu.

**Avant**, le launcher générait un `Uuid::new_v4()` **à chaque lancement** hors ligne — le joueur changeait donc d'identité à chaque session. Désormais le même pseudo donne toujours le même joueur, et les données de monde suivent.

Dépendance ajoutée pour ça : `md5 = "0.7.0"`.

## Validation

Règles Minecraft : 3 à 16 caractères, lettres, chiffres, underscore. Doublons refusés **sans tenir compte de la casse**, pour que deux profils ne puissent pas désigner le même joueur.

## Import de skin

`import_skin()` lit l'en-tête PNG pour vérifier que le fichier est réellement un PNG (signature + `IHDR`) et que ses dimensions sont **64×64 ou 64×32**. Supprimer un profil supprime son skin.

## ⚠️ Le skin ne s'affiche pas en jeu

Limite de Minecraft, pas un bug. Le jeu récupère les skins auprès des serveurs de session Mojang ; en mode hors ligne il n'y a pas de session, donc Steve ou Alex quoi qu'on stocke localement.

Le skin importé est **cosmétique dans le launcher**.

Pour qu'il apparaisse en partie il faudrait le faire lire par [[Moteur de rendu in-game|kiza-base-mod]] — `KizaCanvas` sait déjà transformer une image en texture de jeu. C'est un chantier à part.

## Choix du compte au lancement

Le champ « Offline username » **ne servait à rien** : dès qu'un compte était enregistré, le backend écrasait le nom saisi sans le dire.

`launch_minecraft_instance` prend maintenant un paramètre `offline: Option<bool>`. Absent = comportement précédent.
