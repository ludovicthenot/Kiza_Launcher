# Crash Doctor

Nomme la cause d'un crash, cite la ligne qui le prouve, propose une action.

## Où

- Moteur : `src-tauri/src/crash_doctor.rs`
- Commande : `diagnose_instance_crash(instance_id)` dans `src-tauri/src/lib.rs`
- Hook : `useCrashDiagnosis` dans `src/lib/queries.ts`
- Panneau : `src/components/instance/CrashDoctorPanel.tsx`
- Monté dans : `src/components/instance/LaunchStatusBanner.tsx` (branche `isCrashed`)

## Sources lues

`collect_crash_sources(game_dir)` concatène trois choses — un crash n'en laisse pas toujours trace au même endroit :

1. `logs/latest.log`
2. le fichier le plus récent de `crash-reports/*.txt`
3. le plus récent `hs_err_pid*.log` à la racine du dossier de jeu (mort au niveau natif)

Seuls les **2 derniers Mo** sont analysés : le crash est à la fin, et un log peut peser des dizaines de Mo.

## Détecteurs

Ordre d'exécution dans `analyse()` — du plus spécifique au plus général. Un seul résultat par catégorie.

| Détecteur | Reconnaît | Action proposée |
|---|---|---|
| `detect_wrong_java` | `UnsupportedClassVersionError`, « class file version N » | `UseJava(n)` |
| `detect_module_conflict` | `java.lang.module.ResolutionException` | `Repair` — **jamais** désactiver un mod |
| `detect_missing_dependency` | `Missing language javafml version`, `Mod resolution failed` | `DisableMod(jar)` |
| `detect_mixin_conflict` | `InvalidInjectionException`, `Mixin apply failed` | `SafeMode` |
| `detect_out_of_memory` | `java.lang.OutOfMemoryError` | `IncreaseMemory` |
| `detect_graphics` | `nvoglv`, `atio6ax`, `ig9icd`, `Failed to initialize GLFW` | `UpdateGraphicsDriver` |

`java_release_for_class_version(major)` : classe 52 → Java 8, et +1 par version. 61 → Java 17.

`jar_in(line)` extrait un `nom.jar` d'une ligne, c'est ce qui permet de nommer le mod fautif.

## Actions

Rendues en bouton **uniquement** si le launcher sait les exécuter — décidé par `runnable(action)` dans le panneau.

| Action | Cliquable ? | Ce qu'elle fait |
|---|---|---|
| `Repair` | toujours | `useStartMinecraftInstall` |
| `DisableMod(jar)` | **si le mod est au catalogue** | `useToggleMod` sur le mod possédant ce jar |
| `UseJava(n)` | oui | ouvre l'onglet réglages de l'instance |
| `IncreaseMemory` | oui | idem |
| `SafeMode` | non | le mode sans échec n'existe pas encore |
| `UpdateGraphicsDriver` | non | hors du launcher |

`modOwning(jarName)` relie le nom de jar du log à un mod du catalogue via son champ `files`. Un jar déposé à la main n'y figure pas : le conseil reste alors du texte, jamais un bouton qui échouerait.

Raison : un bouton qui ne fait rien est un mensonge. Cf. le bouton « Close this page » de la page de connexion, qui appelait `window.close()` sur une fenêtre que le script n'avait pas ouverte.

## Règle non négociable

Un lancement propre produit **zéro** diagnostic. Test : `says_nothing_rather_than_guessing`.

## Tests (11)

Tous construits sur des crashs réellement produits par ce launcher, pas sur des exemples inventés. Voir [[Tests et qualité]].

Lié : [[Compatibilité des versions]] pour le contexte des crashs 1.17.
