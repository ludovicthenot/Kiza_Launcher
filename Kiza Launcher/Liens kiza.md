# Liens kiza://

`kiza://join/<adresse>` ouvre le launcher sur un serveur. `src-tauri/src/server_hub.rs`, 2 tests.

## Un lien est une suggestion, jamais un ordre

**N'importe quelle page web peut envoyer un de ces liens au launcher.** Donc il ne rejoint jamais rien tout seul : l'adresse est validée, la fenêtre est ramenée au premier plan, et la liste des serveurs s'ouvre avec l'adresse préremplie. C'est le joueur qui clique.

Démarrer une partie parce qu'une page l'a demandé est exactement ce que cette conception évite.

## Refusé à la porte

`parse_join_link` valide avant que quoi que ce soit ne soit stocké ou pingué :

- schéma `kiza://` et action `join` uniquement — `kiza://delete-everything/now` est rejeté avec le nom de l'action ;
- la chaîne de requête et le fragment ne font pas partie d'une adresse : `.../play.example.net/?ref=twitter#top` donne `play.example.net`, sinon on pinguerait autre chose que ce que le lien nomme ;
- les caractères de contrôle et les espaces sont refusés — un saut de ligne encodé (`%0A`) couperait une ligne dans tout ce qui journalise l'adresse ensuite ;
- l'adresse doit se découper en hôte et port.

> Tests : `a_join_link_yields_the_address_it_names`, `a_hostile_or_broken_link_is_refused_at_the_door`

## L'enregistrement du protocole n'existait pas

Découverte en faisant ce travail : le code qui traite les liens `nxm://` existait depuis longtemps, mais **aucun schéma n'était déclaré**. Windows ne pouvait donc jamais envoyer un lien au launcher, et ce code n'avait jamais pu s'exécuter.

`tauri-plugin-deep-link` déclare maintenant `kiza` et `nxm` ; l'installeur NSIS écrit les clés de registre, et une build de développement les demande au démarrage.

Un lien peut aussi arriver **en argument au tout premier lancement**, avant qu'une fenêtre existe pour recevoir l'événement — ce cas est traité séparément.

## Liens

[[Server Hub]] · [[Architecture]]
