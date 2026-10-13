package fr.kiza.basemod;

import fr.kiza.basemod.menu.Buttons;
import fr.kiza.basemod.menu.ClientSettings;
import fr.kiza.basemod.menu.MenuDesign;
import fr.kiza.basemod.render.StreamingTexture;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Minecraft's loading screen, Kiza's.
 *
 * <p>How it loads is not touched: the screen keeps its own logic and its fade
 * into the title screen -- code that finishes the game's start, which a screen
 * drawn in its place would have to copy for every version. What it shows is
 * changed:
 *
 * <ul>
 *   <li>its background colour, Mojang's red, read through one
 *       {@code IntSupplier} in every version the Kiza menu runs on, is
 *       answered with Kiza's dark violet, its alpha kept, so the fade works as
 *       before ({@link #background});</li>
 *   <li>its Mojang logo is drawn from a texture now empty, and its progress
 *       bar is not drawn ({@link #hidesProgressBar});</li>
 *   <li>over it, Kiza draws the title screen's own emblem and "Kiza Client",
 *       and a hairline of progress under them ({@link #afterOverlay}).</li>
 * </ul>
 *
 * <h2>The motion</h2>
 *
 * <p>The emblem rises into the middle of the screen as it appears, the name
 * a beat after it, the progress line drawing out from its centre a beat
 * after that. When the game has loaded, the line folds away, and the emblem
 * and the name travel up to the very place the title screen draws them, at
 * the size it draws them. The screen's own fade then shows the menu under
 * them, the title screen leaving its emblem undrawn while this one is there
 * ({@link #handingOver}), and taking over at the same spot when it is gone.
 * Every move is a critically damped spring, started from wherever the thing
 * is: nothing was thrown, so nothing bounces. With the client's opening
 * animations off, it all only fades.
 *
 * <p>Called from the loading screen's own drawing (a mixin on Fabric, a
 * rewritten method under the Vanilla agent). Nothing here may stop the game
 * from starting: the first failure is said once and the screen is left as
 * Mojang made it.
 */
public final class KizaLoading {
    /** Kiza's dark violet. */
    static final int BACKGROUND = 0x0E0B16;
    /** The progress line: its track, and how tall it is in GUI pixels. */
    private static final int TRACK = 0x22FFFFFF;
    private static final int LINE = 2;

    private static boolean failed;
    private static boolean logoHidden;

    /** The loading screen being drawn, and when it opened. */
    private static Object shownFor;
    private static long openedAt;
    private static long drawnAt;
    private static long lastFrame;
    private static boolean handing;
    /** Seconds into the fade-out when the title screen's layout was first known, and when the two arrived; -1 before. */
    private static float handoffFrom = -1F;
    private static float arrivedAt = -1F;

    private static final Spring emblemCentreX = new Spring();
    private static final Spring emblemTop = new Spring();
    private static final Spring emblemSize = new Spring();
    private static final Spring nameTop = new Spring();
    private static final Spring nameHeight = new Spring();

    /** Where the title screen last laid its emblem out: x, y, size, name's y, centre, screen width, height. */
    private static volatile int[] titleLayout;

    /** The time, in nanoseconds: the system's, or a preview's that moves a frame at a time. */
    static java.util.function.LongSupplier clock = System::nanoTime;

    private KizaLoading() {}

    /** Whether the Kiza loading screen is wanted: on unless turned off in the client settings. */
    public static boolean enabled() {
        return !failed && ClientSettings.flag("menu.loading-screen");
    }

    // ---- What the loading screen asks ------------------------------------------

    /**
     * The loading screen's background colour: Kiza's, with the alpha the
     * screen asked for. The first time, the screen's logo is emptied.
     */
    public static int background(Object overlay, int colour) {
        try {
            if (!enabled()) return colour;
            if (!logoHidden) {
                logoHidden = true;
                hideLogo(overlay);
            }
            return (colour & 0xFF000000) | BACKGROUND;
        } catch (Throwable error) {
            fail(error);
            return colour;
        }
    }

    /** Whether the screen's own progress bar is to be skipped: Kiza draws its own. */
    public static boolean hidesProgressBar() {
        return enabled();
    }

    /** Draws Kiza's logo, name and progress over what the loading screen drew this frame. */
    public static void afterOverlay(Object overlay, Object graphics) {
        if (!enabled() || overlay == null || graphics == null) return;
        try {
            draw(overlay, graphics, MenuLogoRenderer.screenWidth(graphics, null), MenuLogoRenderer.screenHeight(graphics, null));
        } catch (Throwable error) {
            fail(error);
        }
    }

    /**
     * Whether the loading screen is drawing the emblem where the title screen
     * would: the title screen leaves its own undrawn meanwhile.
     */
    public static boolean handingOver() {
        return handing && clock.getAsLong() - drawnAt < 150_000_000L;
    }

    /** Where the title screen lays its emblem out, for the loading screen to bring its own there. */
    public static void titleLaidOut(int emblemX, int emblemY, int size, int nameY, int centreX, int width, int height) {
        titleLayout = new int[] {emblemX, emblemY, size, nameY, centreX, width, height};
    }

    private static void fail(Throwable error) {
        failed = true;
        handing = false;
        System.err.println("[Kiza Client] The Kiza loading screen is off: " + error);
    }

    // ---- Drawing ----------------------------------------------------------------

    static void draw(Object overlay, Object graphics, int width, int height) throws ReflectiveOperationException {
        if (width <= 0 || height <= 0) return;
        long now = clock.getAsLong();
        OverlayState state = OverlayState.of(overlay);
        boolean motion = ClientSettings.flag("menu.animations");

        // Where the two rest while the game loads: in the middle, larger than
        // on the title screen, the line under them.
        int stageSize = Math.max(MenuDesign.EMBLEM_MIN, Math.min(Math.round(MenuDesign.EMBLEM_SIZE * 1.25F), height * 28 / 100));
        int stageName = Math.max(10, Math.round(stageSize * MenuDesign.WORDMARK_SIZE / (float) MenuDesign.EMBLEM_SIZE));
        int gap = Math.max(4, stageSize * MenuDesign.EMBLEM_GAP / MenuDesign.EMBLEM_SIZE);
        int lineGap = Math.max(10, stageName * 3 / 4);
        int stack = stageSize + gap + stageName + lineGap + LINE;
        int stageTop = (height - stack) / 2 - height / 40;
        int centreX = width / 2;

        if (overlay != shownFor) {
            // A new screen -- the game's start, or a resource reload -- begins
            // where it rests, with nothing in flight from the last one.
            shownFor = overlay;
            openedAt = now;
            lastFrame = now;
            handing = false;
            handoffFrom = -1F;
            arrivedAt = -1F;
            emblemCentreX.reset(centreX);
            emblemTop.reset(stageTop);
            emblemSize.reset(stageSize);
            nameTop.reset(stageTop + stageSize + gap);
            nameHeight.reset(stageName);
        }
        float dt = Math.min(0.1F, (now - lastFrame) / 1e9F);
        lastFrame = now;
        drawnAt = now;
        float t = (now - openedAt) / 1e9F;
        float done = state.fadeOutSeconds();

        // The hand-off, once the game has loaded and the title screen is next:
        // the line folds away first (0.25 s), then the two travel up, easing
        // out of the middle and into their place (0.65 s, a third of the
        // screen), a short spring behind the path taking any change of
        // destination -- the title screen laying itself out -- without a jump.
        int[] target = done >= 0F && motion ? titleTarget(width, height) : null;
        handing = target != null;
        // Timed from when the destination is known, never before: known late,
        // the journey would otherwise be over already and made in a blink.
        if (handing && handoffFrom < 0F) handoffFrom = Math.max(0.3F, done);
        float travel = handing ? easeInOut(clamp((done - handoffFrom) / 0.65F)) : 0F;
        if (travel >= 1F && arrivedAt < 0F) arrivedAt = done;
        float stageNameTop = stageTop + stageSize + gap;
        emblemCentreX.toward(between(centreX, handing ? target[4] : centreX, travel), dt, 0.18F);
        emblemTop.toward(between(stageTop, handing ? target[1] : stageTop, travel), dt, 0.18F);
        emblemSize.toward(between(stageSize, handing ? target[2] : stageSize, travel), dt, 0.18F);
        nameTop.toward(between(stageNameTop, handing ? target[3] : stageNameTop, travel), dt, 0.18F);
        nameHeight.toward(between(stageName, handing ? MenuDesign.WORDMARK_SIZE : stageName, travel), dt, 0.18F);

        // Arrival: the emblem first, the name a beat after, rising as they come.
        float emblemIn = motion ? spring(t, 0.5F) : clamp(t / 0.3F);
        float nameIn = motion ? spring(t - 0.12F, 0.5F) : clamp(t / 0.3F);
        // Without a hand-off, the two go with the screen's own fade.
        float leaving = handing || done < 1F ? 1F : 1F - clamp(done - 1F);
        int emblemRise = motion ? Math.round((1F - emblemIn) * 12F) : 0;
        int nameRise = motion ? Math.round((1F - nameIn) * 12F) : 0;

        // Behind it, its glow: arriving a beat after it, then breathing, so
        // slowly it is felt more than seen, while the game loads.
        int glow = motion && done < 0F
            ? Math.round(clamp((t - 0.1F) / 0.5F) * (1.5F + 0.5F * (float) Math.sin(t * Math.PI * 2D / 4D)))
            : 0;
        // Arrived, the two are drawn from the title screen's own textures, at
        // its own size: when it takes over, not a pixel changes.
        // The title screen's own brought in over them in 0.15 s, so even the
        // last pixel of difference does not jump; under it, the first stay
        // whole until it is, or the two together would thin out half way.
        float own = handing && arrivedAt >= 0F ? clamp((done - arrivedAt) / 0.15F) : 0F;
        int sweep = motion && done < 0F ? sweepStep(t) : 0;
        if (own < 1F) {
            drawEmblem(graphics, emblemCentreX.value, emblemTop.value + emblemRise, emblemSize.value, stageSize,
                emblemIn * leaving, glow, sweep);
            drawName(graphics, emblemCentreX.value, nameTop.value + nameRise, nameHeight.value, stageName,
                nameIn * leaving);
        }
        if (own > 0F) drawAsTitle(graphics, target, own);

        // The line: drawn out from its centre, filled as the game loads,
        // folded away once it has.
        float lineIn = motion ? spring(t - 0.25F, 0.6F) : clamp(t / 0.3F);
        // Leaving is quicker than arriving, and gathers speed as it goes.
        float lineOut = done < 0F ? 1F : 1F - (motion ? power2In(clamp(done / 0.25F)) : clamp(done / 0.25F));
        float line = lineIn * lineOut;
        if (line > 0.01F) {
            int lineWidth = Math.round(stageSize * 1.35F * line);
            int lineY = stageTop + stageSize + gap + stageName + lineGap;
            int left = centreX - lineWidth / 2;
            int alpha = Math.round(line * 255F);
            MenuLogoRenderer.fill(graphics, left, lineY, left + lineWidth, lineY + LINE, withAlpha(TRACK, alpha));
            int filled = Math.round(lineWidth * clamp(state.progress()));
            int colour = ClientSettings.accent().to;
            MenuLogoRenderer.fill(graphics, left, lineY, left + filled, lineY + LINE, withAlpha(colour, alpha));
        }
    }

    /** The emblem, placed by its centre and top, from the texture made at the stage's size. */
    private static void drawEmblem(Object graphics, float centreX, float top, float size, int textureSize, float opacity, int glow, int sweep) {
        if (opacity <= 0.01F) return;
        Object texture = opacity >= 0.999F
            ? Buttons.emblem(textureSize, Buttons.FADE_STEPS, glow, sweep)
            : Buttons.emblemFaded(textureSize, opacity);
        if (texture == null) return;
        // The texture carries a margin for the glow; it scales with the emblem.
        float pad = Buttons.EMBLEM_GLOW * size / textureSize;
        int scale = Buttons.supersample();
        int drawn = Math.round(size + pad * 2F);
        int texturePixels = (textureSize + Buttons.EMBLEM_GLOW * 2) * scale;
        MenuLogoRenderer.blitTexture(graphics, texture, Math.round(centreX - drawn / 2F), Math.round(top - pad),
            drawn, drawn, texturePixels, texturePixels);
    }

    /**
     * The emblem and the name exactly as the title screen draws them --
     * its textures, its whole-pixel sums -- so taking over moves nothing.
     */
    private static void drawAsTitle(Object graphics, int[] target, float opacity) {
        int scale = Buttons.supersample();
        int size = target[2];
        Object emblem = opacity >= 0.999F ? Buttons.emblem(size, Buttons.FADE_STEPS, 0, 0) : Buttons.emblemFaded(size, opacity);
        if (emblem != null) {
            int pad = Buttons.EMBLEM_GLOW;
            int drawn = size + pad * 2;
            MenuLogoRenderer.blitTexture(graphics, emblem, target[0] - pad, target[1] - pad, drawn, drawn, drawn * scale, drawn * scale);
        }
        int[] measured = new int[2];
        Object name = Buttons.wordmarkFaded(MenuDesign.WORDMARK_SIZE, opacity, measured);
        if (name != null) {
            int w = measured[0] / scale;
            int h = measured[1] / scale;
            MenuLogoRenderer.blitTexture(graphics, name, target[4] - w / 2, target[3] - Buttons.WORDMARK_PAD, w, h, measured[0], measured[1]);
        }
    }

    /** "Kiza Client" under the emblem, made at the stage's size and drawn at {@code height}. */
    private static void drawName(Object graphics, float centreX, float top, float height, int textureHeight, float opacity) {
        if (opacity <= 0.01F) return;
        int[] size = new int[2];
        Object texture = Buttons.wordmarkFaded(textureHeight, opacity, size);
        if (texture == null) return;
        int scale = Buttons.supersample();
        float ratio = height / textureHeight;
        int w = Math.round(size[0] / (float) scale * ratio);
        int h = Math.round(size[1] / (float) scale * ratio);
        MenuLogoRenderer.blitTexture(graphics, texture, Math.round(centreX - w / 2F),
            Math.round(top - Buttons.WORDMARK_PAD * ratio), w, h, size[0], size[1]);
    }

    /** The light across the emblem while it waits: once every three seconds, from 1.2 s. */
    private static int sweepStep(float t) {
        if (t < 1.2F) return 0;
        float within = (t - 1.2F) % 3.0F;
        if (within > 0.8F) return 0;
        return 1 + Math.min(Buttons.SWEEP_STEPS - 1, Math.round(power2InOut(within / 0.8F) * (Buttons.SWEEP_STEPS - 1)));
    }

    /**
     * Where the title screen will draw its emblem: as it last laid it out for
     * a window this size, or as it lays out Minecraft's own buttons; null when
     * the screen to come is not the title screen.
     */
    private static int[] titleTarget(int width, int height) {
        Object screen = MenuLogoRenderer.activeScreen();
        if (screen != null && !MenuLogoRenderer.isTitleScreen(screen)) return null;
        int[] laid = titleLayout;
        if (laid != null && laid[5] == width && laid[6] == height) return laid;
        if (screen == null) return null;
        List<MenuDesign.Role> roles = new ArrayList<MenuDesign.Role>();
        for (String label : Arrays.asList("Singleplayer", "Multiplayer", "Minecraft Realms", "Mods", "Options...", "Quit Game")) {
            roles.add(MenuDesign.roleOf(null, label));
        }
        MenuDesign.Plan plan = MenuDesign.plan(roles, width, height);
        if (plan == null) return null;
        return new int[] {plan.emblemX, plan.emblemY, plan.emblemSize, plan.wordmarkY, plan.centreX, width, height};
    }

    private static void hideLogo(Object overlay) throws IllegalAccessException {
        Object name = logoName(overlay == null ? null : overlay.getClass());
        if (name == null) return;
        StreamingTexture empty = StreamingTexture.create("loading_logo", name, 16, 16);
        if (empty != null) empty.write(new int[16 * 16]);
    }

    /**
     * The name the logo's texture is registered under: of the loading
     * screen's static fields, the one holding a texture name. There is one.
     */
    private static Object logoName(Class<?> overlayType) throws IllegalAccessException {
        for (Class<?> type = overlayType; type != null && type != Object.class; type = type.getSuperclass()) {
            for (Field field : type.getDeclaredFields()) {
                if (!Modifier.isStatic(field.getModifiers())) continue;
                String name = field.getType().getName();
                if (!name.endsWith("ResourceLocation") && !name.endsWith("Identifier") && !name.endsWith("class_2960")) continue;
                field.setAccessible(true);
                Object value = field.get(null);
                if (value != null) return value;
            }
        }
        return null;
    }

    // ---- The loading screen's state ---------------------------------------------

    /**
     * What the loading screen knows, read from its fields by their shape --
     * the names change with every release, the shape has not: one float, the
     * progress as it shows it; one boolean, whether it fades in (a reload);
     * two longs, when it began fading in and out, -1 until it does.
     */
    static final class OverlayState {
        private static Class<?> knownType;
        private static Field progress;
        private static Field fadeIn;
        private static Field[] times;

        private final Object overlay;

        private OverlayState(Object overlay) {
            this.overlay = overlay;
        }

        static OverlayState of(Object overlay) {
            Class<?> type = overlay.getClass();
            if (type != knownType) {
                knownType = type;
                progress = null;
                fadeIn = null;
                List<Field> longs = new ArrayList<Field>();
                for (Class<?> cursor = type; cursor != null && cursor != Object.class; cursor = cursor.getSuperclass()) {
                    for (Field field : cursor.getDeclaredFields()) {
                        if (Modifier.isStatic(field.getModifiers())) continue;
                        field.setAccessible(true);
                        if (field.getType() == float.class && progress == null) progress = field;
                        else if (field.getType() == boolean.class && fadeIn == null) fadeIn = field;
                        else if (field.getType() == long.class) longs.add(field);
                    }
                }
                times = longs.toArray(new Field[0]);
            }
            return new OverlayState(overlay);
        }

        /** How far the game has loaded, as the screen shows it, 0 to 1. */
        float progress() {
            try {
                return progress == null ? 0F : progress.getFloat(overlay);
            } catch (IllegalAccessException unreadable) {
                return 0F;
            }
        }

        /**
         * Seconds since the screen began to fade out, or -1 before. Which of
         * the two times that is: the later one when it fades in as well, the
         * only one set when it does not.
         */
        float fadeOutSeconds() {
            try {
                long first = -1L;
                long second = -1L;
                for (Field field : times) {
                    long value = field.getLong(overlay);
                    if (value < 0L) continue;
                    if (first < 0L) first = value;
                    else second = value;
                }
                // Fading in, the first time set is the fade-in's: no fade-out until a second.
                boolean fadesIn = fadeIn != null && fadeIn.getBoolean(overlay);
                long fadeOut = fadesIn && second < 0L ? -1L : Math.max(first, second);
                if (fadeOut < 0L) return -1F;
                // The screen's clock: Minecraft's Util.getMillis, nanoTime in milliseconds.
                return (clock.getAsLong() / 1_000_000L - fadeOut) / 1000F;
            } catch (IllegalAccessException unreadable) {
                return -1F;
            }
        }
    }

    // ---- Motion -----------------------------------------------------------------

    /**
     * A value that moves toward where it is sent on a critically damped
     * spring, keeping its speed when it is sent elsewhere on the way.
     */
    static final class Spring {
        float value;
        float velocity;

        void reset(float to) {
            value = to;
            velocity = 0F;
        }

        /** One step of {@code dt} seconds toward {@code target}, {@code response} seconds being how quickly. */
        void toward(float target, float dt, float response) {
            if (dt <= 0F) return;
            double omega = 2D * Math.PI / response;
            double offset = value - target;
            double decay = Math.exp(-omega * dt);
            double carried = velocity + omega * offset;
            value = (float) (target + (offset + carried * dt) * decay);
            velocity = (float) ((velocity - carried * omega * dt) * decay);
        }
    }

    /** A critically damped spring from 0 to 1 started at t = 0, {@code response} seconds being how quickly. */
    static float spring(float t, float response) {
        if (t <= 0F) return 0F;
        double omega = 2D * Math.PI / response;
        return (float) (1D - (1D + omega * t) * Math.exp(-omega * t));
    }

    private static float power2In(float x) {
        return x * x;
    }

    /** Material's standard curve, (0.4, 0, 0.2, 1) near enough: out of rest and into it. */
    private static float easeInOut(float x) {
        return x < 0.5F ? 4F * x * x * x : 1F - (float) Math.pow(-2F * x + 2F, 3D) / 2F;
    }

    private static float between(float from, float to, float amount) {
        return from + (to - from) * amount;
    }

    private static float power2InOut(float x) {
        return x < 0.5F ? 2F * x * x : 1F - (float) Math.pow(-2F * x + 2F, 2D) / 2F;
    }

    private static float clamp(float value) {
        return Math.max(0F, Math.min(1F, value));
    }

    private static int withAlpha(int colour, int alpha) {
        int base = (colour >>> 24) == 0 ? 255 : colour >>> 24;
        return (Math.min(255, base * alpha / 255) << 24) | (colour & 0xFFFFFF);
    }
}
