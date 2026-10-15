package fr.kiza.basemod;

import fr.kiza.basemod.menu.Buttons;
import fr.kiza.basemod.menu.ClientSettings;
import fr.kiza.basemod.menu.ClientText;
import fr.kiza.basemod.menu.MenuDesign;
import fr.kiza.basemod.render.KizaCanvas;
import fr.kiza.basemod.render.StreamingTexture;
import java.awt.image.BufferedImage;
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

    private static boolean failed;
    private static boolean logoHidden;

    /** The loading screen being drawn, and when its pictures were up and it began to move. */
    private static Object shownFor;
    private static long openedAt;
    private static boolean opened;
    private static Pictures pictures;
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
    /** What the screen did, said once in the log as it goes: frames drawn, the bar's strongest, the progress reached. */
    private static int framesDrawn;
    private static float barShown;
    private static float progressReached;
    private static boolean reported;
    private static String placed = "";

    /** The progress the line shows: the screen's, followed on a spring and never backwards. */
    private static final Spring shownProgress = new Spring();

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
     * Over a loader's own loading screen -- Forge's or NeoForge's, which shows
     * its early window in place of Mojang's and asks no colour: Kiza's
     * background first, going with the screen's fade, then the rest.
     */
    public static void overLoaderScreen(Object overlay, Object graphics) {
        if (!enabled() || overlay == null || graphics == null) return;
        try {
            // Already drawn this frame, through Mojang's screen under it.
            if (overlay == shownFor && clock.getAsLong() - drawnAt < 1_000_000L) return;
            int width = MenuLogoRenderer.screenWidth(graphics, null);
            int height = MenuLogoRenderer.screenHeight(graphics, null);
            float done = OverlayState.of(overlay).fadeOutSeconds();
            float opacity = done < 1F ? 1F : 1F - clamp(done - 1F);
            if (opacity > 0F) MenuLogoRenderer.fill(graphics, 0, 0, width, height, (Math.round(opacity * 255F) << 24) | BACKGROUND);
            draw(overlay, graphics, width, height);
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

    /*
     * Every frame is drawn from the time alone: places and sizes in fractions
     * of a pixel, opacities by the GPU, out of pictures painted once, off the
     * render thread, each a layer of its own -- the light behind, the emblem,
     * its halo, the light that crosses it, the name, the words, the bar.
     * Nothing is chosen among pre-faded copies, so nothing steps or flickers
     * from one frame to the next, and nothing is painted while it moves.
     */

    /** The words' colours: the subtitle and the percentage as the buttons' labels, the status a step back. */
    private static final int SOFT = 0xFFC9C5D6;
    private static final int DIM = 0xFF8E8A9C;
    private static final String DIGITS = "0123456789%";

    static void draw(Object overlay, Object graphics, int width, int height) throws ReflectiveOperationException {
        if (width <= 0 || height <= 0) return;
        long now = clock.getAsLong();
        OverlayState state = OverlayState.of(overlay);
        boolean motion = ClientSettings.flag("menu.animations");

        // The stack, in the middle, a little above it: the emblem, the name,
        // what is being prepared, the bar and its percentage, what it is doing.
        int rest = Math.round(MenuDesign.EMBLEM_SIZE * 1.2F);
        int stageSize = Math.max(MenuDesign.EMBLEM_MIN, Math.min(rest, height * 26 / 100));
        float u = stageSize / (float) rest;
        int stageName = Math.max(10, Math.round(stageSize * 0.34F));
        int gap = Math.max(4, Math.round(8 * u));
        int subtitleSize = Math.max(7, Math.round(11 * u));
        int subtitleGap = Math.max(3, Math.round(5 * u));
        int barGap = Math.max(8, Math.round(14 * u));
        int barHeight = Math.max(5, Math.round(9 * u));
        int barWidth = Math.min(Math.round(stageSize * 2.8F), width * 7 / 10);
        int statusGap = Math.max(3, Math.round(6 * u));
        int statusSize = Math.max(6, Math.round(8 * u));
        int percentSize = Math.max(7, Math.round(10 * u));
        int stack = stageSize + gap + stageName + subtitleGap + subtitleSize + 4 + barGap + barHeight + statusGap + statusSize + 4;
        int stageTop = (height - stack) / 2 - height / 40;
        int centreX = width / 2;
        float stageNameTop = stageTop + stageSize + gap;
        float subtitleTop = stageNameTop + stageName + subtitleGap;
        float barTop = subtitleTop + subtitleSize + 4 + barGap;
        float statusTop = barTop + barHeight + statusGap;
        String layout = stageSize + "|" + stageName + "|" + subtitleSize + "|" + barHeight + "|" + statusSize + "|"
            + percentSize + "|" + Buttons.supersample() + "|" + ClientText.get("kiza.loading.subtitle");

        if (overlay != shownFor) {
            // A new screen -- the game's start, or a resource reload -- begins
            // where it rests, with nothing in flight from the last one.
            shownFor = overlay;
            opened = false;
            handing = false;
            handoffFrom = -1F;
            arrivedAt = -1F;
            emblemCentreX.reset(centreX);
            emblemTop.reset(stageTop);
            emblemSize.reset(stageSize);
            nameTop.reset(stageNameTop);
            nameHeight.reset(stageName);
            shownProgress.reset(0F);
            framesDrawn = 0;
            barShown = 0F;
            progressReached = 0F;
            reported = false;
            if (pictures == null || !pictures.layout.equals(layout)) {
                pictures = Pictures.paint(layout, stageSize, stageName, subtitleSize, barHeight, statusSize, percentSize,
                    Buttons.supersample(), plannedTitleSize(width, height), (stageTop + stageSize / 2F) / height);
            }
        }
        pictures.sendUp(opened ? 3 : 32);
        if (!opened) lastFrame = now;
        drawnAt = now;
        // Until its pictures are up the screen is its colour alone: the
        // motion begins with them, so it is never cut short by a frame painting.
        if (!pictures.ready()) return;
        // When the game draws a frame a second or less -- the render thread
        // busy with the load, as on Fabric with many mods -- nothing can be
        // seen moving: the screen is shown as it is once arrived, and the bar
        // as far as the game is.
        boolean stalled = pictures.tookOver || (opened && now - lastFrame > 250_000_000L);
        if (!opened) {
            opened = true;
            openedAt = now;
        }
        if (stalled) {
            openedAt = Math.min(openedAt, now - 3_000_000_000L);
            shownProgress.reset(Math.max(shownProgress.value, clamp(state.progress())));
            pictures.tookOver = false;
        }
        float dt = Math.min(0.1F, (now - lastFrame) / 1e9F);
        lastFrame = now;
        float t = (now - openedAt) / 1e9F;
        float done = state.fadeOutSeconds();
        // The screen's own fade into the title screen, 1 s after loading: what
        // is behind the stack goes with it.
        float screen = done < 1F ? 1F : 1F - clamp(done - 1F);

        // The hand-off, once the game has loaded and the title screen is next:
        // the bar and the words go first (a quarter of a second), then the
        // emblem and the name travel up, easing out of the middle and into
        // their place (0.65 s, a third of the screen), a short spring behind
        // the path taking any change of destination without a jump.
        int[] target = done >= 0F && motion ? titleTarget(width, height) : null;
        handing = target != null;
        if (handing) pictures.prepareTitle(target[2], false);
        // Timed from when the destination is known, never before: known late,
        // the journey would otherwise be over already and made in a blink.
        if (handing && handoffFrom < 0F) handoffFrom = Math.max(0.3F, done);
        float travel = handing ? easeInOut(clamp((done - handoffFrom) / 0.65F)) : 0F;
        emblemCentreX.toward(between(centreX, handing ? target[4] : centreX, travel), dt, 0.18F);
        emblemTop.toward(between(stageTop, handing ? target[1] : stageTop, travel), dt, 0.18F);
        emblemSize.toward(between(stageSize, handing ? target[2] : stageSize, travel), dt, 0.18F);
        nameTop.toward(between(stageNameTop, handing ? target[3] : stageNameTop, travel), dt, 0.18F);
        nameHeight.toward(between(stageName, handing ? MenuDesign.WORDMARK_SIZE : stageName, travel), dt, 0.18F);
        // Arrived when the path is over and the springs have caught up with
        // it, to a tenth of a pixel: the title screen's own are then drawn in
        // exactly over them.
        if (handing && travel >= 1F && arrivedAt < 0F
            && Math.abs(emblemTop.value - target[1]) < 0.1F
            && Math.abs(emblemSize.value - target[2]) < 0.1F
            && Math.abs(emblemCentreX.value - target[4]) < 0.1F
            && Math.abs(nameTop.value - target[3]) < 0.1F
            && Math.abs(nameHeight.value - MenuDesign.WORDMARK_SIZE) < 0.05F) {
            arrivedAt = done;
        }

        // Arrival, one after another inside 0.36 s, each on a critically
        // damped spring: rising into place as it appears, the emblem growing
        // the last few percent. Without motion, only fades.
        float emblemIn = arrive(motion, t, 0F);
        float nameIn = arrive(motion, t, 0.10F);
        float subtitleIn = arrive(motion, t, 0.20F);
        float barIn = motion ? spring(t - 0.28F, 0.6F) : clamp(t / 0.3F);
        float detailIn = arrive(motion, t, 0.36F);
        // Without a hand-off, the two go with the screen's own fade.
        float leaving = handing ? 1F : screen;
        float grow = motion ? 0.94F + 0.06F * emblemIn : 1F;

        // Leaving is quicker than arriving, and gathers speed: the status and
        // the percentage first, the bar folding to its centre, the subtitle.
        float detailOut = done < 0F ? 1F : 1F - power2In(clamp(done / 0.18F));
        float barOut = done < 0F ? 1F : 1F - power2In(clamp((done - 0.04F) / 0.24F));
        float subtitleOut = done < 0F ? 1F : 1F - power2In(clamp((done - 0.06F) / 0.22F));

        // Behind it all, the accent's light pooled behind the emblem, coming
        // up slowly and breathing slower still; it goes with the screen.
        float backdropIn = motion ? easeOut(clamp(t / 0.9F)) : clamp(t / 0.3F);
        float backdropBreath = motion ? 0.92F + 0.08F * (float) Math.sin(t * Math.PI * 2D / 7D) : 1F;
        pictures.drawBackdrop(graphics, width, height, backdropIn * backdropBreath * screen);

        // The halo: a beat after the emblem, then breathing, so slowly it is
        // felt more than seen; gone in a third of a second once loaded, the
        // title screen's emblem having none.
        float haloIn = motion ? spring(t - 0.15F, 0.8F) : 0F;
        float breath = 0.5F + 0.5F * (float) Math.sin(t * Math.PI * 2D / 4.5D);
        float haloOut = done < 0F ? 1F : 1F - easeOut(clamp(done / 0.35F));
        float halo = haloIn * (0.40F + 0.16F * breath) * haloOut * leaving;

        // The light across it, every 3.2 s from 1.2 s, rising and fading at
        // its two ends so it never appears or goes at once; let go in a fifth
        // of a second once loaded.
        float light = 0F;
        float across = 0F;
        if (motion && t >= 1.2F) {
            float within = ((t - 1.2F) % 3.2F) / 0.9F;
            if (within < 1F) {
                across = power2InOut(within);
                light = (float) Math.sin(Math.PI * within) * (done < 0F ? 1F : 1F - clamp(done / 0.2F));
            }
        }

        // The title screen's own brought in over them in 0.2 s, so even the
        // last pixel of difference does not jump. Under it, the first stay
        // whole for half of it -- the two together would thin out otherwise --
        // then go, so that nothing of them is left when it is done.
        float own = handing && arrivedAt >= 0F ? easeOut(clamp((done - arrivedAt) / 0.2F)) : 0F;
        float under = 1F - clamp((own - 0.5F) / 0.5F);
        if (under > 0F) {
            float size = emblemSize.value * grow;
            float top = emblemTop.value + rise(motion, emblemIn, 10F * u) + (emblemSize.value - size) / 2F;
            pictures.drawEmblem(graphics, emblemCentreX.value, top, size, emblemIn * leaving * under, halo,
                light * emblemIn * leaving, across);
            pictures.drawName(graphics, emblemCentreX.value, nameTop.value + rise(motion, nameIn, 10F * u), nameHeight.value,
                nameIn * leaving * under);
        }
        if (own > 0F) drawAsTitle(graphics, target, own);

        float subtitle = subtitleIn * subtitleOut * leaving;
        pictures.drawSubtitle(graphics, centreX, subtitleTop + rise(motion, subtitleIn, 6F * u)
            - (1F - subtitleOut) * 4F * u, subtitle);

        // The bar: drawn out from its centre, filled as the game loads,
        // folded back to it once loaded. The progress the screen gives is
        // followed on a spring, and never goes back.
        shownProgress.toward(Math.max(shownProgress.value, clamp(state.progress())), dt, 0.35F);
        float bar = barIn * barOut * leaving;
        framesDrawn += 1;
        barShown = Math.max(barShown, bar);
        progressReached = Math.max(progressReached, state.progress());
        placed = "bar " + barWidth + "x" + barHeight + " at y " + Math.round(barTop) + " of " + width + "x" + height;
        float barLeft = centreX - barWidth / 2F;
        if (bar > 0.004F) {
            float trackWidth = Math.max(barHeight, barWidth * barIn * barOut);
            pictures.drawTrack(graphics, centreX - trackWidth / 2F, barTop, trackWidth, barHeight, bar);
            float inset = Math.max(1F, barHeight * 0.2F);
            float fillHeight = barHeight - inset * 2F;
            float room = trackWidth - inset * 2F;
            float filled = room * clamp(shownProgress.value);
            if (filled > 0.05F) {
                pictures.drawFill(graphics, centreX - trackWidth / 2F + inset, barTop + inset, Math.max(fillHeight, filled),
                    fillHeight, bar * clamp(filled / fillHeight));
            }
        }

        // Beside it, how far; under it, what it is doing.
        float detail = detailIn * detailOut * leaving;
        float detailRise = rise(motion, detailIn, 4F * u);
        pictures.drawPercent(graphics, barLeft + barWidth + Math.max(4F, 7F * u),
            barTop + barHeight / 2F - (percentSize + 4) / 2F + detailRise, Math.round(clamp(shownProgress.value) * 100F), detail);
        pictures.drawStatus(graphics, centreX, statusTop + detailRise, detail);
        // At two seconds the screen takes itself away, this frame: from the
        // next, the title screen draws its own emblem, with nothing between.
        if (done >= 2F) {
            handing = false;
            if (!reported) {
                reported = true;
                System.out.println("[Kiza Client] Loading screen: " + framesDrawn + " frames, bar " + Math.round(barShown * 100F)
                    + "%, progress " + Math.round(progressReached * 100F) + "%, " + placed + ", " + pictures.describe()
                    + ", draws refused " + MenuLogoRenderer.smoothRefused());
            }
        }
    }

    /** How far something has arrived, {@code delay} seconds after the screen began: a spring, or a fade. */
    private static float arrive(boolean motion, float t, float delay) {
        return motion ? spring(t - delay, 0.55F) : clamp((t - delay) / 0.3F);
    }

    /** How far below its place something still is, as it arrives: {@code by} pixels at first, none once there. */
    private static float rise(boolean motion, float arrived, float by) {
        return motion ? (1F - arrived) * by : 0F;
    }

    /**
     * The emblem and the name exactly as the title screen draws them --
     * its textures, its whole-pixel sums -- so taking over moves nothing.
     */
    private static void drawAsTitle(Object graphics, int[] target, float opacity) {
        int scale = Buttons.supersample();
        int size = target[2];
        Object emblem = Buttons.emblem(size, Buttons.FADE_STEPS, 0, 0);
        if (emblem != null) {
            int pad = Buttons.EMBLEM_GLOW;
            int drawn = size + pad * 2;
            MenuLogoRenderer.blitSmooth(graphics, emblem, target[0] - pad, target[1] - pad, drawn, drawn,
                drawn * scale, drawn * scale, opacity);
        }
        int[] measured = new int[2];
        Object name = Buttons.wordmark(Buttons.FADE_STEPS, MenuDesign.WORDMARK_SIZE, measured);
        if (name != null) {
            int w = measured[0] / scale;
            int h = measured[1] / scale;
            MenuLogoRenderer.blitSmooth(graphics, name, target[4] - w / 2, target[3] - Buttons.WORDMARK_PAD, w, h,
                measured[0], measured[1], opacity);
        }
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
        MenuDesign.Plan plan = vanillaPlan(width, height);
        if (plan == null) return null;
        return new int[] {plan.emblemX, plan.emblemY, plan.emblemSize, plan.wordmarkY, plan.centreX, width, height};
    }

    /** The emblem's size on the title screen to come, as far as can be told before it is there; 0 when it cannot. */
    private static int plannedTitleSize(int width, int height) {
        int[] laid = titleLayout;
        if (laid != null && laid[5] == width && laid[6] == height) return laid[2];
        MenuDesign.Plan plan = vanillaPlan(width, height);
        return plan == null ? 0 : plan.emblemSize;
    }

    /** The title screen laid out for Minecraft's own buttons. */
    private static MenuDesign.Plan vanillaPlan(int width, int height) {
        List<MenuDesign.Role> roles = new ArrayList<MenuDesign.Role>();
        for (String label : Arrays.asList("Singleplayer", "Multiplayer", "Minecraft Realms", "Mods", "Options...", "Quit Game")) {
            roles.add(MenuDesign.roleOf(null, label));
        }
        return MenuDesign.plan(roles, width, height);
    }

    // ---- The pictures -------------------------------------------------------------

    /**
     * The loading screen's pictures, at the size it rests at: painted on a
     * thread of their own the moment it opens, and sent up to the GPU a few a
     * frame, what shows first first. The title screen's emblem and name are
     * painted with them and handed to it, so the frame it takes over on
     * paints nothing either.
     */
    static final class Pictures {
        /** Places of the light across the emblem: about one a frame at 60 frames a second. */
        static final int LIGHTS = 40;
        /** How long the bar's pictures are, in GUI pixels: drawn three-sliced to any length. */
        private static final int PILL = 64;

        final String layout;
        private final int size;
        private final int nameHeight;
        private final int scale;
        /** The light is soft: painted at no more than two pixels to the GUI pixel. */
        private final int lightScale;
        private final java.util.concurrent.ConcurrentLinkedQueue<Object[]> painted =
            new java.util.concurrent.ConcurrentLinkedQueue<Object[]>();
        private final java.util.Set<Integer> titleSizes = new java.util.HashSet<Integer>();
        /** What the screen shows: painted elsewhere first, here if that takes too long. */
        private final List<Runnable> essentials = new ArrayList<Runnable>();
        private final java.util.Set<Runnable> finished =
            java.util.Collections.newSetFromMap(new java.util.concurrent.ConcurrentHashMap<Runnable, Boolean>());
        private final Thread renderThread = Thread.currentThread();
        private final long createdAt = clock.getAsLong();
        /** Whether the render thread had to paint them: its frames are then too far apart for anything to move. */
        boolean tookOver;

        private Object backdrop;
        private int[] backdropSize;
        private Object emblem;
        private Object halo;
        private Object name;
        private int[] nameSize;
        private Object subtitle;
        private int[] subtitleSize;
        private Object status;
        private int[] statusSize;
        private Object track;
        private int[] trackSize;
        private Object fill;
        private int[] fillSize;
        private final Object[] glyphs = new Object[DIGITS.length()];
        private final int[][] glyphSizes = new int[DIGITS.length()][];
        private final Object[] lights = new Object[LIGHTS];

        private Pictures(String layout, int size, int nameHeight, int scale) {
            this.layout = layout;
            this.size = size;
            this.nameHeight = nameHeight;
            this.scale = scale;
            this.lightScale = Math.min(2, scale);
        }

        static Pictures paint(String layout, final int size, final int nameHeight, final int subtitleSize, final int barHeight,
                              final int statusSize, final int percentSize, final int scale, int titleSize, final float emblemY) {
            final Pictures pictures = new Pictures(layout, size, nameHeight, scale);
            final String subtitleText = ClientText.get("kiza.loading.subtitle");
            final String statusText = ClientText.get("kiza.loading.status");
            // What the screen shows is painted on a thread of its own the
            // moment the screen opens. Should it not be done within a quarter
            // of a second -- the game's load keeping every core busy, as on
            // Fabric with many mods -- the render thread paints what is left
            // itself, all on that frame.
            pictures.paintHere(new Runnable() {
                @Override
                public void run() {
                    pictures.put("backdrop", 0, Buttons.paintBackdrop(320, 180, 0.5F, emblemY));
                }
            });
            pictures.paintHere(new Runnable() {
                @Override
                public void run() {
                    pictures.put("emblem", 0, Buttons.paintEmblemAlone(size, scale));
                }
            });
            pictures.paintHere(new Runnable() {
                @Override
                public void run() {
                    pictures.put("name", 0, Buttons.paintWordmark(scale, 1F, nameHeight));
                }
            });
            pictures.paintHere(new Runnable() {
                @Override
                public void run() {
                    pictures.put("subtitle", 0, Buttons.paintLine(subtitleText, subtitleSize, SOFT, false, scale));
                    pictures.put("status", 0, Buttons.paintLine(statusText, statusSize, DIM, false, scale));
                }
            });
            pictures.paintHere(new Runnable() {
                @Override
                public void run() {
                    pictures.put("track", 0, Buttons.paintPill(PILL, barHeight, scale, false));
                    int inset = Math.max(1, Math.round(barHeight * 0.2F));
                    pictures.put("fill", 0, Buttons.paintPill(PILL, Math.max(2, barHeight - inset * 2), scale, true));
                    BufferedImage[] digits = Buttons.paintTabular(DIGITS, percentSize, SOFT, scale);
                    for (int index = 0; index < digits.length; index += 1) pictures.put("glyph", index, digits[index]);
                }
            });
            pictures.paintHere(new Runnable() {
                @Override
                public void run() {
                    pictures.put("halo", 0, Buttons.paintHaloAlone(size, scale));
                }
            });
            pictures.prepareTitle(titleSize, true);
            pictures.paintEssentialsElsewhere();
            // The light is an ornament: it can wait for a free core.
            pictures.paintElsewhere(new Runnable() {
                @Override
                public void run() {
                    for (int index = 0; index < LIGHTS; index += 1) {
                        pictures.offer("light", index, Buttons.paintLightAlone(size, pictures.lightScale, index / (float) (LIGHTS - 1)));
                    }
                }
            });
            return pictures;
        }

        /**
         * The title screen's emblem and name at {@code titleSize}, painted
         * once: with what the screen shows before it moves, or on its own
         * once it does.
         */
        void prepareTitle(final int titleSize, final boolean here) {
            if (titleSize <= 0 || !titleSizes.add(titleSize)) return;
            Runnable painting = new Runnable() {
                @Override
                public void run() {
                    BufferedImage emblemPicture = Buttons.paintEmblemAlone(titleSize, scale);
                    BufferedImage namePicture = Buttons.paintWordmark(scale, 1F, MenuDesign.WORDMARK_SIZE);
                    put("title-emblem", titleSize, emblemPicture);
                    put("title-name", MenuDesign.WORDMARK_SIZE, namePicture);
                }
            };
            if (here) paintHere(painting);
            else paintElsewhere(painting);
        }

        private void paintHere(Runnable painting) {
            essentials.add(painting);
        }

        /** What the screen shows, on a thread of its own, each painting skipped once the render thread has done it. */
        private void paintEssentialsElsewhere() {
            paintElsewhere(new Runnable() {
                @Override
                public void run() {
                    for (Runnable painting : essentials) {
                        if (finished.contains(painting)) continue;
                        painting.run();
                        finished.add(painting);
                    }
                }
            });
        }

        /** A picture to where it is drawn from: straight up from the render thread, through the queue from another. */
        private void put(String role, int index, BufferedImage image) {
            if (Thread.currentThread() == renderThread) accept(role, index, image);
            else offer(role, index, image);
        }

        private void paintElsewhere(Runnable painting) {
            Thread painter = new Thread(painting, "kiza-loading-pictures");
            painter.setDaemon(true);
            painter.start();
        }

        private void offer(String role, int index, BufferedImage image) {
            if (image != null) painted.add(new Object[] {role, index, image});
        }

        /**
         * Up to {@code budget} pictures from the painters to the GPU; and,
         * a quarter of a second on with what the screen shows still not all
         * there, the rest painted here and now. Render thread.
         */
        void sendUp(int budget) {
            drain(budget);
            if (ready() || clock.getAsLong() - createdAt < 250_000_000L) return;
            tookOver = true;
            for (Runnable painting : essentials) {
                if (finished.contains(painting)) continue;
                painting.run();
                finished.add(painting);
            }
            drain(Integer.MAX_VALUE);
        }

        private void drain(int budget) {
            for (int sent = 0; sent < budget; sent += 1) {
                Object[] next = painted.poll();
                if (next == null) return;
                accept((String) next[0], (Integer) next[1], (BufferedImage) next[2]);
            }
        }

        /** A picture, sent up to the GPU and kept where it is drawn from. Render thread. */
        private void accept(String role, int index, BufferedImage image) {
            if (image == null) return;
            int[] measured = {image.getWidth(), image.getHeight()};
            if (role.equals("title-emblem")) {
                Buttons.adoptTitleEmblem(index, image);
                return;
            }
            if (role.equals("title-name")) {
                Buttons.adoptTitleWordmark(index, image);
                return;
            }
            String name = role.equals("light") || role.equals("glyph") ? "loading_" + role + "_" + index : "loading_" + role;
            Object uploaded = KizaCanvas.upload(name, image, true);
            if (role.equals("backdrop")) {
                backdrop = uploaded;
                backdropSize = measured;
            } else if (role.equals("emblem")) {
                emblem = uploaded;
            } else if (role.equals("halo")) {
                halo = uploaded;
            } else if (role.equals("name")) {
                this.name = uploaded;
                nameSize = measured;
            } else if (role.equals("subtitle")) {
                subtitle = uploaded;
                subtitleSize = measured;
            } else if (role.equals("status")) {
                status = uploaded;
                statusSize = measured;
            } else if (role.equals("track")) {
                track = uploaded;
                trackSize = measured;
            } else if (role.equals("fill")) {
                fill = uploaded;
                fillSize = measured;
            } else if (role.equals("glyph")) {
                glyphs[index] = uploaded;
                glyphSizes[index] = measured;
            } else if (role.equals("light")) {
                lights[index] = uploaded;
            }
        }

        /** Which pictures are up, for the log. */
        String describe() {
            int glyphsUp = 0;
            for (Object glyph : glyphs) if (glyph != null) glyphsUp += 1;
            int lightsUp = 0;
            for (Object lit : lights) if (lit != null) lightsUp += 1;
            return "pictures emblem=" + (emblem != null) + " name=" + (name != null) + " subtitle=" + (subtitle != null)
                + " track=" + (track != null) + " fill=" + (fill != null) + " status=" + (status != null)
                + " halo=" + (halo != null) + " glyphs=" + glyphsUp + "/" + glyphs.length + " lights=" + lightsUp + "/" + LIGHTS
                + (track == null ? "" : " track " + trackSize[0] + "x" + trackSize[1]);
        }

        /** Everything the screen shows is up: only the light may still be on its way. */
        boolean ready() {
            return finished.size() == essentials.size() && backdrop != null && emblem != null && name != null
                && subtitle != null && status != null && track != null && fill != null && halo != null
                && glyphs[glyphs.length - 1] != null;
        }

        void drawBackdrop(Object graphics, int width, int height, float opacity) {
            if (backdrop == null) return;
            MenuLogoRenderer.blitSmooth(graphics, backdrop, 0F, 0F, width, height, backdropSize[0], backdropSize[1], opacity);
        }

        /**
         * The emblem placed by its centre and top at {@code drawnSize}: its
         * halo under it, its light over it, each with its own opacity.
         */
        void drawEmblem(Object graphics, float centreX, float top, float drawnSize, float opacity, float haloOpacity,
                        float lightOpacity, float across) {
            if (opacity <= 0.002F) return;
            float ratio = drawnSize / size;
            float pad = Buttons.EMBLEM_GLOW * ratio;
            float canvas = drawnSize + pad * 2F;
            int pixels = (size + Buttons.EMBLEM_GLOW * 2) * scale;
            float left = centreX - canvas / 2F;
            if (halo != null && haloOpacity > 0.002F) {
                MenuLogoRenderer.blitSmooth(graphics, halo, left, top - pad, canvas, canvas, pixels, pixels, haloOpacity * opacity);
            }
            MenuLogoRenderer.blitSmooth(graphics, emblem, left, top - pad, canvas, canvas, pixels, pixels, opacity);
            Object lit = lights[Math.max(0, Math.min(LIGHTS - 1, Math.round(across * (LIGHTS - 1))))];
            if (lit != null && lightOpacity > 0.002F) {
                int lightPixels = size * lightScale;
                MenuLogoRenderer.blitSmooth(graphics, lit, centreX - drawnSize / 2F, top, drawnSize, drawnSize,
                    lightPixels, lightPixels, lightOpacity);
            }
        }

        /** "Kiza Client" under the emblem, its letters {@code height} tall, placed by its centre and top. */
        void drawName(Object graphics, float centreX, float top, float height, float opacity) {
            if (name == null || opacity <= 0.002F) return;
            float ratio = height / nameHeight;
            float w = nameSize[0] / (float) scale * ratio;
            float h = nameSize[1] / (float) scale * ratio;
            MenuLogoRenderer.blitSmooth(graphics, name, centreX - w / 2F, top - Buttons.WORDMARK_PAD * ratio, w, h,
                nameSize[0], nameSize[1], opacity);
        }

        void drawSubtitle(Object graphics, float centreX, float top, float opacity) {
            drawCentred(graphics, subtitle, subtitleSize, centreX, top, opacity);
        }

        void drawStatus(Object graphics, float centreX, float top, float opacity) {
            drawCentred(graphics, status, statusSize, centreX, top, opacity);
        }

        private void drawCentred(Object graphics, Object picture, int[] measured, float centreX, float top, float opacity) {
            if (picture == null || opacity <= 0.002F) return;
            float w = measured[0] / (float) scale;
            float h = measured[1] / (float) scale;
            MenuLogoRenderer.blitSmooth(graphics, picture, centreX - w / 2F, top, w, h, measured[0], measured[1], opacity);
        }

        void drawTrack(Object graphics, float x, float y, float width, float height, float opacity) {
            if (track != null) drawPill(graphics, track, trackSize, x, y, width, height, opacity);
        }

        void drawFill(Object graphics, float x, float y, float width, float height, float opacity) {
            if (fill != null) drawPill(graphics, fill, fillSize, x, y, width, height, opacity);
        }

        /** A pill three-sliced: its two round ends as they are, the length between drawn out. */
        private static void drawPill(Object graphics, Object picture, int[] measured, float x, float y, float width,
                                     float height, float opacity) {
            if (opacity <= 0.002F || width <= 0F) return;
            int textureWidth = measured[0];
            int textureHeight = measured[1];
            if (width <= height) {
                MenuLogoRenderer.blitSmooth(graphics, picture, x, y, width, height, textureWidth, textureHeight, opacity);
                return;
            }
            float end = height / 2F;
            int cap = textureHeight / 2;
            MenuLogoRenderer.blitSmooth(graphics, picture, x, y, end, height, 0F, 0F, cap, textureHeight,
                textureWidth, textureHeight, opacity);
            MenuLogoRenderer.blitSmooth(graphics, picture, x + end, y, width - end * 2F, height, cap, 0F,
                textureWidth - cap * 2, textureHeight, textureWidth, textureHeight, opacity);
            MenuLogoRenderer.blitSmooth(graphics, picture, x + width - end, y, end, height, textureWidth - cap, 0F, cap,
                textureHeight, textureWidth, textureHeight, opacity);
        }

        /** "52%", from {@code left}, each figure as wide as any other. */
        void drawPercent(Object graphics, float left, float top, int percent, float opacity) {
            if (opacity <= 0.002F) return;
            String figures = Math.max(0, Math.min(100, percent)) + "%";
            float x = left;
            for (int index = 0; index < figures.length(); index += 1) {
                int glyph = DIGITS.indexOf(figures.charAt(index));
                if (glyph < 0 || glyphs[glyph] == null) return;
                int[] measured = glyphSizes[glyph];
                float w = measured[0] / (float) scale;
                MenuLogoRenderer.blitSmooth(graphics, glyphs[glyph], x, top, w, measured[1] / (float) scale,
                    measured[0], measured[1], opacity);
                x += w;
            }
        }
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
     * Mojang's screen only: a loader's, over it, may hold its own window's.
     */
    private static Object logoName(Class<?> overlayType) throws IllegalAccessException {
        for (Class<?> type = overlayType; type != null && type != Object.class; type = type.getSuperclass()) {
            if (!type.getName().startsWith("net.minecraft.")) continue;
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

    /** Out of motion into rest: quick, then settling. */
    private static float easeOut(float x) {
        return 1F - (1F - x) * (1F - x);
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

}
