# Performance Advisor

Pourquoi une instance tourne comme elle tourne. `src-tauri/src/performance_advisor.rs`, 28 tests.

## La contrainte honnête

**Le launcher est en dehors du jeu : il ne voit pas les images.** Donc rien ici n'annonce un nombre de FPS. L'advisor travaille sur trois choses qu'il peut réellement observer :

1. **La JVM donnée au jeu** — tailles de tas, version de Java, choix du collecteur ;
2. **Le journal du ramasse-miettes**, quand un lancement a été mesuré — c'est de là que vient l'écrasante majorité des à-coups de Minecraft ;
3. **Le temps jusqu'au menu**, chronométré par le launcher entre le lancement du processus et le premier battement de cœur du mod de base ([[Moteur de rendu in-game]]).

Tout le reste est une fonction pure de ces observations : les règles se discutent dans des tests, pas dans une partie en cours.

## Il se tait quand il n'a rien à dire

Comme le [[Crash Doctor]]. Une instance bien configurée produit une **liste vide**, pas une page de conseils de remplissage.

> Test : `a_well_configured_instance_gets_no_advice_at_all`

Du conseil de remplissage entraîne l'utilisateur à ignorer le panneau, ce qui lui coûte la seule fois où ça compte.

## Les règles

| Règle | Gravité | Raison |
|---|---|---|
| Tas > 60 % de la RAM installée | critique | Windows, le pilote graphique et le cache disque ont besoin du reste. Au-delà, plus de mémoire rend le jeu **plus lent**. |
| Tas encore plein à 85 % après collecte | critique | Ce qui survit à une collecte est ce dont le jeu a vraiment besoin. Le collecteur tourne en permanence et ne libère presque rien. |
| Gel > 200 ms | avertissement | Rapporté en images perdues : `340 ms` = « 20 images d'un coup ». |
| Deux moteurs de rendu installés | critique | OptiFine + Sodium/Embeddium : conflit, crash ou pire performance que chacun seul. |
| Java plus ancien que ce que la version déclare | avertissement | Les Java récents collectent par bursts plus courts. |
| `-Xms` ≠ `-Xmx` | astuce | Chaque agrandissement du tas est une pause. |
| Aucun moteur de rendu sur ≥ 1.16 | astuce | Le plus gros gain de FPS disponible. |

**OptiFine seul est laissé tranquille.** C'est aussi un remplacement de moteur de rendu ; dire à quelqu'un de changer une configuration qui marche n'est pas du conseil de performance.

**Aucun moteur n'est proposé avant 1.16** — Sodium n'existe pas pour 1.8.9, et envoyer quelqu'un le chercher lui gâche la soirée.

Le moteur proposé dépend du loader : Sodium pour Fabric, Embeddium pour Forge.

> Tests : `optifine_alone_is_left_alone`, `no_renderer_is_suggested_for_versions_that_have_none`, `the_renderer_suggested_matches_the_loader`

## Le tas rapporté est celui que la JVM obéirait

`parse_heap_args` lit les tailles **dans la ligne de commande finale**, pas dans les réglages censés la produire. Un override d'instance, un profil de performance et les arguments personnels de l'utilisateur atterrissent dans la même liste, et la JVM obéit au **dernier** `-Xmx` qu'elle voit.

> Test : `the_heap_reported_is_the_one_the_jvm_would_obey`

## Mesurer un lancement

Opt-in, et valable **exactement un lancement**. Journaliser chaque session écrirait sur le disque pendant le jeu, pour toujours, pour répondre à une question que personne n'a posée.

- `-Xlog:gc:file=…` est ajouté à la ligne de commande, et **jamais sur Java 8** : la journalisation unifiée n'existe pas avant Java 9, et le drapeau empêcherait la JVM de démarrer. « Mesurer ce lancement » deviendrait « casser ce lancement ».
- Prendre la demande **efface le journal précédent**, sinon un lancement serait crédité des collectes du lancement d'avant.
- Seules les lignes portant à la fois une transition de tas et une durée sont comptées comme pauses : le journal contient aussi des démarrages, des phases concurrentes et des en-têtes.
- Les chiffres de tas viennent de l'**après**-collecte (`620M->480M` : c'est 480 qui compte).

> Tests : `java_8_is_never_given_a_flag_that_would_stop_it_starting`, `taking_a_request_clears_the_previous_log`, `only_real_pauses_are_counted`, `the_heap_figures_come_from_after_the_collection`

## Avant / après

Vingt lancements gardés par instance. La comparaison se fait contre **le dernier lancement qui a mesuré les mêmes choses**, pas simplement contre le précédent : comparer un lancement mesuré à un lancement non mesuré produit une page d'« inconnu ».

Un écart de moins de **10 %** est rapporté comme *sans changement*. Deux lancements d'une configuration identique ne tombent jamais exactement d'accord, et appeler 3 % une amélioration ferait passer chaque modification pour un succès.

> Tests : `run_to_run_noise_is_not_reported_as_a_result`, `the_baseline_is_the_last_run_that_measured_the_same_things`, `a_regression_is_not_dressed_up`

## Ce qui est applicable

Seuls les réglages : RAM min, RAM max, retour au Java déclaré. **Installer ou retirer un mod passe par l'onglet Mods** — les flux qui demandent confirmation et enregistrent l'origine du fichier ([[Provenance du contenu]]). Un mod est du contenu, pas un réglage.

Changer une borne mémoire **relit le fichier de réglages d'abord** : il est écrit en entier, donc un changement de tas effacerait sinon un chemin Java personnalisé.

## Déjà existant, à ne pas confondre

`tune_profile_memory` **adapte déjà** la RAM à la machine réelle (`get_performance_profiles`). Ce que l'advisor ajoute est la **mesure** et le diagnostic, pas l'adaptation.

## Liens

[[Crash Doctor]] · [[Moteur de rendu in-game]] · [[Provenance du contenu]] · [[Architecture]] · [[Tests et qualité]]
