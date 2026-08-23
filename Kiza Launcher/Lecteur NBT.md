# Lecteur NBT

Juste assez de NBT pour qu'un monde dise son propre nom. `src-tauri/src/nbt.rs`, 5 tests.

## Pourquoi

Le dossier sous `saves/` porte le nom qu'avait le monde **le jour de sa création**. Minecraft ne renomme jamais le dossier quand le joueur renomme le monde. Une liste de sauvegardes qui affiche des noms de dossiers affiche des noms faux.

Le vrai nom est dans `level.dat`, du NBT gzippé.

## Un lecteur, pas une bibliothèque

Il parcourt l'arbre, garde la poignée de valeurs dont une liste de mondes a besoin, et **saute tout le reste**. Un `level.dat` contient des centaines de champs et aucun autre ne nous regarde.

Champs lus : `LevelName`, `LastPlayed`, `Version.Name`, `hardcore`, `GameType`. Tous optionnels — un vieux monde qui n'en a pas doit rester listable et sauvegardable.

## Sauter correctement

La difficulté n'est pas de lire les champs voulus, c'est de **franchir les autres sans perdre sa place**. Un `TAG_List` de composés doit être parcouru élément par élément ; un `TAG_Long_Array` demande une multiplication ; une chaîne est préfixée d'une longueur sur deux octets.

Le test construit un `level.dat` à la main, avec les champs voulus **enterrés** au milieu d'un `double`, d'un tableau de `long`, d'un composé imbriqué et d'une liste de composés — puis vérifie que `GameType`, qui vient après tout ça, est lu correctement.

> Tests : `fields_we_do_not_read_are_walked_past_without_losing_place`, `a_world_reports_the_name_the_player_gave_it`

## Refuser plutôt que deviner

Un fichier tronqué renvoie `None`. La moitié d'une description de monde n'est pas une description de monde.

`read_level_dat` tente le gzip d'abord (le cas réel), puis le NBT brut : quelques outils l'écrivent non compressé. Un `level.dat` illisible **n'empêche jamais** de sauvegarder le monde — le [[World Vault]] retombe sur le nom du dossier.

## Dépendance

`flate2` 1.1.9, déjà présent transitivement via `zip`, donc ajouté en dépendance directe sans coût de compilation.

## Liens

[[World Vault]] · [[Architecture]]
