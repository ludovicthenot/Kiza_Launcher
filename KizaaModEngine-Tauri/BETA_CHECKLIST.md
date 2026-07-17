# KizaaMod Engine - Beta Readiness Checklist

> **Phase:** Stabilization & Reliability
> **Objective:** Transition from "Feature Complete" to "Production Ready"
> **Rule:** NO NEW FEATURES until all critical items are checked.

## 1. The "Happy Path" (Parcours Principal)
*Le chemin critique qu'un utilisateur suit 80% du temps. Doit être sans friction.*

1.  [x] **Onboarding / Premier Lancement**
    *   Lancement de l'exe (Splash/Loading).
    *   Arrivée sur une Library vide (Empty State clair).
    *   Action évidente : "Add Game Instance".
2.  [x] **Ajout d'une Instance**
    *   Sélection dossier jeu (ex: Cyberpunk 2077).
    *   Détection automatique (Version/Nom).
    *   Feedback immédiat (Card créée).
3.  [x] **Gestion des Mods**
    *   Entrée dans l'instance.
    *   Import d'un mod (ZIP/7z).
    *   Apparition dans la liste (Nom, Version).
    *   Activation (Toggle ON).
4.  [x] **Déploiement**
    *   Clic sur "Deploy".
    *   Loader visible.
    *   Notification de succès ("X files deployed").
    *   Vérification physique : Les liens symboliques sont bien dans le dossier du jeu.
5.  [x] **Profils**
    *   Création d'un profil "Test".
    *   Switch entre "Default" et "Test".
    *   Vérification que les mods activés changent bien.
6.  [x] **Settings**
    *   Saisie API Key Nexus.
    *   Sauvegarde -> Feedback succès.
    *   Persistance après redémarrage app.

---

## 2. Reliability & Resilience (Crash Test)
*Comment l'app réagit quand ça se passe mal.*

### Backend / File System
- [x] **Config Corrompue :** Si `app_settings.json` ou `mods.json` contient du JSON invalide. L'app crash-t-elle ou réinitialise-t-elle ? -> *Validé par test auto: reset par défaut.*
- [x] **Dossier Jeu Déplacé :** L'utilisateur déplace le jeu. L'instance doit passer en statut "Invalid/Missing" sans crasher l'app. -> *Validé par code review.*
- [x] **Fichier Mod Manquant :** Un fichier source dans `staging` est supprimé manuellement. Le déploiement doit échouer proprement ou ignorer le fichier avec un warning. -> *Validé.*
- [x] **Droits d'écriture :** Lancer l'app sans droits admin dans un dossier protégé (Program Files). Message d'erreur clair ? -> *Validé (erreurs mappées dans frontend).*

### Frontend / API
- [x] **API Key Invalide :** Feedback si la clé est rejetée (Future feature, pour l'instant : format valide ?). -> *SettingsView gère le format basique.*
- [x] **Timeouts :** Si une opération (Scan/Deploy) prend trop de temps. -> *React Query gère le timeout.*
- [x] **Spam Click :** Clic frénétique sur "Deploy". Le bouton doit être disabled pendant le loading. -> *Validé (isPending).*

---

## 3. UI States & UX Polish
*Vérification des 5 états pour chaque écran majeur.*

### Library View
- [x] **Empty :** "Ajoutez votre premier jeu" (Fait).
- [x] **Loading :** Skeleton ou Spinner au lancement.
- [x] **Error :** Si `list_instances` échoue.

### Mods Tab
- [x] **Empty :** "Aucun mod installé. Glissez-déposez ou cliquez pour ajouter."
- [x] **Loading :** Spinner pendant le chargement de la liste.
- [x] **Filtering :** Si la recherche ne donne rien -> "Aucun résultat pour 'xyz'".
- [x] **Actions :** Feedback visuel immédiat lors du Delete/Toggle.

### Instance Header
- [x] **Status Badge :** Est-ce que "Invalid" est rouge et explicite ?
- [x] **Breadcrumb :** Sait-on toujours sur quel jeu on est ?

---

## 4. Technical Debt & Cleanup
- [x] **Logs :** Les `console.error` sont-ils propres ? Le backend log-t-il les erreurs critiques ? -> *Ajout des préfixes [ERROR] [ModManager].*
- [x] **Unused Code :** Nettoyer les imports inutilisés (Rust & TS).
- [ ] **Typage :** Vérifier les `any` restants en TypeScript.
- [ ] **Performance :** Vérifier la fluidité avec 100 mods (mock).
