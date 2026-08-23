# Moteur de rendu in-game

Le menu Kiza dessiné **dans Minecraft**, pas dans le launcher.

## Où

`kiza-base-mod/src/common/java/fr/kiza/basemod/`

| Classe | Rôle |
|---|---|
| `MenuLogoRenderer` | point d'entrée du rendu, logo, footer, orchestration |
| `TitleMenuController` | reskin des boutons vanilla |
| `render/GuiDispatch` | **les trois générations de dessin** |
| `render/KizaCanvas` | Java2D → texture Minecraft |
| `render/KizaText` | texte TrueType antialiasé |
| `render/KizaPanel` | boutons arrondis antialiasés |
| `render/KizaIcon`, `SvgPath`, `LucideIcons` | icônes vectorielles — **sans appelant depuis le retrait des icônes** |

## Le principe

Minecraft dessine du texte bitmap et des rectangles nets. Pour un rendu net, on rasterise en **Java2D** hors écran (antialiasing, TTF, chemins vectoriels), puis on transforme l'image en texture GUI.

Tout passe par la **réflexion**, avec repli sur le rendu vanilla si une étape manque. Un seul jar couvre donc plusieurs versions et plusieurs mappings.

## Les trois générations

`GuiDispatch` résout dans cet ordre, et s'arrête au premier qui marche :

| Mode | Versions | Objet reçu | Dessin |
|---|---|---|---|
| `MODERN` | 1.20+ | `GuiGraphics` | méthodes portées par l'objet |
| `POSE_STACK` | 1.17 → 1.19 | `PoseStack` | helpers de `GuiComponent`, pile en 1er argument |
| `IMMEDIATE` | 1.7 → 1.12 | l'écran lui-même | `Gui.drawRect`, `drawScaledCustomSizeModalRect` |

En mode immédiat, les noms de méthodes sont en **SRG** en production — tout est donc reconnu **par signature**, jamais par nom.

Avant 1.20 le blit dessine la texture **actuellement liée**, pas celle qu'on lui passe : il faut lier d'abord (`RenderSystem` en 1.17-1.19, `TextureManager` avant 1.13). Sans ça chaque texture sortirait à la place de la précédente.

## Textures : la surprise

Avant 1.13 il n'y a pas de `NativeImage`, mais `DynamicTexture` prend un `BufferedImage` **directement** — exactement ce que Java2D produit. Le pipeline est donc **plus court** sur les vieilles versions que sur les récentes.

`KizaCanvas.newTexture()` essaie d'abord ce chemin, puis retombe sur `NativeImage` + `NativeImageBackedTexture`.

## Choix de rendu actuels

- **Pas d'icônes** dans les boutons — retirées à la demande
- Texte **centré sur les deux axes**, avec la largeur réelle via `MenuLogoRenderer.textWidth()`, pas une estimation par nombre de caractères
- Le reskin s'applique à **tous** les écrans ; seul l'écran-titre a le voile et le logo au-dessus des boutons
- Le logo et la mention légale ne sont dessinés que sur les écrans **titre et pause** — ailleurs ils recouvraient les boutons Apply/Undo d'Iris et Sodium
- Ligne « Kiza Client » ajoutée au **F3** (mixin côté Fabric, événement de texte de debug côté Forge)

## Stubs de compilation

`kiza-base-mod/src/stubs/` contient de faux `net.minecraft.*`, `org.spongepowered.*`, `com.mojang.*` pour compiler sans les vraies dépendances. `build.mjs` les **supprime du jar** (`rm classesDir/net|org|com`) — vérifié : aucun stub n'est embarqué.

Lié : [[Compatibilité des versions]], [[Architecture]].
