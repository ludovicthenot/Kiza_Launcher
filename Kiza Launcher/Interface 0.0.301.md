# Interface 0.0.301

Refonte de l'accueil, de l'onglet Mods et de l'écran Découvrir, d'après les maquettes de Nefer.

## Aucune illustration n'est fabriquée

**Décision tenue, et confirmée par Nefer :** Kiza ne livre aucune image d'instance et n'en invente aucune. Une carte décorée d'une image que personne n'a choisie prétend décrire l'instance.

Deux sources, et deux seulement :

1. **Une image choisie par le joueur** — `instance_art.rs`, PNG ou JPEG **identifié par ses octets**, pas par son extension : le type déclaré au moteur de rendu doit correspondre au vrai fichier, sinon un SVG porteur de script passerait pour une image. 8 Mo maximum.
2. **À défaut, un dégradé** dérivé de l'identifiant de l'instance. Toujours le même pour la même instance, donc reconnaissable — et manifestement un substitut.

La couverture est demandée **par carte**, pas avec la liste des instances : plusieurs mégaoctets de base64 à chaque rechargement de la bibliothèque ralentiraient la liste pour une décoration.

> Tests : `an_image_is_identified_by_its_bytes_not_its_name`, `replacing_a_cover_in_another_format_leaves_only_one`

## L'accueil

Affiches en portrait, dégradé de lisibilité par-dessus l'image, pastille d'état et rangée d'action sur la carte sélectionnée seulement.

**La sélection par défaut est l'instance jouée le plus récemment**, pas la première de la liste : rouvrir le launcher pour rejouer est le cas courant. La date vient de `play-history.json`, écrite au lancement — elle n'est pas inventée.

**Jouer depuis la bibliothèque n'est possible qu'avec un compte connecté.** Sans compte il y a un pseudo à choisir et un [[Profils hors ligne|profil hors ligne]] à sélectionner ; deviner l'un ou l'autre démarrerait la partie sous une identité qui n'est pas celle du joueur. La carte ouvre alors l'instance, où ce choix vit.

Animation GSAP : l'en-tête se pose, les affiches se distribuent en cascade, la rangée d'action accompagne la sélection plutôt que d'apparaître d'un coup.

## L'onglet Mods

La flèche `19.21.0.247 → 19.21.0.260` est réelle : l'[[Update Center]] raisonne en **chemins de fichiers** et la liste en **mods**, donc les deux sont joints sur les noms de fichiers déployés — la seule chose que les deux côtés portent.

**Le bandeau « un mod provoque un crash ? » est une offre, pas le panneau.** Dès qu'une chasse démarre, le panneau du [[Mode sans echec]] prend sa place.

**La suppression est passée derrière le menu ⋮ de la ligne** : ce n'est pas une chose à pouvoir toucher par accident en parcourant une liste. Le test qui cliquait directement dessus a été mis à jour — le comportement testé (confirmation avant suppression) est inchangé, seul le chemin l'est.

La barre d'actions groupées flotte au-dessus de la liste au lieu de remplacer la barre d'outils, pour que les filtres restent atteignables pendant une sélection.

## La barre latérale

Les catégories de contenu sont au **premier niveau** : quelqu'un qui cherche ses shaders cherche le mot « shaders », et le lui faire trouver dans « contenu installé » d'abord n'achète rien.

L'en-tête « Contenu installé » et la barre de retour du haut répétaient cette navigation — supprimés.

## Découvrir

L'écran suit la maquette de référence : barre latérale de 300 px, recherche et sources sur une ligne, liste à gauche, panneau d'installation à droite et statut des sources en pied de page.

**Toutes** interroge Modrinth et CurseForge en parallèle. Les réponses restent séparées jusqu'à l'affichage : Kiza ne compare pas de faux scores de pertinence entre plateformes, il entrelace les rangs renvoyés par chacune. Les tris par téléchargements et mise à jour sont transmis aux deux API, puis servent aussi à ordonner la vue fusionnée.

Les deux filtres visibles sont réels : version Minecraft exacte et chargeur de mods. Les retirer relance la recherche avec le filtre correspondant désactivé ; la pastille du bouton reflète donc l'état effectif de la requête.

Le panneau de détail est maintenant commun aux deux plateformes. Il contient le favori local, la compatibilité avec l'instance, les statistiques, les onglets Installer · Description · Versions · Dépendances, la version recommandée chargée automatiquement, l'installation avec résolution préalable des dépendances et le téléchargement seul.

La mécanique existante reste derrière ce panneau : les mods passent par `resolve_mod_dependencies` puis la confirmation, les autres contenus gardent leur chemin spécialisé, et « Télécharger uniquement » n'écrit rien dans l'instance.

## Vérification visuelle

L'écran Découvrir a été rendu avec un backend Tauri simulé et comparé à la maquette en **1585 × 991 px**. Les repères structurants sont alignés : barre latérale à 300 px, début du contenu à 333 px, séparation liste/détail à 904–915 px et pied de page à 943 px. Les panneaux de tri et de filtres ont également été ouverts et contrôlés.

## Liens

[[Kiza Launcher]] · [[Update Center]] · [[Mode sans echec]] · [[Server Hub]] · [[Profils hors ligne]]
