# Compatibilité des versions

La note à lire avant de promettre quoi que ce soit à un utilisateur. Tout ici a été **vérifié**, pas supposé.

## Ce que chaque instance reçoit

| Instance | Menu Kiza complet | Logo + mention | Pack de branding |
|---|---|---|---|
| Fabric / Forge **1.20+** et 26.x | oui | oui | oui |
| Fabric / Forge **1.17 → 1.19** | le mod se charge, **rien ne s'affiche** | non | oui |
| Forge **1.7 → 1.12** | non | oui | oui |
| **1.13 → 1.16** | rien du tout | non | oui |
| **Vanilla**, toutes versions | non | non | oui |

Le pack de branding est le seul élément universel — voir [[Pack de branding KizaClient]].

## Pourquoi 1.17-1.19 ne dessine rien

Voir [[Moteur de rendu in-game#Les trois générations]]. Le mixin s'injecte correctement, mais l'objet qu'il reçoit est un `PoseStack`, pas un `GuiGraphics`. Les méthodes de dessin cherchées n'existent pas dessus, chaque appel échoue en silence.

`GuiDispatch` a un mode pour cette génération, mais côté **Forge** il manque encore le bon nom d'accesseur d'événement pour la 1.17. Modification proposée puis refusée : ajouter `getMatrixStack` comme troisième candidat dans `graphicsFromEvent`.

## Pourquoi 1.13-1.16 ne reçoit rien

C'est le trou entre deux formats de manifeste :

- `mcmod.info` s'arrête à 1.12
- `mods.toml` commence à 1.13, mais le jar qui l'accompagne est en **Java 16**, or 1.16.5 et en dessous tournent en **Java 8**

Combler ce trou demande un quatrième jar : Java 8 **avec** `mods.toml`. Peu de travail maintenant que la variante Java 8 existe.

## Le mur Java, et ce qu'il est vraiment

Minecraft ≤ 1.16 est lancé en Java 8 parce que **c'est ce que Mojang déclare** dans son manifeste, et que le launcher suit cette déclaration.

Ce n'est pas une loi physique. LabyMod fait tourner **1.8.9 jusqu'à 1.21.11 sur Java 21**. Y arriver demanderait de remplacer LWJGL 2 par LWJGL 3 et de patcher le jeu au démarrage — voir [[Feuille de route 0.0.300#Route longue non retenue]].

## Le piège Java 16

**Minecraft 1.17.x déclare Java 16**, pas 17. Et Adoptium ne publie plus de JRE Temurin 16 pour Windows x64 — l'API répond `200` avec un tableau **vide**.

Conséquence : avant correction, aucune instance 1.17.x ne pouvait démarrer, ni en automatique (Java 16 introuvable) ni en forçant Java 17 (refusé par le backend).

Corrigé par `provisionable_java_major` : la version déclarée est ramenée **vers le haut** au runtime le plus proche qu'on sait installer. 16 devient 17, jamais l'inverse — une JVM ancienne ne peut pas charger des classes récentes, le contraire fonctionne.

## Forge et les versions qui n'existent pas

Forge n'a **jamais** publié de build pour `1.17` tout court : 0 build pour `1.17`, 114 pour `1.17.1`. Vérifié sur leur dépôt Maven. Un utilisateur qui choisit 1.17 verra une liste de loaders vide, et c'est correct.

## Le piège du classpath Forge 1.17

Le profil Forge 1.17.1 finit ses arguments JVM par :

```
-DignoreList=...,forge-,${version_name}.jar
```

Forge compare cette liste aux **noms de fichiers** du classpath. Le jar vanilla s'appelle `1.17.1.jar` ; substituer `${version_name}` par l'identifiant du profil (`1.17.1-forge-37.1.1`) ne correspond à rien, donc rien n'est ignoré, et le jar part une seconde fois sur le module path → `ResolutionException` avant même la fenêtre.

Corrigé par `module_path_version_name`, qui utilise le nom réel du jar client. Les profils Forge plus récents n'ont pas d'`ignoreList` du tout, donc aucun risque de régression.

Lié : [[Crash Doctor]] reconnaît ce crash et l'attribue au launcher, jamais aux mods.
