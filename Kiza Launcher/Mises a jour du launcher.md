# Mises à jour du launcher

Comment Kiza apprend qu'une nouvelle version existe. `src/lib/updater.ts`, 9 tests.

## Deux moments

**Au démarrage**, une fois. **Puis toutes les cinq minutes** tant que le launcher est ouvert (`BACKGROUND_CHECK_INTERVAL_MS`).

Une release est un petit fichier JSON signé, donc la vérification ne coûte presque rien — et c'est ce qui fait qu'un launcher laissé ouvert toute la soirée apprend qu'une version est sortie pendant qu'il tournait.

## La vérification récurrente reste à sa place

Elle n'interrompt **rien** de ce que fait l'utilisateur :

- Jamais pendant une vérification, un téléchargement ou une installation en cours.
- **Jamais une fois qu'une mise à jour a été trouvée.** Refaire la vérification remplacerait une mise à jour déjà téléchargée et prête à installer — c'est-à-dire jeter ce téléchargement.

> Test : `does_not_re_check_once_an_update_is_downloaded_and_waiting`

## Elle est muette sur l'échec

Une vérification qui échoue parce que la machine est hors ligne une minute n'est pas une nouvelle, et faire rougir le panneau toutes les cinq minutes en serait une.

Une vérification **demandée par l'utilisateur**, elle, rapporte son échec : c'est une question qui mérite une réponse.

> Tests : `stays_quiet_when_a_background_check_fails`, `still_reports_a_failure_the_user_asked_for`

## Une version n'est annoncée qu'une fois

`takeAnnouncement()` ne rend une version que la première fois. Une notification toutes les cinq minutes pour la même release est une nuisance, pas une notification.

> Test : `announces_a_version_once_however_many_times_it_is_checked`

## L'installation reste un choix

Le téléchargement et l'installation sont deux étapes distinctes, et l'installation ne part jamais toute seule (`downloadAndInstall` n'est **pas** utilisé).

## Liens

[[Build et release]] · [[Fermeture vers la zone de notification]] · [[Tests et qualité]]
