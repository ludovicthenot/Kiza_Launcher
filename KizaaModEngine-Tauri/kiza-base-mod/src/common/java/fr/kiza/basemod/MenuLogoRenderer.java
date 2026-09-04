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
    private static final int TEXTURE_WIDTH = 1400;
    private static final int TEXTURE_HEIGHT = 600;
    private static final int BACKGROUND_TEXTURE_WIDTH = 1672;
    private static final int BACKGROUND_TEXTURE_HEIGHT = 941;
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
    private static final String LEGAL_NOTICE =
        "Kiza Launcher is not affiliated with Mojang or Microsoft.";
    private static final String COMPACT_LEGAL_NOTICE =
        "Kiza Launcher is not affiliated with Mojang.";

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

    private MenuLogoRenderer() {}

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

        // Only Minecraft's title and pause screens are reskinned. Sodium, Iris
        // and other configuration screens keep their own widget renderers.
        if (isBrandedScreen(screen)) {
            boolean title = isTitleScreen(screen);
            TitleMenuController.Layout layout = TitleMenuController.capture(screen, height);
            if (layout.supported()) {
                if (title) drawTitleScrim(graphics, width, height);
                TitleMenuController.render(graphics, screen, width, layout, mouseX, mouseY);
            }
            drawFooter(graphics, screen, width, height);
            drawLogo(graphics, screen, width, height);
        }
        CustomTitleBar.render(graphics, screen, width, height);
    }

    // Frosted scrim so the panorama recedes behind the menu (Lunar-like). The
    // top is covered almost fully to knock out the vanilla logo + splash text.
    private static void drawTitleScrim(Object graphics, int width, int height) {
        drawMenuBackground(graphics, width, height);
        fill(graphics, 0, 0, width, height, 0x26060410);
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
        fr.kiza.basemod.hud.HudRenderer.render(graphics, null, width, height);
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
        if (graphics == null || !isBrandedScreen(screen)) return;
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

        TitleMenuController.Layout layout = TitleMenuController.capture(screen, height);
        if (layout.supported()) {
            drawTitleScrim(graphics, width, height);
            TitleMenuController.render(graphics, screen, width, layout, mouseX, mouseY);
        }
        drawFooter(graphics, screen, width, height);
        drawLogo(graphics, screen, width, height);
        CustomTitleBar.render(graphics, screen, width, height);
    }

    private static void drawFooter(
        Object graphics,
        Object screen,
        int width,
        int height
    ) {
        String label = KizaClientManager.identity().footerLabel();
        if (isBrandedScreen(screen)) {
            String legalNotice = width >= 700 ? LEGAL_NOTICE : COMPACT_LEGAL_NOTICE;
            drawText(graphics, screen, label, 10, height - 25, COLOR_TEXT);
            drawText(graphics, screen, legalNotice, 10, height - 13, COLOR_MUTED);
            return;
        }

        drawText(graphics, screen, label, MARGIN, height - 14, COLOR_TEXT);
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
        int maxWidth = Math.max(COMPACT_DRAW_WIDTH, screenWidth / 4);
        int drawWidth = Math.min(DRAW_WIDTH, maxWidth);
        int drawHeight = drawWidth * DRAW_HEIGHT / DRAW_WIDTH;
        int drawX = screenWidth - drawWidth - MARGIN;
        int drawY = screenHeight - drawHeight - MARGIN;
        drawLogoAt(graphics, drawX, drawY, drawWidth, drawHeight);
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
        if (textureUnavailable || graphics == null || identifier == null) return;

        boolean drawn = fr.kiza.basemod.render.GuiDispatch.blit(
            graphics, currentScreen, identifier, drawX, drawY, drawWidth, drawHeight,
            sourceX, sourceY, sourceWidth, sourceHeight, textureWidth, textureHeight
        );
        if (!drawn) {
            textureUnavailable = true;
            System.err.println("[Kiza Launcher] The texture renderer is unavailable on this build.");
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
                "[Kiza Launcher] The Minecraft logo renderer is unavailable: "
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

    private static void drawMenuBackground(Object graphics, int width, int height) {
        if (backgroundUnavailable || graphics == null || width <= 0 || height <= 0) return;

        try {
            if (backgroundTextureIdentifier == null) {
                backgroundTextureIdentifier = createTextureIdentifier(BACKGROUND_TEXTURE_PATH);
            }

            double screenAspect = (double) width / (double) height;
            double textureAspect =
                (double) BACKGROUND_TEXTURE_WIDTH / (double) BACKGROUND_TEXTURE_HEIGHT;
            int sourceWidth = BACKGROUND_TEXTURE_WIDTH;
            int sourceHeight = BACKGROUND_TEXTURE_HEIGHT;
            int sourceX = 0;
            int sourceY = 0;
            if (screenAspect > textureAspect) {
                sourceHeight = Math.max(
                    1,
                    (int) Math.round(BACKGROUND_TEXTURE_WIDTH / screenAspect)
                );
                sourceY = (BACKGROUND_TEXTURE_HEIGHT - sourceHeight) / 2;
            } else {
                sourceWidth = Math.max(
                    1,
                    (int) Math.round(BACKGROUND_TEXTURE_HEIGHT * screenAspect)
                );
                sourceX = (BACKGROUND_TEXTURE_WIDTH - sourceWidth) / 2;
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
                BACKGROUND_TEXTURE_WIDTH,
                BACKGROUND_TEXTURE_HEIGHT
            );
        } catch (ReflectiveOperationException | RuntimeException error) {
            backgroundUnavailable = true;
            System.err.println(
                "[Kiza Launcher] The menu background is unavailable: " + describe(error)
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
        if (textUnavailable) return;
        // Prefer the antialiased TrueType renderer; the vanilla bitmap font is
        // the fallback whenever the canvas is unavailable on this setup.
        if (drawTrueTypeText(graphics, text, x, y, color)) return;
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

    private static Class<?> firstClass(String... names) {
        for (String name : names) {
            try {
                return Class.forName(name);
            } catch (ClassNotFoundException ignored) {
                // Try the next mapping.
            }
        }
        return null;
    }

    /** Vanilla glyphs are 8px tall, so the TTF is matched to that line height. */
    private static final int TEXT_SIZE_PX = 10;

    /**
     * Width {@code text} will actually occupy, so callers can centre it exactly
     * instead of guessing from the character count.
     */
    public static int textWidth(String text) {
        if (text == null || text.isEmpty()) return 0;
        if (!textureUnavailable && fr.kiza.basemod.render.KizaText.isAvailable()) {
            int width = fr.kiza.basemod.render.KizaText.width(text, TEXT_SIZE_PX);
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
        if (text == null || text.isEmpty()) return textHeight();
        if (!textureUnavailable && fr.kiza.basemod.render.KizaText.isAvailable()) {
            int[] size = fr.kiza.basemod.render.KizaText.prepare(text, TEXT_SIZE_PX, COLOR_TEXT);
            if (size != null && size[1] > 0) return size[1];
        }
        return textHeight();
    }

    private static boolean drawTrueTypeText(
        Object graphics,
        String text,
        int x,
        int y,
        int color
    ) {
        if (textureUnavailable || !fr.kiza.basemod.render.KizaText.isAvailable()) return false;

        int[] size = fr.kiza.basemod.render.KizaText.prepare(text, TEXT_SIZE_PX, color);
        if (size == null) return false;
        Object identifier = fr.kiza.basemod.render.KizaText.identifier(text, TEXT_SIZE_PX, color);
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

    private static int screenWidth(Object graphics, Object screen) {
        int width = screenWidth(screen);
        return width > 0
            ? width
            : readIntMethod(graphics, "guiWidth", "method_51421", "getGuiScaledWidth");
    }

    private static int screenHeight(Object graphics, Object screen) {
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
