# Cerveau du projet

Ce vault Obsidian est la mémoire durable de Kiza. Il relie trois niveaux qui ne doivent pas se contredire :

1. **Les décisions produit** — pourquoi une fonction existe et ce qu'elle promet au joueur.
2. **Les systèmes** — les invariants de sécurité, de compatibilité et de restauration.
3. **Le code réel** — les fichiers, symboles et relations extraits automatiquement dans [[Graphe du code/Index|le graphe du code]].

## Entrées principales

- [[Kiza Launcher]] — carte générale du produit
- [[Architecture]] — frontières entre launcher, moteur Tauri et client en jeu
- [[Interface 0.0.301]] — décisions de l'interface actuelle
- [[Compatibilité des versions]] — règle centrale avant toute installation
- [[Tests et qualité]] — preuves attendues avant une release
- [[Feuille de route 0.0.300]] — état d'avancement

## Règle de mise à jour

Une modification importante suit le même chemin :

`besoin joueur → décision documentée → code → tests → capture ou preuve → mise à jour du graphe`

Les notes écrites restent la source des **intentions**. Le dossier `Graphe du code` est régénéré depuis le dépôt et reste la source des **relations techniques observées**. Si les deux divergent, l'écart doit être corrigé ou explicitement documenté ; aucune des deux couches ne doit silencieusement inventer l'autre.

## Écran Découvrir

Le flux actuel est documenté dans [[Interface 0.0.301#Découvrir]]. Les relations techniques se retrouvent autour de `DiscoverTab`, `ContentDetailPanel`, `modrinth_api`, `curseforge_api` et `dependency_resolver` dans le graphe généré.

## Entretien

- Après une modification de code : mise à jour incrémentale Graphify.
- Après une décision fonctionnelle : mise à jour de la note système concernée.
- Avant une release : [[Tests et qualité]], puis vérification que le graphe et les notes décrivent encore le même produit.
