# Mode sans échec

Trouver le mod qui casse le jeu, par moitiés. `src-tauri/src/safe_mode.rs`, 8 tests.

## Par dichotomie, pas un par un

Avec 64 mods, tester un par un demande jusqu'à 64 lancements. Par moitiés : 6.

> Test : `halving_beats_one_at_a_time`

## Deux lancements de référence avant de chercher

L'ordre compte, et il vient d'un bug attrapé par un test :

1. **Aucun mod.** Si le jeu crashe quand même, ce n'est pas un mod. Accuser un mod ici serait faux.
2. **Tous les mods.** Il faut **reproduire** le crash avant de le chercher. Sans cette étape, une chasse lancée sur un jeu qui ne crashe pas rétrécit jusqu'au dernier mod restant et l'accuse.

> Tests : `a_game_that_crashes_without_mods_is_not_blamed_on_a_mod`, `an_instance_that_never_crashes_reports_no_culprit`, `a_single_mod_is_accused_only_after_it_actually_crashed`

Seuls les mods **activés** sont suspects : quelque chose déjà désactivé ne peut pas être ce qui crashe.

## La session survit à la fermeture

Elle est écrite dans `safe-mode.json` à côté de l'instance. Fermer le launcher entre deux lancements de test ne perd pas la chasse.

## Le verdict

`crashed` est normalement décidé par le [[Crash Doctor]] plutôt que par l'utilisateur, pour qu'une chasse ne dépende pas de quelqu'un qui interprète correctement un journal. L'interface propose aussi les deux boutons manuels.

Arrêter la chasse **réactive tous les mods**.

## Liens

[[Crash Doctor]] · [[Points de restauration]] · [[Tests et qualité]]
