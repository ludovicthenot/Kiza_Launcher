# Service de mise à jour

Cloudflare R2 pour stocker les versions, un Worker pour les servir. Le launcher demande au Worker, et retombe sur GitHub si Cloudflare ne répond pas.

Source : `KizaaModEngine-Tauri/cloudflare/`

## Ce que le launcher demande

```
1. https://<worker>/v1/latest/{{target}}/{{arch}}/{{current_version}}
2. https://github.com/.../releases/latest/download/latest.json     ← secours
```

Tauri s'arrête au **premier qui répond**. C'est pour ça que le secours doit être en dernier : listé en premier, ce n'est plus un secours, c'est la seule source que quiconque lira jamais. `verify-release-config.js` refuse un ordre inversé.

## Pourquoi un Worker et pas un bucket public

Les adresses `r2.dev` sont limitées en débit et Cloudflare dit explicitement de ne pas construire dessus.

Mais la vraie raison est ailleurs : **le manifeste stocké dans R2 ne contient pas d'URL**. Il nomme un `file`, et le Worker le transforme en adresse complète au moment de la requête.

```json
// dans R2                          // ce que le launcher reçoit
{ "file": "Kiza...exe" }     →      { "url": "https://<worker>/v1/download/..." }
```

Conséquence : **changer de nom de domaine un jour ne demandera pas de republier une seule version passée.** C'est la décision de conception qui compte le plus dans ce dossier.

## Les canaux

`stable/` et `beta/` dans le même bucket. Le launcher dit lequel il suit avec l'en-tête `X-Kiza-Channel`, envoyé depuis `updater.ts` et lu à chaque vérification.

En-tête et non URL, parce que **l'URL est compilée dans le binaire et le canal est un réglage**. Un launcher construit en janvier doit pouvoir passer en bêta ce soir sans être reconstruit.

Un canal inconnu retombe sur `stable`. Un canal vide répond **204**, que l'updater lit comme « rien de neuf » — pas comme une erreur.

## Publier

```bash
npm run build:installer      # construit et signe
npm run release:publish      # envoie vers R2
```

L'ordre dans `publish-release.mjs` n'est pas négociable : **l'installateur d'abord, le manifeste ensuite**. L'inverse ouvre une fenêtre — quelques secondes, mais réelle — où tous les launchers du monde apprennent qu'une version existe puis reçoivent un 404 en allant la chercher.

Le script refuse aussi de publier si la signature a été faite pour un autre nom de fichier que l'installateur présent. Sinon l'échec surgirait sur la machine d'un utilisateur.

⚠️ `wrangler r2 object put` écrit dans une **simulation locale** par défaut et annonce un succès. Le `--remote` dans le script est ce qui le rend réel.

## Publier depuis GitHub Actions

Le workflow publie **Cloudflare d'abord, GitHub ensuite**. L'ordre n'est pas cosmétique : Tauri s'arrête au premier endpoint qui répond, donc publier le secours en laissant R2 en arrière mettrait le secours *devant* le primaire — et jamais atteint. Personne ne verrait la version.

Secret requis : **`CLOUDFLARE_API_TOKEN`**, avec la permission *R2 Storage : Edit*. Le workflow refuse de démarrer sans lui plutôt que de publier à moitié.

Le jeton se crée sur `dash.cloudflare.com` → *Manage Account* → *API Tokens* → *Create Token* → *Custom token*, avec la seule permission `Workers R2 Storage: Edit`.

L'identifiant de compte est écrit dans `wrangler.jsonc` : ce n'est pas un secret — il est dans l'URL de chaque page du dashboard — et le fixer empêche une machine de build ayant accès à plusieurs comptes de déployer dans le mauvais.

## Ce que le Worker refuse

Vérifié par `npm run cloudflare:verify`, qui lance le Worker contre un R2 simulé et sonde onze cas. La moitié qui compte est celle des refus : un service qui sert le bon fichier se voit du premier coup, un service qui sert *aussi* le mauvais ne se voit pas.

- sortir du canal (`../`, encodé ou non), clé imbriquée, canal inventé → 404
- toute méthode autre que GET → 405
- un défaut attrapé au test : un téléchargement complet répondait **206 Partial Content**. R2 renvoie un objet `range` même sans en-tête `Range`. Seule la requête peut dire si la réponse est partielle.

## Sécurité

Le Worker **ne détient aucun secret**. La signature qui protège une mise à jour est faite sur la machine de release avec une clé qui n'en sort jamais, et vérifiée par le launcher contre une clé publique compilée dans le binaire.

Un Worker qui servirait un fichier trafiqué ne pourrait pas le faire installer.

## Mettre en place

Une seule commande demande des mains humaines — elle ouvre un navigateur :

```bash
cd KizaaModEngine-Tauri/cloudflare
npx wrangler login
```

Ensuite, depuis `KizaaModEngine-Tauri` :

```bash
npm run cloudflare:deploy
```

Crée le bucket, déploie le Worker, lit l'adresse obtenue et l'écrit dans `tauri.conf.json`. Réexécutable sans dommage.

## Passer à un vrai domaine plus tard

1. Ajouter le domaine à Cloudflare
2. Dans le dashboard du Worker : Settings → Domains & Routes → ajouter le domaine personnalisé
3. `npm run cloudflare:deploy -- --endpoint https://updates.votredomaine`
4. Reconstruire

Les versions déjà publiées n'ont pas besoin d'être retouchées — c'est exactement ce que le `file` plutôt que `url` achète.

**Garder l'ancienne adresse workers.dev vivante** : les installations construites avec elle ne connaîtront jamais la nouvelle.

## Liens

[[Kiza Launcher]] · [[Kiza Setup]] · [[Build et release]] · [[Mises a jour du launcher]]
