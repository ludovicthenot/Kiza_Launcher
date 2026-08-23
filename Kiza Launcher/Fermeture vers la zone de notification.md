# Fermeture vers la zone de notification

Fermer la fenêtre ne quitte pas le launcher. `src-tauri/src/lib.rs`, gestionnaire `on_window_event`.

## Pourquoi

Quitter sur la croix abandonnerait ce qui est en cours : un téléchargement, une partie qui tourne, une mise à jour en train de s'installer. **La fenêtre qui se ferme et le launcher qui s'arrête sont délibérément deux choses différentes.**

## Ce qui se passe

`CloseRequested` sur la fenêtre `main` → `api.prevent_close()`, la fenêtre est cachée, et une **notification Windows** explique où elle est passée.

La fenêtre `console` n'est pas concernée : c'est une visionneuse de journaux, et la fermer veut dire la fermer.

## La notification, une fois par session

Pas une fois par installation. Quelqu'un qui ferme la fenêtre tous les jours ne doit pas être prévenu tous les jours ; quelqu'un qui démarre Kiza et le ferme ne doit jamais se demander s'il a quitté.

Implémentation : un `AtomicBool` statique, remis à zéro à chaque démarrage du processus.

## Le retour

L'entrée **Open Kiza Launcher** est la **première** du menu de la zone de notification, avant *Quit*. Une fois que fermer cache la fenêtre, ce menu est le chemin du retour : il ne doit pas être à un clic de distance de *Quitter*.

Un clic gauche sur l'icône rouvre aussi la fenêtre.

## Désactivable

Réglage `close_to_tray`, activé par défaut, dans **Paramètres → Système**. À distinguer de `close_to_tray_on_launch`, qui cache la fenêtre pendant qu'une partie tourne — deux réglages, deux moments.

## Dépendance

`tauri-plugin-notification` 2. La notification est émise **depuis Rust**, donc elle ne demande aucune permission côté interface.

## Liens

[[Mises a jour du launcher]] · [[Architecture]]
