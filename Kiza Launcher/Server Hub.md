# Server Hub

Serveurs favoris avec leur état en direct. `src-tauri/src/server_hub.rs`, 8 tests.

## Le ping parle le protocole de Minecraft

Aucun service tiers. Le launcher ouvre une socket, envoie la poignée de main puis la demande de statut, et lit la réponse — le *Server List Ping* que le client fait lui-même.

Toute la partie encodage est pure et couverte par des tests ; seule la socket ne l'est pas.

## Trois pièges, chacun avec son test

**Les VarInt.** Sept bits par octet. Le numéro de protocole envoyé est `-1` ; un décalage arithmétique l'étendrait indéfiniment. Le test vérifie qu'il tient en cinq octets, et qu'un VarInt tronqué est **rejeté plutôt que deviné**.

**Le MOTD.** Une chaîne sur les vieux serveurs, un arbre d'objets imbriqués sur les récents. Sans aplatissement on afficherait du JSON brut ; sans retrait des codes `§`, des couleurs en plein milieu du texte.

**Les adresses IPv6.** Plusieurs deux-points. Compter les `:` pour trouver le port casserait `::1` — le test couvre les deux formes, avec et sans crochets.

> Tests : `varints_round_trip_including_negative_values`, `a_modern_motd_object_becomes_plain_text`, `addresses_default_to_the_minecraft_port`

## Rejoindre exige une instance liée

Chaque serveur peut être associé à une instance ; le bouton reste désactivé tant qu'il n'y en a pas. Lancer une instance au hasard serait pire que ne rien faire.

La date de dernière connexion n'est enregistrée qu'**après** le démarrage réel du jeu.

## Un serveur injoignable ne bloque rien

Cinq secondes de délai maximum. Il s'affiche comme injoignable pendant que les autres répondent.

## Interface

Bouton **Serveurs** dans l'en-tête de la bibliothèque, superposition plein écran (`ServerHubView.tsx`).

## Non fait, et assumé

- **Lien `kiza://join/...`** — demande d'enregistrer un protocole auprès de Windows et de traiter l'ouverture par lien au démarrage.
- **Import de `servers.dat`** depuis une instance — demanderait d'étendre le [[Lecteur NBT]] à l'écriture et aux listes de serveurs.

## Liens

[[Architecture]] · [[Lecteur NBT]] · [[Feuille de route 0.0.300]]
