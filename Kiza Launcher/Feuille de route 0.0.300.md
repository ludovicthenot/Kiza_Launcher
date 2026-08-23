# Feuille de route 0.0.300

Les neuf chantiers décidés pour la 0.0.300, dans l'ordre imposé par leurs dépendances.

## Fait — tout

- [x] **[[Crash Doctor]]** — diagnostic précis et actions correctives
- [x] **[[Téléchargements reprenables]]** — HTTP Range réel
- [x] **[[Points de restauration]]** — snapshots globaux avec déduplication
- [x] **[[Update Center]]** — épinglage, rollback, application groupée, changelog
- [x] **[[Mode sans echec]]** — dichotomie, avec les deux lancements de référence
- [x] **[[Server Hub]]** — protocole Minecraft en direct, instance liée obligatoire
- [x] **[[World Vault]]** — sauvegardes différentielles, rétention par monde, refus pendant que le jeu écrit
- [x] **[[Kiza Lockfile]]** — export ordonné, diff à quatre verdicts, reconstruction
- [x] **[[Performance Advisor]]** — journal GC, temps jusqu'au menu, comparaison avant/après
- [x] *(non prévu, mais bloquant)* **[[Provenance du contenu]]** et **[[Verrou d'instance]]**
- [x] *(non prévu)* **[[Lecteur NBT]]**, **[[Mises a jour du launcher]]**, **[[Fermeture vers la zone de notification]]**

Livré en **0.0.300**.

## Les cinq points laissés ouverts — faits en 0.0.301

- [x] **Lien `kiza://join/...`** — voir [[Liens kiza]]. A révélé que `nxm://` n'avait **jamais** été enregistré auprès de Windows.
- [x] **Import de `servers.dat`** — [[Lecteur NBT]] étendu aux listes de composés ; serveurs comparés par adresse.
- [x] **Verdict automatique du [[Mode sans echec]]** — code de sortie, plus « le jeu a-t-il atteint son menu ».
- [x] **Empreinte murmur2 CurseForge** — [[Provenance du contenu]] rattrape maintenant aussi ce qui n'est que sur CurseForge.
- [x] **Rétrogradation volontaire** dans l'[[Update Center]] — toutes les versions compatibles, résultat épinglé.

## Reste ouvert

*(Les deux points de cette section ont été levés — conservés ici parce qu'ils expliquent pourquoi ils avaient été laissés.)*

- ~~**Le panneau de détail de Découvrir** n'a pas été passé en onglets~~ — fait. `ContentDetailPanel.tsx` porte Installer / Description / Versions / Dépendances, et la mécanique d'installation existante est restée derrière.
- ~~**Aucune vérification à l'œil**~~ — levé. `scripts/ui-preview-screenshot.mjs` rend l'application avec un backend Tauri simulé et capture chaque écran. Le harnais **refuse** une page de réglages qui rendrait moins de 40 caractères, et vérifie que le canal de mise à jour est atteignable depuis l'interface.

Ce qui reste vraiment :

- **Deux `TODO` dans `mod_manager.rs`** : la version d'un mod est fixée à `1.0.0` faute de la lire dans son manifeste, et le classement « fichier vanilla ou non » n'a pas de manifeste vanilla de référence. Antérieurs à la 0.0.300.
- **La mesure de performance**, pas l'adaptation : `tune_profile_memory` ajuste déjà la RAM à la machine réelle. Ce qui manque est de mesurer l'effet.

⚠️ Sur la performance : `tune_profile_memory` **adapte déjà** la RAM à la machine réelle (`get_performance_profiles` dans `minecraft_manager.rs`). Ce qui manque est la **mesure**, pas l'adaptation.

## Hors code

Trois points du document initial ne sont pas des tâches de développement :

- **CI de compatibilité** — les runners GitHub n'ont ni GPU ni écran. Réaliste : tester installation, manifests, loaders, Java et classpath. Le lancement réel reste un smoke test local (`real_launch_smoke`, `#[ignore]`).
- **Relais CurseForge** — décision d'infrastructure : hébergement, maintenance, disponibilité. La clé est aujourd'hui inscrite dans le binaire par `option_env!` (`lib.rs`), donc extractible.
- **Licence hors ligne** — décision produit et juridique. Un contrôle local n'est jamais une protection forte.

## Route longue non retenue

Faire tourner 1.8.9 sur une JVM moderne, comme LabyMod (qui met **1.8.9 à 1.21.11 sur Java 21**).

Faisable mais lourd, et rien d'existant pour **1.8.9 Forge** : `lwjgl3ify` cible 1.7.10 uniquement, et les projets 1.8.9 (`legacy-lwjgl3`) sont des mods **Legacy Fabric / Ornithe**.

Il faudrait porter : shim LWJGL2→LWJGL3, remplacement du LaunchWrapper, classes Forge patchées, chargeur de classes système personnalisé, longue liste d'`--add-opens`, transformateurs ASM. Et ça repose sur `sun.misc.Unsafe`, dont la suppression est annoncée.

Gain par rapport à l'existant : le menu complet au lieu du logo, plus un peu de performance. Rapport coût/bénéfice mauvais — voir [[Compatibilité des versions]].

Note : Legacy Fabric serait une **quatrième option** de loader, pas un remplacement. Mais en 1.8.9 tout l'écosystème est Forge, donc personne ne ferait ce choix.
