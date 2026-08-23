# Tests et qualité

## Les commandes

```bash
cd "C:\Users\nefer\Desktop\Projet\Kiza Mods\KizaaModEngine-Tauri"
npm run typecheck                 # tsc --noEmit
npm run test                      # vitest, 59 tests
node kiza-base-mod/build.mjs --test   # les 3 jars + tests Java
cd src-tauri
cargo test --lib                  # 211 tests
cargo clippy --all-targets -- -D warnings
cargo fmt --check
```

## Compte actuel

- **211** tests Rust (7 ignorés — lancements réels manuels)
- **59** tests frontend
- tests Java : `StateFilePublisher`, `ForgeMinecraftStateDetector`, `MenuLogoRenderer`, `BorderlessWindowManager`, `FabricMixinVersionSelector`, `SvgPath`, `GuiDispatch`

## Pièges rencontrés

**`cargo fmt --check` dans un pipe.** `cargo fmt --check | tail -2` renvoie le code de sortie de `tail`, donc toujours 0. Il affichait un diff sans que rien ne le signale. Vérifier ainsi :

```bash
cargo fmt --check > /dev/null 2>&1; echo "exit=$?"
```

**Clippy est plus strict que `cargo test`.** `-D warnings` transforme le code mort en erreur : un module non encore appelé ne compile pas. C'est utile — ça force à brancher ce qu'on écrit plutôt que de l'accumuler.

**Un mock de test doit suivre les composants — et ça revient.** `tests/frontend/mods-tab-delete.test.tsx` mocke `src/lib/queries` en entier. **Chaque hook ajouté** à un composant sous `ModsTab` casse ce test tant qu'il n'est pas ajouté au mock. Déjà arrivé deux fois avec le panneau de l'[[Update Center]].

Réflexe : après avoir ajouté un hook à `UpdateCenterPanel` ou `CrashDoctorPanel`, relancer `npm run test` avant toute autre chose.

**Le frontend n'a aucune permission `fs`.** Les capacités (`src-tauri/capabilities/default.json`) n'accordent ni `fs:default` ni `fs:allow-read-text-file`. Lire un fichier choisi par l'utilisateur passe donc par une commande Rust — c'est ce que fait `lockfile_read` pour le [[Kiza Lockfile]], et il en profite pour refuser un fichier invalide **au moment de l'ouverture** plutôt qu'au moment de la reconstruction.

**Clés i18n en double → TS1117.** Arrivé plusieurs fois (`Install`, `Preview`, `Update available`). Vérifier avant d'ajouter une clé.

## Philosophie des tests de ce projet

Un test dit **pourquoi** la règle existe, pas seulement ce qu'elle produit. Exemples :

- `an_older_release_is_never_offered_whatever_the_list_order` — les plateformes ne trient pas pareil
- `a_partial_file_is_appended_to_only_when_the_server_agrees` — un 200 corromprait le fichier
- `says_nothing_rather_than_guessing` — un diagnostic inventé est pire que rien
- `worlds_and_logs_stay_out_of_the_snapshot` — sinon des gigaoctets par changement de mod

Les fixtures du [[Crash Doctor]] sont des crashs **réellement produits** par ce launcher.

## Un test peut encoder un bug

Déjà vu : `iris_is_only_available_for_fabric_instances` affirmait que Forge n'avait pas de moteur de shaders, ce qui était faux (OptiFine). Réécrit en `each_modloader_uses_its_own_shader_engine`.

Modifier une assertion existante est légitime — mais il faut le **dire**.

Lié : [[Build et release]].
