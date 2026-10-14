package fr.kiza.basemod;

import fr.kiza.basemod.window.CustomTitleBar;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

public final class MenuLogoRenderer {
    private static final String NAMESPACE = "kiza_base_mod";
    private static final String TEXTURE_PATH = "textures/gui/kiza_launcher_logo.png";
    private static final String MINECRAFT_LOGO_TEXTURE_PATH =
        "textures/gui/title/minecraft.png";
    private static final String BACKGROUND_TEXTURE_PATH =
        "textures/gui/kiza_menu_background.png";
    private static final int DRAW_WIDTH = 90;
    private static final int DRAW_HEIGHT = 39;
    private static final int COMPACT_DRAW_WIDTH = 64;
    private static final int MARGIN = 8;
    /** Height of one footer line, including its leading. */
    private static final int FOOTER_LINE = 12;
    private static final int TEXTURE_WIDTH = 1400;
    private static final int TEXTURE_HEIGHT = 600;
    /**
     * The menu background's own size, read from the file rather than written
     * here.
     *
     * <p>These were two constants, and they were a trap: the crop that fits the
     * image to the window is arithmetic on them, so replacing the PNG with one
     * of a different size left the maths describing the old file. Nothing
     * failed. The background simply came out cropped wrong, and the only clue
     * was that it looked slightly off.
     *
     * <p>A PNG carries its own dimensions in the first bytes after its
     * signature, so the file is asked. Swapping the image is now a matter of
     * replacing the file with any size and any aspect ratio.
     */
    private static int backgroundWidth;
    private static int backgroundHeight;
    /**
     * Where the Minecraft wordmark lives inside Mojang's own texture, in the
     * logical units a blit divides by — not in pixels, and not the same on
     * every version.
     *
     * <p>From 1.20 the asset is one strip: 1024x256 pixels standing for 256x64
     * units, with the wordmark filling the top 256x44 and nothing below it.
     * Before that it is a 256x256 sheet holding two halves of 155x44, at (0,0)
     * and (0,45), drawn side by side for 310x44 on screen.
     *
     * <p>The renderer used to declare the modern texture as being 256x44 tall.
     * That is the size of the wordmark, not of the texture, so the vertical
     * coordinate ran over all 64 units and squeezed 64 units of image into 44
     * units of box: the wordmark came out at 30 units tall against its full 256
     * of width, an aspect of 8.46 where it should be 5.82, and the whole thing
     * looked stretched. Measured against 1.21.11's own file.
     */
    private static final int LOGO_SHEET_UNITS = 256;
    private static final int MODERN_LOGO_SHEET_HEIGHT = 64;
    private static final int MODERN_LOGO_WIDTH = 256;
    private static final int MODERN_LOGO_HEIGHT = 44;
    private static final int LEGACY_LOGO_SHEET_HEIGHT = 256;
    private static final int LEGACY_LOGO_HALF_WIDTH = 155;
    private static final int LEGACY_LOGO_HEIGHT = 44;
    private static final int LEGACY_LOGO_SECOND_HALF_V = 45;

    private static final int COLOR_TEXT = 0xFFF4F2FA;
    private static final int COLOR_MUTED = 0xFFAAA5BA;
    /** Behind the footer's glyphs. Not quite black, so it reads as depth. */
    private static final int COLOR_TEXT_SHADOW = 0xCC07060C;

    private static final Set<String> TITLE_SCREENS = new HashSet<>(Arrays.asList(
        "net.minecraft.client.gui.screens.TitleScreen",
        "net.minecraft.client.gui.GuiMainMenu",
        "net.minecraft.class_442"
    ));
    private static final Set<String> PAUSE_SCREENS = new HashSet<>(Arrays.asList(
        "net.minecraft.client.gui.screens.PauseScreen",
        "net.minecraft.client.gui.screens.GameMenuScreen",
        "net.minecraft.client.gui.GuiIngameMenu",
        "net.minecraft.class_433"
    ));

    private static Object textureIdentifier;
    private static Object titleTextureIdentifier;
    private static Object backgroundTextureIdentifier;
    private static Method textMethod;
    private static boolean textureUnavailable;
    private static boolean titleTextureUnavailable;
    private static boolean backgroundUnavailable;
    private static boolean fillUnavailable;
    private static boolean textUnavailable;
    /**
     * Screen currently being drawn. Pre-1.20 the draw helpers are inherited by
     * the screen rather than carried by the graphics object, so the primitives
     * need a receiver; every entry point records it before drawing. The GUI is
     * single-threaded, so one field is enough.
     */
    private static Object currentScreen;
    /** Whether the frame being drawn is the Kiza title menu. */
    private static boolean kizaMenu;

    private MenuLogoRenderer() {}

    /**
     * The menu background behind every screen opened outside a world:
     * Options, the world list, the server list.
     *
     * <p>The title screen showed the player's picture and the screen after it
     * went back to Minecraft's panorama, which made the picture feel like a
     * sticker on one page. Drawn after Minecraft's own background and before
     * any widget, blurred a little so the page reads over it, under the veil
     * the player set. In a world, the world stays behind the menus, as
     * Minecraft draws it.
     */
    public static void afterBackground(Object graphics, Object screen) {
        currentScreen = screen;
        if (graphics == null || screen == null || isTitleScreen(screen)) return;
        if (!fr.kiza.basemod.menu.ClientSettings.menusBackground() || worldLoaded()) return;
        int width = screenWidth(graphics, screen);
        int height = screenHeight(graphics, screen);
        if (width <= 0 || height <= 0) return;
        if (!fr.kiza.basemod.menu.MenuBackground.drawBlurred(graphics, width, height)) {
            // Kiza's own picture is blurred when the mod is built.
            drawMenuBackground(graphics, width, height);
        }
        int dim = Math.min(90, fr.kiza.basemod.menu.ClientSettings.dim() + 20);
        fill(graphics, 0, 0, width, height, ((dim * 255 / 100) << 24) | 0x07060C);
        fr.kiza.basemod.menu.MenuBackground.drawStats(graphics);
    }

    private static Field levelField;
    private static boolean levelUnknown;

    /** Whether a world is loaded: Minecraft's client level, under each generation's name. */
    static boolean worldLoaded() {
        if (levelUnknown) return false;
        try {
            Object minecraft = WindowTitleManager.minecraftInstance();
            if (levelField == null) {
                java.util.Set<String> names = new java.util.HashSet<String>(java.util.Arrays.asList(
                    "net.minecraft.client.multiplayer.ClientLevel",
                    "net.minecraft.class_638",
                    "net.minecraft.client.world.ClientWorld",
                    "net.minecraft.client.multiplayer.WorldClient"
                ));
                for (Class<?> type = minecraft.getClass(); type != null && levelField == null; type = type.getSuperclass()) {
                    for (Field field : type.getDeclaredFields()) {
                        if (names.contains(field.getType().getName())) {
                            field.setAccessible(true);
                            levelField = field;
                            break;
                        }
                    }
                }
                if (levelField == null) {
                    // A version this cannot read: treat every menu as in a world,
                    // which leaves Minecraft's own background in place.
                    levelUnknown = true;
                    return true;
                }
            }
            return levelField.get(minecraft) != null;
        } catch (ReflectiveOperationException | RuntimeException error) {
            levelUnknown = true;
            return true;
        }
    }

    public static void renderBackground(Object graphics, Object screen) {
        currentScreen = screen;
        if (graphics == null || !isBrandedScreen(screen)) return;

        int width = screenWidth(graphics, screen);
        int height = screenHeight(graphics, screen);
        if (width <= 0 || height <= 0) return;

        if (isTitleScreen(screen)) {
            // Violet nebula wash: dark base, a soft accent glow under the top
            // toolbar and a darkening toward the bottom for depth.
            fill(graphics, 0, 0, width, height, 0x660A0912);
            verticalGlow(graphics, 0, 0, width, Math.min(height, 200), 0x8B5CF6, 0x3A, 0x00);
            verticalGlow(graphics, 0, height - Math.min(height, 140), width, Math.min(height, 140), 0x05010A, 0x00, 0x66);
            return;
        }

        fill(graphics, 0, 0, width, height, 0x2E0A0912);
    }

    // Fades an RGB colour vertically by stacking thin translucent bands.
    private static void verticalGlow(
        Object graphics,
        int left,
        int top,
        int width,
        int height,
        int rgb,
        int startAlpha,
        int endAlpha
    ) {
        if (height <= 0 || width <= 0) return;
        int steps = Math.min(height, 64);
        for (int index = 0; index < steps; index += 1) {
            int alpha = startAlpha + (endAlpha - startAlpha) * index / Math.max(1, steps - 1);
            int y0 = top + index * height / steps;
            int y1 = top + (index + 1) * height / steps;
            fill(graphics, left, y0, left + width, y1, (alpha << 24) | (rgb & 0xFFFFFF));
        }
    }

    public static void render(Object graphics, Object screen) {
        render(graphics, screen, -1, -1);
    }

    public static void render(Object graphics, Object screen, int mouseX, int mouseY) {
        currentScreen = screen;
        if (graphics == null) return;
        WindowTitleManager.update();

        int width = screenWidth(graphics, screen);
        int height = screenHeight(graphics, screen);
        if (width <= 0 || height <= 0) return;

        // A mod that draws the menu draws the menu. Only the title bar is
        // Kiza's here, and only when nothing else owns the window.
        if (Courtesies.menu()) {
            CustomTitleBar.render(graphics, screen, width, height);
            return;
        }

        // Every screen gets Kiza's buttons when the player asked for Kiza's
        // style everywhere -- Minecraft's, and the screens mods add: Mod Menu,
        // a mod's own settings. Those used to be left out and kept vanilla's
        // grey, or the branding pack's, which the modern jars no longer get.
        // What is taken is only what is a button: a widget of Minecraft's
        // button classes, with words on it; a mod's icon button, its text
        // fields and its own widgets are left as the mod draws them, and a
        // label keeps the colour the mod gave it.
        //
        // Only the branding stays on the title and pause screens. A wordmark on
        // the Controls screen would be a launcher signing somebody else's page.
        boolean branded = isBrandedScreen(screen);
        boolean title = isTitleScreen(screen);
        // With the settings open the panel has the pointer: nothing under it lights up.
        if (title && fr.kiza.basemod.menu.SettingsPanel.isOpen()) {
            mouseX = -1;
            mouseY = -1;
        }
        if (branded || fr.kiza.basemod.menu.ClientSettings.everywhere()) {
            // Rows are pushed apart only where the layout is one Kiza knows the
            // shape of. Options is a two-column grid with a Done button of its
            // own; re-centring that is a change nobody asked for.
            // The title screen gets the Kiza menu -- emblem, wordmark, grid --
            // and falls back to Minecraft's layout in Kiza's colours when it
            // cannot be built here.
            TitleMenuController.Layout layout = isTitleScreen(screen)
                ? TitleMenuController.captureTitle(screen, width, height)
                : TitleMenuController.capture(screen, height, branded);
            if (layout.supported()) {
                if (isTitleScreen(screen)) drawTitleScrim(graphics, width, height);
                TitleMenuController.render(
                    graphics, screen, width, layout, mouseX, mouseY, branded, branded
                );
            }
            kizaMenu = layout.plan() != null;
        } else {
            kizaMenu = false;
        }
        if (branded) {
            if (fr.kiza.basemod.menu.ClientSettings.footer()) drawFooter(graphics, screen, width, height);
            if (title && kizaMenu) drawSettings(graphics, width, height);
            // The corner logo says Kiza on a screen that otherwise would not.
            // Under the emblem it would say it twice.
            // Nor over the pause menu, which carries the emblem at its top now.
            if (!kizaMenu && !isPauseScreen(screen)) drawLogo(graphics, screen, width, height);
        }
        CustomTitleBar.render(graphics, screen, width, height);
    }

    // Frosted scrim so the panorama recedes behind the menu (Lunar-like). The
    // top is covered almost fully to knock out the vanilla logo + splash text.
    private static void drawTitleScrim(Object graphics, int width, int height) {
        // The player's picture, GIF or video when there is one; Kiza's own when
        // not, or while the chosen one is still being read.
        if (!fr.kiza.basemod.menu.MenuBackground.draw(graphics, width, height)) {
            drawMenuBackground(graphics, width, height);
        }
        int dim = fr.kiza.basemod.menu.ClientSettings.dim();
        fill(graphics, 0, 0, width, height, ((dim * 255 / 100) << 24) | 0x07060C);
        fr.kiza.basemod.menu.MenuBackground.drawStats(graphics);
        verticalGlow(
            graphics,
            0,
            0,
            width,
            Math.min(height, 190),
            0x8B5CF6,
            0x18,
            0x00
        );
        verticalGlow(
            graphics,
            0,
            height - Math.min(height, 170),
            width,
            Math.min(height, 170),
            0x05030B,
            0x00,
            0x72
        );
    }

    public static void renderHud(Object graphics) {
        if (graphics == null) return;
        if (hasActiveScreen()) return;
        WindowTitleManager.update();

        int width = screenWidth(graphics, null);
        int height = screenHeight(graphics, null);
        if (width <= 0 || height <= 0) return;

        CustomTitleBar.render(graphics, null, width, height);
        fr.kiza.basemod.menu.ScreenshotNotice.render(graphics, width, height);
    }

    /**
     * Branding only: the corner logo and the legal line, no Kiza menu.
     *
     * <p>Used on the versions the menu was never built for. Their vanilla
     * screens stay exactly as they are, so nothing can be pushed out of place
     * by a layout we never tested there.
     */
    public static void renderBrandOnly(Object graphics, Object screen) {
        currentScreen = screen;
        if (graphics == null || !isBrandedScreen(screen) || Courtesies.menu()) return;
        WindowTitleManager.update();

        int width = screenWidth(graphics, screen);
        int height = screenHeight(graphics, screen);
        if (width <= 0 || height <= 0) return;

        drawFooter(graphics, screen, width, height);
        drawLogo(graphics, screen, width, height);
    }

    public static void renderTitleForeground(Object graphics, Object screen) {
        renderTitleForeground(graphics, screen, -1, -1);
    }

    public static void renderTitleForeground(Object graphics, Object screen, int mouseX, int mouseY) {
        currentScreen = screen;
        if (graphics == null || !isTitleScreen(screen)) return;
        WindowTitleManager.update();

        int width = screenWidth(graphics, screen);
        int height = screenHeight(graphics, screen);
        if (width <= 0 || height <= 0) return;
        if (Courtesies.menu()) {
            CustomTitleBar.render(graphics, screen, width, height);
            return;
        }

        if (fr.kiza.basemod.menu.SettingsPanel.isOpen()) {
            mouseX = -1;
            mouseY = -1;
        }
        TitleMenuController.Layout layout = TitleMenuController.captureTitle(screen, width, height);
        if (layout.supported()) {
            drawTitleScrim(graphics, width, height);
            TitleMenuController.render(graphics, screen, width, layout, mouseX, mouseY);
        }
        if (fr.kiza.basemod.menu.ClientSettings.footer()) drawFooter(graphics, screen, width, height);
        if (layout.plan() == null) drawLogo(graphics, screen, width, height);
        else drawSettings(graphics, width, height);
        CustomTitleBar.render(graphics, screen, width, height);
    }

    /**
     * The settings gear and its panel, over everything else on the title
     * screen. The gear sits above the footer, or in its place when the player
     * turned the footer off.
     */
    private static void drawSettings(Object graphics, int width, int height) {
        int bottom = fr.kiza.basemod.menu.ClientSettings.footer()
            ? height - MARGIN - FOOTER_LINE * 2 - 6
            : height - MARGIN - 2;
        double[] pointer = fr.kiza.basemod.menu.MenuInput.pointer();
        int mouseX = pointer == null ? -1 : (int) pointer[0];
        int mouseY = pointer == null ? -1 : (int) pointer[1];
        fr.kiza.basemod.menu.SettingsPanel.render(graphics, width, height, bottom, mouseX, mouseY);
    }

    private static void drawFooter(
        Object graphics,
        Object screen,
        int width,
        int height
    ) {
        String label = KizaClientManager.identity().footerLabel();
        if (!isBrandedScreen(screen)) {
            drawText(graphics, screen, label, MARGIN, height - 14, COLOR_TEXT);
            return;
        }

        // Set on its own shadow, not on a panel.
        //
        // A panel here was the wrong object: the material the buttons are made
        // of says "this is a thing you press", and a legal notice is not. Over
        // a picture it read as a grey slab someone had left on the artwork.
        //
        // What the words actually need is separation from whatever is behind
        // them, which is what a shadow gives and a surface only gives as a side
        // effect. It is also what Minecraft's own font has always done, so the
        // footer stops being the one piece of text on screen that floats.
        String legalNotice = fr.kiza.basemod.menu.ClientText.get(width >= 700 ? "kiza.footer.legal" : "kiza.footer.legal_short");
        int left = MARGIN + 2;
        int noticeTop = height - MARGIN - FOOTER_LINE;
        int labelTop = noticeTop - FOOTER_LINE;

        shadowedText(graphics, screen, label, left, labelTop, COLOR_TEXT, true);
        shadowedText(graphics, screen, legalNotice, left, noticeTop, COLOR_MUTED, false);
    }

    /**
     * Draws a label over its own shadow, so it reads on any background.
     *
     * <p>Two passes rather than one: the same string in near-black a pixel down
     * and across, then the label itself. It costs one extra blit of a texture
     * that is already cached, and it is the difference between a footer that
     * works over a night sky and one that works over a night sky.
     */
    private static void shadowedText(
        Object graphics,
        Object screen,
        String text,
        int x,
        int y,
        int color,
        boolean bold
    ) {
        drawText(graphics, screen, text, x + 1, y + 1, COLOR_TEXT_SHADOW, bold);
        drawText(graphics, screen, text, x, y, color, bold);
    }

    private static void drawLogo(
        Object graphics,
        Object screen,
        int screenWidth,
        int screenHeight
    ) {
        // Like other clients, the badge is a fixed size in GUI-scaled pixels, so
        // it follows the player's GUI scale and looks identical windowed or
        // fullscreen. It only shrinks (keeping its ratio) when the screen is too
        // narrow to host it, and never snaps between two sizes.
        //
        // The emblem now, the same one the title menu leads with: the old
        // Kiza Launcher art in this corner was the last place it survived.
        int size = Math.min(34, Math.max(22, screenWidth / 14));
        Object emblem = fr.kiza.basemod.menu.Buttons.emblem(
            size, fr.kiza.basemod.menu.Buttons.FADE_STEPS, 0, 0
        );
        if (emblem == null) {
            int maxWidth = Math.max(COMPACT_DRAW_WIDTH, screenWidth / 4);
            int drawWidth = Math.min(DRAW_WIDTH, maxWidth);
            int drawHeight = drawWidth * DRAW_HEIGHT / DRAW_WIDTH;
            drawLogoAt(graphics, screenWidth - drawWidth - MARGIN, screenHeight - drawHeight - MARGIN,
                drawWidth, drawHeight);
            return;
        }
        int pad = fr.kiza.basemod.menu.Buttons.EMBLEM_GLOW;
        int scale = fr.kiza.basemod.menu.Buttons.supersample();
        int drawn = size + pad * 2;
        blitTexture(graphics, emblem, screenWidth - size - MARGIN - pad, screenHeight - size - MARGIN - pad,
            drawn, drawn, drawn * scale, drawn * scale);
    }

    /** Blits the bicubic-resampled brand art; false when unavailable. */
    private static boolean drawResampled(
        Object graphics,
        String resource,
        int drawX,
        int drawY,
        int drawWidth,
        int drawHeight
    ) {
        Object identifier =
            fr.kiza.basemod.render.KizaLogo.texture(resource, drawWidth, drawHeight);
        if (identifier == null) return false;
        blitTexture(
            graphics, identifier, drawX, drawY, drawWidth, drawHeight, drawWidth, drawHeight
        );
        return true;
    }

    public static void drawLogoAt(
        Object graphics,
        int drawX,
        int drawY,
        int drawWidth,
        int drawHeight
    ) {
        if (textureUnavailable || graphics == null) return;
        // Prefer the smoothly resampled copy; the raw texture is far larger
        // than the drawn size and Minecraft's blit does not filter it down.
        if (drawResampled(graphics, "/assets/" + NAMESPACE + "/" + TEXTURE_PATH,
                drawX, drawY, drawWidth, drawHeight)) {
            return;
        }
        try {
            if (textureIdentifier == null) textureIdentifier = createTextureIdentifier();
        } catch (ReflectiveOperationException | RuntimeException error) {
            textureUnavailable = true;
            return;
        }
        blitTexture(
            graphics,
            textureIdentifier,
            drawX,
            drawY,
            drawWidth,
            drawHeight,
            TEXTURE_WIDTH,
            TEXTURE_HEIGHT
        );
    }

    /** Draws any registered GUI texture, scaling it into the given box. */
    public static void blitTexture(
        Object graphics,
        Object identifier,
        int drawX,
        int drawY,
        int drawWidth,
        int drawHeight,
        int textureWidth,
        int textureHeight
    ) {
        blitRegion(
            graphics, identifier, drawX, drawY, drawWidth, drawHeight,
            0.0F, 0.0F, textureWidth, textureHeight, textureWidth, textureHeight
        );
    }

    /**
     * Draws a whole texture at a fractional place and size with an opacity,
     * its whole texture. Where the version cannot, it is drawn the plain way when fully
     * shown, and not at all when partly: a jump is better than a flash.
     */
    public static void blitSmooth(
        Object graphics,
        Object identifier,
        float x,
        float y,
        float width,
        float height,
        int textureWidth,
        int textureHeight,
        float alpha
    ) {
        blitSmooth(graphics, identifier, x, y, width, height, 0F, 0F, textureWidth, textureHeight, textureWidth, textureHeight, alpha);
    }

    private static int smoothRefused;

    /** How many smooth draws this version turned down, for the loading screen's line in the log. */
    static int smoothRefused() {
        return smoothRefused;
    }

    /** Part of a texture the same way: {@code regionWidth} by {@code regionHeight} texture pixels from (u, v). */
    public static void blitSmooth(
        Object graphics,
        Object identifier,
        float x,
        float y,
        float width,
        float height,
        float u,
        float v,
        int regionWidth,
        int regionHeight,
        int textureWidth,
        int textureHeight,
        float alpha
    ) {
        if (graphics == null || identifier == null || alpha <= 0.002F) return;
        if (graphics instanceof java.awt.Graphics2D && identifier instanceof java.awt.image.BufferedImage) {
            java.awt.Graphics2D canvas = (java.awt.Graphics2D) graphics;
            java.awt.Composite composite = canvas.getComposite();
            java.awt.geom.AffineTransform transform = canvas.getTransform();
            canvas.setComposite(java.awt.AlphaComposite.getInstance(java.awt.AlphaComposite.SRC_OVER, Math.min(1F, alpha)));
            canvas.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION, java.awt.RenderingHints.VALUE_INTERPOLATION_BILINEAR);
            java.awt.image.BufferedImage picture = (java.awt.image.BufferedImage) identifier;
            float sx = picture.getWidth() / (float) textureWidth;
            float sy = picture.getHeight() / (float) textureHeight;
            canvas.translate(x, y);
            canvas.scale(width / (regionWidth * sx), height / (regionHeight * sy));
            canvas.drawImage(picture, 0, 0, Math.round(regionWidth * sx), Math.round(regionHeight * sy),
                Math.round(u * sx), Math.round(v * sy), Math.round((u + regionWidth) * sx), Math.round((v + regionHeight) * sy), null);
            canvas.setTransform(transform);
            canvas.setComposite(composite);
            return;
        }
        if (textureUnavailable) return;
        if (fr.kiza.basemod.render.GuiDispatch.blitSmooth(graphics, currentScreen, identifier, x, y, width, height,
            u, v, regionWidth, regionHeight, textureWidth, textureHeight, alpha)) {
            return;
        }
        smoothRefused += 1;
        if (alpha >= 0.999F) {
            blitRegion(graphics, identifier, Math.round(x), Math.round(y), Math.round(width), Math.round(height),
                u, v, regionWidth, regionHeight, textureWidth, textureHeight);
        }
    }

    /** Draws part of a texture, scaling that region into the given box. */
    public static void blitRegion(
        Object graphics,
        Object identifier,
        int drawX,
        int drawY,
        int drawWidth,
        int drawHeight,
        float sourceX,
        float sourceY,
        int sourceWidth,
        int sourceHeight,
        int textureWidth,
        int textureHeight
    ) {
        if (graphics == null || identifier == null) return;
        // The preview's canvas: a Java2D picture standing in for the game.
        if (graphics instanceof java.awt.Graphics2D && identifier instanceof java.awt.image.BufferedImage) {
            java.awt.image.BufferedImage picture = (java.awt.image.BufferedImage) identifier;
            double sx = picture.getWidth() / (double) textureWidth;
            double sy = picture.getHeight() / (double) textureHeight;
            ((java.awt.Graphics2D) graphics).drawImage(picture,
                drawX, drawY, drawX + drawWidth, drawY + drawHeight,
                (int) Math.round(sourceX * sx), (int) Math.round(sourceY * sy),
                (int) Math.round((sourceX + sourceWidth) * sx), (int) Math.round((sourceY + sourceHeight) * sy), null);
            return;
        }
        if (textureUnavailable) return;

        boolean drawn = fr.kiza.basemod.render.GuiDispatch.blit(
            graphics, currentScreen, identifier, drawX, drawY, drawWidth, drawHeight,
            sourceX, sourceY, sourceWidth, sourceHeight, textureWidth, textureHeight
        );
        if (!drawn) {
            textureUnavailable = true;
            System.err.println("[Kiza Client] The texture renderer is unavailable on this build.");
        }
    }

    /** Whether this version keeps the wordmark as one strip or as two halves. */
    static boolean modernLogoSheet() {
        return !versionIsBefore(KizaClientManager.identity().minecraftVersion(), 1, 20);
    }

    /** The wordmark's width for a given drawn height, at its true proportions. */
    public static int logoWidthFor(int drawHeight) {
        return logoWidthFor(drawHeight, modernLogoSheet());
    }

    static int logoWidthFor(int drawHeight, boolean modernSheet) {
        return modernSheet
            ? drawHeight * MODERN_LOGO_WIDTH / MODERN_LOGO_HEIGHT
            : drawHeight * (LEGACY_LOGO_HALF_WIDTH * 2) / LEGACY_LOGO_HEIGHT;
    }

    public static void drawMinecraftLogoAt(
        Object graphics,
        int drawX,
        int drawY,
        int drawWidth,
        int drawHeight
    ) {
        if (titleTextureUnavailable || graphics == null) return;
        try {
            if (titleTextureIdentifier == null) {
                titleTextureIdentifier = createTextureIdentifier(
                    "minecraft",
                    MINECRAFT_LOGO_TEXTURE_PATH
                );
            }
        } catch (ReflectiveOperationException | RuntimeException error) {
            titleTextureUnavailable = true;
            System.err.println(
                "[Kiza Client] The Minecraft logo renderer is unavailable: "
                    + describe(error)
            );
            return;
        }

        if (modernLogoSheet()) {
            blitRegion(
                graphics, titleTextureIdentifier, drawX, drawY, drawWidth, drawHeight,
                0.0F, 0.0F,
                MODERN_LOGO_WIDTH, MODERN_LOGO_HEIGHT,
                LOGO_SHEET_UNITS, MODERN_LOGO_SHEET_HEIGHT
            );
            return;
        }

        // Two halves, side by side. Written from the layout Minecraft itself
        // used from 1.7 to 1.19; it has not been seen on a real old instance.
        int half = drawWidth / 2;
        blitRegion(
            graphics, titleTextureIdentifier, drawX, drawY, half, drawHeight,
            0.0F, 0.0F,
            LEGACY_LOGO_HALF_WIDTH, LEGACY_LOGO_HEIGHT,
            LOGO_SHEET_UNITS, LEGACY_LOGO_SHEET_HEIGHT
        );
        blitRegion(
            graphics, titleTextureIdentifier, drawX + half, drawY, drawWidth - half, drawHeight,
            0.0F, (float) LEGACY_LOGO_SECOND_HALF_V,
            LEGACY_LOGO_HALF_WIDTH, LEGACY_LOGO_HEIGHT,
            LOGO_SHEET_UNITS, LEGACY_LOGO_SHEET_HEIGHT
        );
    }

    /** Compares a Minecraft version string against a major.minor pair. */
    static boolean versionIsBefore(String version, int major, int minor) {
        String[] parts = (version == null ? "" : version).split("[.-]");
        try {
            int foundMajor = parts.length > 0 ? Integer.parseInt(parts[0]) : major;
            int foundMinor = parts.length > 1 ? Integer.parseInt(parts[1]) : minor;
            return foundMajor != major ? foundMajor < major : foundMinor < minor;
        } catch (NumberFormatException unreadable) {
            // An unreadable version is treated as current, which is the layout
            // every supported version has used for the last several years.
            return false;
        }
    }

    /**
     * Reads the background PNG's width and height out of its own header.
     *
     * <p>A PNG is an 8-byte signature, then an IHDR chunk whose first eight
     * bytes of data are the width and height as big-endian 32-bit integers.
     * That is bytes 16 through 23 of the file, and it is the same in every PNG
     * ever written, so sixteen bytes is all that has to be read.
     */
    private static boolean readBackgroundSize() {
        if (backgroundWidth > 0 && backgroundHeight > 0) return true;

        String resource = "/assets/" + NAMESPACE + "/" + BACKGROUND_TEXTURE_PATH;
        try (java.io.InputStream input = MenuLogoRenderer.class.getResourceAsStream(resource)) {
            if (input == null) {
                System.err.println("[Kiza Client] The menu background is missing: " + resource);
                return false;
            }
            byte[] header = new byte[24];
            int read = 0;
            while (read < header.length) {
                int step = input.read(header, read, header.length - read);
                if (step < 0) break;
                read += step;
            }
            if (read < header.length) return false;

            int foundWidth = readInt(header, 16);
            int foundHeight = readInt(header, 20);
            // Sanity, not paranoia: a texture larger than the GPU limit every
            // supported version guarantees would fail to upload, and a zero
            // would make the crop divide by nothing.
            if (foundWidth <= 0 || foundHeight <= 0
                || foundWidth > 8192 || foundHeight > 8192) {
                System.err.println(
                    "[Kiza Client] The menu background is "
                        + foundWidth + "x" + foundHeight + ", which is not a size we can draw."
                );
                return false;
            }
            backgroundWidth = foundWidth;
            backgroundHeight = foundHeight;
            return true;
        } catch (java.io.IOException | RuntimeException error) {
            System.err.println(
                "[Kiza Client] The menu background could not be measured: " + describe(error)
            );
            return false;
        }
    }

    /** What the reader made of the file, for the test that checks it agrees. */
    static int[] measuredBackground() {
        return readBackgroundSize() ? new int[] {backgroundWidth, backgroundHeight} : null;
    }

    private static int readInt(byte[] bytes, int at) {
        return ((bytes[at] & 0xFF) << 24)
            | ((bytes[at + 1] & 0xFF) << 16)
            | ((bytes[at + 2] & 0xFF) << 8)
            | (bytes[at + 3] & 0xFF);
    }

    private static void drawMenuBackground(Object graphics, int width, int height) {
        if (backgroundUnavailable || graphics == null || width <= 0 || height <= 0) return;

        try {
            if (backgroundTextureIdentifier == null) {
                if (!readBackgroundSize()) {
                    backgroundUnavailable = true;
                    return;
                }
                backgroundTextureIdentifier = createTextureIdentifier(BACKGROUND_TEXTURE_PATH);
            }

            double screenAspect = (double) width / (double) height;
            double textureAspect = (double) backgroundWidth / (double) backgroundHeight;
            int sourceWidth = backgroundWidth;
            int sourceHeight = backgroundHeight;
            int sourceX = 0;
            int sourceY = 0;
            if (screenAspect > textureAspect) {
                sourceHeight = Math.max(1, (int) Math.round(backgroundWidth / screenAspect));
                sourceY = (backgroundHeight - sourceHeight) / 2;
            } else {
                sourceWidth = Math.max(1, (int) Math.round(backgroundHeight * screenAspect));
                sourceX = (backgroundWidth - sourceWidth) / 2;
            }

            blitRegion(
                graphics,
                backgroundTextureIdentifier,
                0,
                0,
                width,
                height,
                (float) sourceX,
                (float) sourceY,
                sourceWidth,
                sourceHeight,
                backgroundWidth,
                backgroundHeight
            );
        } catch (ReflectiveOperationException | RuntimeException error) {
            backgroundUnavailable = true;
            System.err.println(
                "[Kiza Client] The menu background is unavailable: " + describe(error)
            );
        }
    }

    public static void fill(
        Object graphics,
        int left,
        int top,
        int right,
        int bottom,
        int color
    ) {
        if (graphics instanceof java.awt.Graphics2D) {
            java.awt.Graphics2D canvas = (java.awt.Graphics2D) graphics;
            canvas.setColor(new java.awt.Color(color, true));
            canvas.fillRect(left, top, right - left, bottom - top);
            return;
        }
        if (fillUnavailable) return;
        if (!fr.kiza.basemod.render.GuiDispatch.fill(
            graphics, currentScreen, left, top, right, bottom, color
        )) {
            fillUnavailable = true;
        }
    }

    public static void roundedFill(
        Object graphics,
        int left,
        int top,
        int right,
        int bottom,
        int radius,
        int color
    ) {
        int width = right - left;
        int height = bottom - top;
        int safeRadius = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
        if (safeRadius == 0) {
            fill(graphics, left, top, right, bottom, color);
            return;
        }

        fill(graphics, left + safeRadius, top, right - safeRadius, bottom, color);
        fill(graphics, left, top + safeRadius, right, bottom - safeRadius, color);
        for (int row = 0; row < safeRadius; row += 1) {
            int distance = safeRadius - row;
            int inset = (int) Math.ceil(
                safeRadius - Math.sqrt(safeRadius * safeRadius - distance * distance)
            );
            fill(
                graphics,
                left + inset,
                top + row,
                right - inset,
                top + row + 1,
                color
            );
            fill(
                graphics,
                left + inset,
                bottom - row - 1,
                right - inset,
                bottom - row,
                color
            );
        }
    }

    public static void drawText(
        Object graphics,
        Object screen,
        String text,
        int x,
        int y,
        int color
    ) {
        drawText(graphics, screen, text, x, y, color, false);
    }

    /**
     * The same, in the heavier face.
     *
     * <p>Menu labels ask for it and the legal line does not. A button is a
     * thing you are meant to hit and its label should carry that; a notice at
     * the bottom of the screen set in the same weight is a notice competing
     * with the buttons.
     */
    public static void drawText(
        Object graphics,
        Object screen,
        String text,
        int x,
        int y,
        int color,
        boolean bold
    ) {
        if (textUnavailable) return;
        // Prefer the antialiased TrueType renderer; the vanilla bitmap font is
        // the fallback whenever the canvas is unavailable on this setup.
        if (drawTrueTypeText(graphics, text, x, y, color, bold)) return;
        try {
            if (textMethod == null) textMethod = findStringDrawMethod(graphics.getClass());
            Object font = findFont(screen, textMethod.getParameterTypes()[0]);
            textMethod.invoke(graphics, font, text, x, y, color, true);
            return;
        } catch (ReflectiveOperationException | RuntimeException error) {
            // Pre-1.20 the text helper lives on the screen, not on the graphics.
        }
        Object font = fontForLegacyText(screen);
        if (font == null
            || !fr.kiza.basemod.render.GuiDispatch.drawString(
                graphics, screen, font, text, x, y, color
            )) {
            textUnavailable = true;
        }
    }

    private static Object fontForLegacyText(Object screen) {
        try {
            Class<?> fontType = firstClass(
                "net.minecraft.client.gui.Font",
                "net.minecraft.client.gui.FontRenderer",
                "net.minecraft.class_327"
            );
            return fontType == null ? null : findFont(screen, fontType);
        } catch (ReflectiveOperationException | RuntimeException error) {
            return null;
        }
    }

    /**
     * Delegated so an obfuscated Minecraft is covered too: with no loader to
     * rename anything, none of these spellings exist and the answer has to
     * come from Mojang's own mapping.
     */
    private static Class<?> firstClass(String... names) {
        return McNames.firstClass(names);
    }

    /** Vanilla glyphs are 8px tall, so the TTF is matched to that line height. */
    private static final int TEXT_SIZE_PX = 10;

    /**
     * Width {@code text} will actually occupy, so callers can centre it exactly
     * instead of guessing from the character count.
     */
    public static int textWidth(String text) {
        return textWidth(text, false);
    }

    public static int textWidth(String text, boolean bold) {
        if (text == null || text.isEmpty()) return 0;
        if (!textureUnavailable && fr.kiza.basemod.render.KizaText.isAvailable()) {
            int width = fr.kiza.basemod.render.KizaText.width(text, TEXT_SIZE_PX, bold);
            if (width > 0) return width;
        }
        // Vanilla's font is 6px per character including its 1px spacing.
        return text.length() * 6;
    }

    /** Vanilla's line height, for callers that place a line rather than centre it. */
    public static int textHeight() {
        return 8;
    }

    /**
     * How tall this label will actually be drawn.
     *
     * Not a constant. When the TrueType renderer is available a label is a
     * texture whose height comes from the font's own bounds — around twelve
     * pixels at this size, not eight — and centring against eight put every
     * button label low by a couple of pixels, which is the amount that reads as
     * "not centred" without being obviously broken.
     *
     * Measured through the same cache that draws it, so asking costs nothing
     * after the first frame.
     */
    public static int textHeight(String text) {
        return textHeight(text, false);
    }

    public static int textHeight(String text, boolean bold) {
        if (text == null || text.isEmpty()) return textHeight();
        if (!textureUnavailable && fr.kiza.basemod.render.KizaText.isAvailable()) {
            int[] size =
                fr.kiza.basemod.render.KizaText.prepare(text, TEXT_SIZE_PX, COLOR_TEXT, bold);
            if (size != null && size[1] > 0) return size[1];
        }
        return textHeight();
    }

    private static boolean drawTrueTypeText(
        Object graphics,
        String text,
        int x,
        int y,
        int color,
        boolean bold
    ) {
        if (textureUnavailable || !fr.kiza.basemod.render.KizaText.isAvailable()) return false;

        int[] size = fr.kiza.basemod.render.KizaText.prepare(text, TEXT_SIZE_PX, color, bold);
        if (size == null) return false;
        Object identifier =
            fr.kiza.basemod.render.KizaText.identifier(text, TEXT_SIZE_PX, color, bold);
        if (identifier == null) return false;

        blitTexture(graphics, identifier, x, y, size[0], size[1], size[0], size[1]);
        return true;
    }

    private static Object findFont(Object screen, Class<?> fontType)
        throws ReflectiveOperationException {
        Object font = readAssignableField(screen, fontType);
        if (font != null) return font;
        return readAssignableField(WindowTitleManager.minecraftInstance(), fontType);
    }

    private static Object readAssignableField(Object owner, Class<?> fieldType)
        throws IllegalAccessException {
        if (owner == null) return null;
        for (Class<?> type = owner.getClass(); type != null; type = type.getSuperclass()) {
            for (Field field : type.getDeclaredFields()) {
                if (!fieldType.isAssignableFrom(field.getType())) continue;
                field.setAccessible(true);
                Object value = field.get(owner);
                if (value != null) return value;
            }
        }
        return null;
    }

    /**
     * Whether this screen is one Minecraft wrote, rather than one a mod did.
     *
     * <p>The concrete class only, deliberately not its ancestry. Every mod
     * screen extends Minecraft's Screen, so walking up the hierarchy would say
     * yes to all of them -- and reskinning Sodium's video settings or Iris's
     * shader picker means covering widgets nobody here has measured, on screens
     * nobody here has opened.
     *
     * <p>A package check rather than a list of class names, because the list
     * would need four mapping sets and would go stale the next time Mojang adds
     * a screen. Everything Mojang ships lives under net.minecraft, under one
     * name or another; nothing anybody else ships does.
     */
    static boolean isMinecraftScreen(Object screen) {
        return screen != null && isMinecraftScreenClass(screen.getClass().getName());
    }

    /** Split out so the rule itself can be tested without a Minecraft on hand. */
    static boolean isMinecraftScreenClass(String className) {
        return className != null && className.startsWith("net.minecraft.");
    }

    static boolean isBrandedScreen(Object screen) {
        return isTitleScreen(screen) || isPauseScreen(screen);
    }

    static boolean isTitleScreen(Object screen) {
        return hasType(screen, TITLE_SCREENS);
    }

    static boolean isPauseScreen(Object screen) {
        return hasType(screen, PAUSE_SCREENS);
    }

    private static boolean hasType(Object value, Set<String> names) {
        if (value == null) return false;
        for (Class<?> type = value.getClass(); type != null; type = type.getSuperclass()) {
            if (names.contains(type.getName())) return true;
        }
        return false;
    }

    /**
     * The screen on show, or null: Minecraft's own field before 26.1, its
     * {@code Gui}'s {@code screen()} after.
     */
    static Object activeScreen() {
        try {
            Object minecraft = WindowTitleManager.minecraftInstance();
            for (Class<?> type = minecraft.getClass(); type != null; type = type.getSuperclass()) {
                for (Field field : type.getDeclaredFields()) {
                    String fieldType = field.getType().getName();
                    field.setAccessible(true);
                    if (fieldType.equals("net.minecraft.client.gui.screens.Screen") || fieldType.equals("net.minecraft.class_437")) {
                        return field.get(minecraft);
                    }
                    if (fieldType.equals("net.minecraft.client.gui.Gui")) {
                        Object gui = field.get(minecraft);
                        if (gui == null) continue;
                        Method screen = gui.getClass().getMethod("screen");
                        return screen.getParameterCount() == 0 ? screen.invoke(gui) : null;
                    }
                }
            }
        } catch (ReflectiveOperationException | RuntimeException unknown) {
            // Not a Minecraft this knows how to ask.
        }
        return null;
    }

    private static boolean hasActiveScreen() {
        try {
            Object minecraft = WindowTitleManager.minecraftInstance();
            for (
                Class<?> type = minecraft.getClass();
                type != null;
                type = type.getSuperclass()
            ) {
                for (Field field : type.getDeclaredFields()) {
                    String fieldType = field.getType().getName();
                    if (!fieldType.equals("net.minecraft.client.gui.screens.Screen")
                        && !fieldType.equals("net.minecraft.class_437")) {
                        continue;
                    }
                    field.setAccessible(true);
                    return field.get(minecraft) != null;
                }
            }
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            // Some legacy mappings do not expose a typed current-screen field.
        }
        return false;
    }

    static int screenWidth(Object screen) {
        Integer width = readIntField(screen, "field_22789", "width");
        return width != null ? width : 0;
    }

    static int screenHeight(Object screen) {
        Integer height = readIntField(screen, "field_22790", "height");
        return height != null ? height : 0;
    }

    static int screenWidth(Object graphics, Object screen) {
        int width = screenWidth(screen);
        return width > 0
            ? width
            : readIntMethod(graphics, "guiWidth", "method_51421", "getGuiScaledWidth");
    }

    static int screenHeight(Object graphics, Object screen) {
        int height = screenHeight(screen);
        return height > 0
            ? height
            : readIntMethod(graphics, "guiHeight", "method_51443", "getGuiScaledHeight");
    }

    private static int readIntMethod(Object owner, String... names) {
        if (owner == null) return 0;
        for (String name : names) {
            try {
                Method method = owner.getClass().getMethod(name);
                if (method.getParameterCount() == 0 && method.getReturnType() == int.class) {
                    return (int) method.invoke(owner);
                }
            } catch (ReflectiveOperationException | RuntimeException ignored) {
                // Try the next mapped name.
            }
        }
        return 0;
    }

    static Integer readIntField(Object owner, String... names) {
        if (owner == null) return null;
        for (Class<?> type = owner.getClass(); type != null; type = type.getSuperclass()) {
            for (String name : names) {
                try {
                    Field field = type.getDeclaredField(name);
                    if (field.getType() == int.class) {
                        field.setAccessible(true);
                        return field.getInt(owner);
                    }
                } catch (NoSuchFieldException ignored) {
                    // Try the next name or superclass.
                } catch (ReflectiveOperationException | RuntimeException error) {
                    return null;
                }
            }
        }
        return null;
    }



    static Method findStringDrawMethod(Class<?> graphicsType) throws NoSuchMethodException {
        return Arrays.stream(graphicsType.getMethods())
            .filter(method -> {
                Class<?>[] parameters = method.getParameterTypes();
                return parameters.length == 6
                    && !parameters[0].isPrimitive()
                    && parameters[1] == String.class
                    && parameters[2] == int.class
                    && parameters[3] == int.class
                    && parameters[4] == int.class
                    && parameters[5] == boolean.class;
            })
            .findFirst()
            .orElseThrow(() -> new NoSuchMethodException("GUI text draw method"));
    }



    private static Object createTextureIdentifier() throws ReflectiveOperationException {
        return createTextureIdentifier(TEXTURE_PATH);
    }

    private static Object createTextureIdentifier(String texturePath)
        throws ReflectiveOperationException {
        return createTextureIdentifier(NAMESPACE, texturePath);
    }

    private static Object createTextureIdentifier(String namespace, String texturePath)
        throws ReflectiveOperationException {
        ReflectiveOperationException lastFailure = null;
        for (String className : new String[] {
            "net.minecraft.resources.ResourceLocation",
            "net.minecraft.resources.Identifier",
            "net.minecraft.class_2960"
        }) {
            try {
                return createTextureIdentifier(Class.forName(className), namespace, texturePath);
            } catch (ReflectiveOperationException error) {
                lastFailure = error;
            }
        }
        throw lastFailure == null
            ? new ClassNotFoundException("Minecraft texture identifier")
            : lastFailure;
    }

    private static String describe(Throwable error) {
        Throwable cause = error;
        while (cause.getCause() != null && cause.getCause() != cause) {
            cause = cause.getCause();
        }
        String message = cause.getMessage();
        return cause.getClass().getSimpleName()
            + (message == null || message.trim().isEmpty() ? "" : " - " + message);
    }

    private static Object createTextureIdentifier(
        Class<?> identifierType,
        String namespace,
        String texturePath
    )
        throws ReflectiveOperationException {
        for (Constructor<?> constructor : identifierType.getDeclaredConstructors()) {
            Class<?>[] parameters = constructor.getParameterTypes();
            if (Arrays.equals(parameters, new Class<?>[] {String.class, String.class})) {
                constructor.setAccessible(true);
                return constructor.newInstance(namespace, texturePath);
            }
        }

        for (Method method : identifierType.getDeclaredMethods()) {
            if (!Modifier.isStatic(method.getModifiers())
                || !identifierType.isAssignableFrom(method.getReturnType())) {
                continue;
            }
            Class<?>[] parameters = method.getParameterTypes();
            method.setAccessible(true);
            if (Arrays.equals(parameters, new Class<?>[] {String.class, String.class})) {
                Object identifier = method.invoke(null, namespace, texturePath);
                if (identifier != null) return identifier;
            }
            if (Arrays.equals(parameters, new Class<?>[] {String.class})) {
                Object identifier = method.invoke(null, namespace + ":" + texturePath);
                if (identifier != null) return identifier;
            }
        }

        throw new NoSuchMethodException("Minecraft texture identifier factory");
    }
}
