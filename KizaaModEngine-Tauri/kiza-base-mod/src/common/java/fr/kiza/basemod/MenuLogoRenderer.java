package fr.kiza.basemod;

import fr.kiza.basemod.window.CustomTitleBar;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.Arrays;
import java.util.Set;

public final class MenuLogoRenderer {
    private static final String NAMESPACE = "kiza_base_mod";
    private static final String TEXTURE_PATH = "textures/gui/kiza_launcher_logo.png";
    private static final String TITLE_TEXTURE_PATH =
        "textures/gui/kiza_client_header.png";
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

    private static final int COLOR_TEXT = 0xFFF4F2FA;
    private static final int COLOR_MUTED = 0xFFAAA5BA;
    private static final String LEGAL_NOTICE =
        "Kiza Launcher is not affiliated with Mojang or Microsoft.";
    private static final String COMPACT_LEGAL_NOTICE =
        "Kiza Launcher is not affiliated with Mojang.";

    private static final Set<String> TITLE_SCREENS = Set.of(
        "net.minecraft.client.gui.screens.TitleScreen",
        "net.minecraft.class_442"
    );
    private static final Set<String> PAUSE_SCREENS = Set.of(
        "net.minecraft.client.gui.screens.PauseScreen",
        "net.minecraft.client.gui.screens.GameMenuScreen",
        "net.minecraft.class_433"
    );

    private static Object textureIdentifier;
    private static Object titleTextureIdentifier;
    private static Object backgroundTextureIdentifier;
    private static Object texturePipeline;
    private static Method drawMethod;
    private static Method fillMethod;
    private static Method textMethod;
    private static boolean textureUnavailable;
    private static boolean titleTextureUnavailable;
    private static boolean backgroundUnavailable;
    private static boolean fillUnavailable;
    private static boolean textUnavailable;

    private MenuLogoRenderer() {}

    public static void renderBackground(Object graphics, Object screen) {
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
        if (graphics == null) return;
        WindowTitleManager.update();

        int width = screenWidth(graphics, screen);
        int height = screenHeight(graphics, screen);
        if (width <= 0 || height <= 0) return;

        boolean title = isTitleScreen(screen);
        if (title) {
            TitleMenuController.Layout layout = TitleMenuController.capture(screen, height);
            if (layout.supported()) {
                drawTitleScrim(graphics, width, height);
                // Forge drives every screen through render() with no mouse coords.
                TitleMenuController.render(
                    graphics,
                    screen,
                    width,
                    layout,
                    -1,
                    -1
                );
            }
        }
        drawFooter(graphics, screen, width, height);
        drawLogo(graphics, screen, width, height);
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
    }

    public static void renderTitleForeground(Object graphics, Object screen) {
        renderTitleForeground(graphics, screen, -1, -1);
    }

    public static void renderTitleForeground(Object graphics, Object screen, int mouseX, int mouseY) {
        if (graphics == null || !isTitleScreen(screen)) return;
        WindowTitleManager.update();

        int width = screenWidth(graphics, screen);
        int height = screenHeight(graphics, screen);
        if (width <= 0 || height <= 0) return;

        TitleMenuController.Layout layout = TitleMenuController.capture(screen, height);
        if (layout.supported()) {
            drawTitleScrim(graphics, width, height);
            TitleMenuController.render(
                graphics,
                screen,
                width,
                layout,
                mouseX,
                mouseY
            );
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

    public static void drawLogoAt(
        Object graphics,
        int drawX,
        int drawY,
        int drawWidth,
        int drawHeight
    ) {
        if (textureUnavailable || graphics == null) return;

        try {
            if (textureIdentifier == null) textureIdentifier = createTextureIdentifier();
            if (drawMethod == null) {
                drawMethod = findScaledDrawMethod(
                    graphics.getClass(),
                    textureIdentifier.getClass()
                );
            }

            if (drawMethod.getParameterCount() == 13) {
                if (texturePipeline == null) {
                    texturePipeline = resolveTexturePipeline(drawMethod.getParameterTypes()[0]);
                }
                drawMethod.invoke(
                    graphics,
                    texturePipeline,
                    textureIdentifier,
                    drawX,
                    drawY,
                    0.0F,
                    0.0F,
                    drawWidth,
                    drawHeight,
                    TEXTURE_WIDTH,
                    TEXTURE_HEIGHT,
                    TEXTURE_WIDTH,
                    TEXTURE_HEIGHT,
                    0xFFFFFFFF
                );
            } else {
                drawMethod.invoke(
                    graphics,
                    textureIdentifier,
                    drawX,
                    drawY,
                    drawWidth,
                    drawHeight,
                    0.0F,
                    0.0F,
                    TEXTURE_WIDTH,
                    TEXTURE_HEIGHT,
                    TEXTURE_WIDTH,
                    TEXTURE_HEIGHT
                );
            }
        } catch (ReflectiveOperationException | RuntimeException error) {
            textureUnavailable = true;
            System.err.println(
                "[Kiza Client] The logo renderer is unavailable: " + describe(error)
            );
        }
    }

    public static void drawTitleLogoAt(
        Object graphics,
        int drawX,
        int drawY,
        int drawWidth,
        int drawHeight
    ) {
        if (titleTextureUnavailable || graphics == null) return;

        try {
            if (titleTextureIdentifier == null) {
                titleTextureIdentifier = createTextureIdentifier(TITLE_TEXTURE_PATH);
            }
            if (drawMethod == null) {
                drawMethod = findScaledDrawMethod(
                    graphics.getClass(),
                    titleTextureIdentifier.getClass()
                );
            }

            if (drawMethod.getParameterCount() == 13) {
                if (texturePipeline == null) {
                    texturePipeline = resolveTexturePipeline(drawMethod.getParameterTypes()[0]);
                }
                drawMethod.invoke(
                    graphics,
                    texturePipeline,
                    titleTextureIdentifier,
                    drawX,
                    drawY,
                    0.0F,
                    0.0F,
                    drawWidth,
                    drawHeight,
                    TEXTURE_WIDTH,
                    TEXTURE_HEIGHT,
                    TEXTURE_WIDTH,
                    TEXTURE_HEIGHT,
                    0xFFFFFFFF
                );
            } else {
                drawMethod.invoke(
                    graphics,
                    titleTextureIdentifier,
                    drawX,
                    drawY,
                    drawWidth,
                    drawHeight,
                    0.0F,
                    0.0F,
                    TEXTURE_WIDTH,
                    TEXTURE_HEIGHT,
                    TEXTURE_WIDTH,
                    TEXTURE_HEIGHT
                );
            }
        } catch (ReflectiveOperationException | RuntimeException error) {
            titleTextureUnavailable = true;
            System.err.println(
                "[Kiza Client] The title logo renderer is unavailable: " + describe(error)
            );
        }
    }

    private static void drawMenuBackground(Object graphics, int width, int height) {
        if (backgroundUnavailable || graphics == null || width <= 0 || height <= 0) return;

        try {
            if (backgroundTextureIdentifier == null) {
                backgroundTextureIdentifier = createTextureIdentifier(BACKGROUND_TEXTURE_PATH);
            }
            if (drawMethod == null) {
                drawMethod = findScaledDrawMethod(
                    graphics.getClass(),
                    backgroundTextureIdentifier.getClass()
                );
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

            if (drawMethod.getParameterCount() == 13) {
                if (texturePipeline == null) {
                    texturePipeline = resolveTexturePipeline(
                        drawMethod.getParameterTypes()[0]
                    );
                }
                drawMethod.invoke(
                    graphics,
                    texturePipeline,
                    backgroundTextureIdentifier,
                    0,
                    0,
                    (float) sourceX,
                    (float) sourceY,
                    width,
                    height,
                    sourceWidth,
                    sourceHeight,
                    BACKGROUND_TEXTURE_WIDTH,
                    BACKGROUND_TEXTURE_HEIGHT,
                    0xFFFFFFFF
                );
            } else {
                drawMethod.invoke(
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
            }
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
        if (fillUnavailable) return;
        try {
            if (fillMethod == null) fillMethod = findFillMethod(graphics.getClass());
            fillMethod.invoke(graphics, left, top, right, bottom, color);
        } catch (ReflectiveOperationException | RuntimeException error) {
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
        try {
            if (textMethod == null) textMethod = findStringDrawMethod(graphics.getClass());
            Object font = findFont(screen, textMethod.getParameterTypes()[0]);
            textMethod.invoke(graphics, font, text, x, y, color, true);
        } catch (ReflectiveOperationException | RuntimeException error) {
            textUnavailable = true;
        }
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

    static Method findScaledDrawMethod(Class<?> graphicsType, Class<?> identifierType)
        throws NoSuchMethodException {
        return Arrays.stream(graphicsType.getMethods())
            .filter(method -> method.getReturnType() == void.class)
            .filter(method -> isScaledTextureMethod(method, identifierType))
            .findFirst()
            .orElseThrow(() -> new NoSuchMethodException("GUI texture draw method"));
    }

    static Method findFillMethod(Class<?> graphicsType) throws NoSuchMethodException {
        return Arrays.stream(graphicsType.getMethods())
            .filter(method -> method.getReturnType() == void.class)
            .filter(method -> {
                Class<?>[] parameters = method.getParameterTypes();
                return parameters.length == 5
                    && Arrays.stream(parameters).allMatch(parameter -> parameter == int.class);
            })
            .filter(method -> method.getName().equals("fill")
                || method.getName().equals("method_25294")
                || method.getName().equals("m_280509_"))
            .findFirst()
            .orElseThrow(() -> new NoSuchMethodException("GUI fill method"));
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

    private static boolean isScaledTextureMethod(Method method, Class<?> identifierType) {
        Class<?>[] parameters = method.getParameterTypes();
        boolean legacy = parameters.length == 11
            && parameters[0].isAssignableFrom(identifierType)
            && parameters[1] == int.class
            && parameters[2] == int.class
            && parameters[3] == int.class
            && parameters[4] == int.class
            && parameters[5] == float.class
            && parameters[6] == float.class
            && parameters[7] == int.class
            && parameters[8] == int.class
            && parameters[9] == int.class
            && parameters[10] == int.class;
        boolean modern = parameters.length == 13
            && parameters[0].getName().equals("com.mojang.blaze3d.pipeline.RenderPipeline")
            && parameters[1].isAssignableFrom(identifierType)
            && parameters[2] == int.class
            && parameters[3] == int.class
            && parameters[4] == float.class
            && parameters[5] == float.class
            && Arrays.stream(parameters, 6, 13)
                .allMatch(parameter -> parameter == int.class);
        return legacy || modern;
    }

    private static Object resolveTexturePipeline(Class<?> pipelineType)
        throws ReflectiveOperationException {
        ReflectiveOperationException lastFailure = null;
        for (String className : new String[] {
            "net.minecraft.client.gl.RenderPipelines",
            "net.minecraft.class_10799"
        }) {
            try {
                Class<?> pipelines = Class.forName(className);
                for (String fieldName : new String[] {"GUI_TEXTURED", "field_56883"}) {
                    try {
                        Field field = pipelines.getDeclaredField(fieldName);
                        if (!Modifier.isStatic(field.getModifiers())
                            || !pipelineType.isAssignableFrom(field.getType())) {
                            continue;
                        }
                        field.setAccessible(true);
                        Object pipeline = field.get(null);
                        if (pipeline != null) return pipeline;
                    } catch (NoSuchFieldException error) {
                        lastFailure = error;
                    }
                }
            } catch (ClassNotFoundException error) {
                lastFailure = error;
            }
        }
        throw lastFailure != null
            ? lastFailure
            : new NoSuchFieldException("GUI textured render pipeline");
    }

    private static Object createTextureIdentifier() throws ReflectiveOperationException {
        return createTextureIdentifier(TEXTURE_PATH);
    }

    private static Object createTextureIdentifier(String texturePath)
        throws ReflectiveOperationException {
        ReflectiveOperationException lastFailure = null;
        for (String className : new String[] {
            "net.minecraft.resources.ResourceLocation",
            "net.minecraft.class_2960"
        }) {
            try {
                return createTextureIdentifier(Class.forName(className), texturePath);
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
            + (message == null || message.isBlank() ? "" : " - " + message);
    }

    private static Object createTextureIdentifier(
        Class<?> identifierType,
        String texturePath
    )
        throws ReflectiveOperationException {
        for (Constructor<?> constructor : identifierType.getDeclaredConstructors()) {
            Class<?>[] parameters = constructor.getParameterTypes();
            if (Arrays.equals(parameters, new Class<?>[] {String.class, String.class})) {
                constructor.setAccessible(true);
                return constructor.newInstance(NAMESPACE, texturePath);
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
                Object identifier = method.invoke(null, NAMESPACE, texturePath);
                if (identifier != null) return identifier;
            }
            if (Arrays.equals(parameters, new Class<?>[] {String.class})) {
                Object identifier = method.invoke(null, NAMESPACE + ":" + texturePath);
                if (identifier != null) return identifier;
            }
        }

        throw new NoSuchMethodException("Minecraft texture identifier factory");
    }
}
