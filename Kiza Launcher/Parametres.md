# Paramètres

Onze pages, une par question qu'on peut se poser. Chaque contrôle est branché sur quelque chose de réel — la règle qui a décidé de tout le reste.

## Les pages

| Page | Ce qu'elle règle |
|---|---|
| Général | démarrage, fenêtre, lancement du jeu, Discord, mises à jour |
| Apparence | thème, densité, taille du texte, arrondi, effets |
| Langue et région | langue du launcher, format de date et d'heure |
| Minecraft et Java | catalogue de versions, environnements Java, profils de performance |
| Téléchargements | nombre de fichiers simultanés |
| Stockage | ce que Kiza occupe, ce qui peut être vidé |
| Comptes | comptes Microsoft et profils hors ligne |
| Connexions | état réel des API |
| Notifications | ce que Kiza a le droit d'envoyer à Windows |
| Avancé | diagnostic, journaux, réinitialisation |
| À propos | version, mises à jour, liens |

## La règle

**Un interrupteur qui ne gouverne rien est une promesse que le launcher rompt en silence.** C'est pour ça que Notifications n'a que trois cases : ce sont les trois notifications que le launcher envoie réellement.

Les réglages écrivent directement dans le fichier. Pas de bouton Enregistrer — une page qui peut rester dans un état non enregistré est une page qui jette du travail sans le dire.

## Ce qui a demandé du vrai travail

**Le format de date.** Il aurait été facile de dessiner deux menus décoratifs. `src/lib/datetime.ts` est lu par `useRegionFormats` partout où le launcher écrit un moment — World Vault, Découvrir. Les ordres explicites sont assemblés à la main plutôt qu'empruntés à une autre locale : demander `en-GB` pour avoir le jour avant le mois ramènerait aussi les noms de mois anglais.

Piège attrapé au test : minuit et midi valent **12**, pas 0. Sans ça, un monde s'affiche « joué à 0:15 AM ».

**Le nombre de téléchargements simultanés.** Le sémaphore était figé à 3. Augmenter prend effet immédiatement ; **baisser ne peut reprendre que les créneaux libres**, les autres reviennent quand les téléchargements en cours finissent. Le worker réconcilie donc à chaque passage plutôt que de croire qu'un seul appel a suffi. C'est écrit sur la page, parce que l'alternative est un utilisateur qui voit le chiffre changer et rien se passer.

**Le stockage.** Chaque chiffre vient de `storage_report.rs`, qui parcourt les dossiers. Instances, mondes et sauvegardes sont affichés mais **jamais** proposés à la suppression : ce sont les seules choses ici qui ne se retéléchargent pas. La liste de ce qui est effaçable est décidée en Rust, pas par l'interface — `reclaim()` ignore tout identifiant non marqué effaçable, quoi qu'on lui demande.

## Ce que j'ai refusé de dessiner

Un panneau « 4/4 services opérationnels » inventé de toutes pièces. Une limite de débit — elle s'appliquerait par fichier, donc trois téléchargements la dépasseraient au triple. Une case « vérifier les fichiers » : la vérification ne se désactive pas, et un interrupteur toujours activé n'est pas un réglage.

## Vérification

`scripts/ui-preview-screenshot.mjs` ouvre les onze pages, refuse toute page qui rend moins de 40 caractères, et enregistre `output/playwright/ui-settings-*.png`.

## Liens

[[Kiza Launcher]] · [[Interface 0.0.301]] · [[Tests et qualité]] · [[Mises a jour du launcher]]
