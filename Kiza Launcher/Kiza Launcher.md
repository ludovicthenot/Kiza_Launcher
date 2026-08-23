# Kiza Launcher

Launcher Minecraft façon Lunar Client : instances isolées, mods gérés, et un client Kiza rendu **dans le jeu**.

Dépôt : `C:\Users\nefer\Desktop\Projet\Kiza Mods\KizaaModEngine-Tauri`
Setups livrés : `C:\Users\nefer\Desktop\Projet\Kiza Mods\releases\<version>\`

## Par où commencer

- [[Cerveau du projet]] — le point d'entrée Obsidian qui relie décisions, systèmes et graphe du code
- [[Architecture]] — comment les trois morceaux tiennent ensemble
- [[Compatibilité des versions]] — **la note la plus importante** : ce qui marche sur quelle version, et pourquoi
- [[Feuille de route 0.0.300]] — ce qui est fait, ce qui reste

## Les systèmes

| Système | Rôle |
|---|---|
| [[Crash Doctor]] | nomme la cause d'un crash au lieu de dire « une erreur » |
| [[Update Center]] | détecte et applique les mises à jour de contenu |
| [[Provenance du contenu]] | sait d'où vient chaque fichier installé |
| [[Points de restauration]] | annule une modification risquée |
| [[Verrou d'instance]] | une seule opération à la fois par instance |
| [[Téléchargements reprenables]] | reprise HTTP à l'octet près |
| [[Profils hors ligne]] | jouer sans compte Microsoft |
| [[Moteur de rendu in-game]] | le menu Kiza dessiné dans Minecraft |
| [[Pack de branding KizaClient]] | la marque Kiza côté vanilla |
| [[Import et export d'instance]] | partager une instance |
| [[Kiza Lockfile]] | décrire une instance sans ses octets, pour la reconstruire ailleurs |
| [[World Vault]] | sauvegardes différentielles des mondes |
| [[Kiza Setup]] | l'installateur maison, à la place de l'assistant NSIS |
| [[Parametres]] | les onze pages de réglages, et ce qui est branché derrière |
| [[Service de mise a jour]] | Cloudflare R2 et le Worker qui sert les versions |
| [[Lecteur NBT]] | lire le vrai nom d'un monde dans `level.dat` |
| [[Performance Advisor]] | pourquoi une instance rame, sans jamais inventer de FPS |
| [[Mode sans echec]] | trouver le mod qui casse le jeu par dichotomie |
| [[Server Hub]] | serveurs favoris, état en direct, lancement de la bonne instance |
| [[Liens kiza]] | `kiza://join/...` — une suggestion, jamais un ordre |
| [[Interface 0.0.301]] | accueil, onglet Mods et Découvrir refaits |

## Opérations

- [[Build et release]] — produire un setup
- [[Mises a jour du launcher]] — vérification au démarrage puis toutes les 5 minutes
- [[Fermeture vers la zone de notification]] — la croix ne quitte pas le launcher
- [[Tests et qualité]] — les garde-fous

## Principes tenus dans ce projet

**Ne jamais inventer.** Le [[Crash Doctor]] se tait sur un lancement propre. L'[[Update Center]] ne propose rien pour un fichier dont il ignore l'origine. Un diagnostic faux est pire que pas de diagnostic.

**Un bouton n'existe que s'il fait quelque chose.** Cf. [[Crash Doctor#Actions]] : seules les actions réellement exécutables sont cliquables, les autres sont du texte.

**Mesurer, pas deviner.** Le [[Performance Advisor]] n'annonce jamais un nombre de FPS : le launcher est hors du jeu et ne voit pas les images. Il rapporte ce qu'il observe réellement, et se tait quand tout va bien.

**Dire ce qu'on ne peut pas faire.** Un [[Kiza Lockfile]] nomme les fichiers que personne d'autre ne pourra récupérer, avant l'export. Un [[World Vault|checkpoint de monde]] est refusé pendant que le jeu écrit, avec la raison.

**Le test encode la raison, pas juste le résultat.** Chaque test important dit *pourquoi* la règle existe — voir [[Tests et qualité]].
