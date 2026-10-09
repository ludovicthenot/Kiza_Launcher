package fr.kiza.basemod.menu;

import java.util.Map;
import java.util.WeakHashMap;

/**
 * How the Kiza menu moves: the column arriving, and a button answering the
 * pointer.
 *
 * <p>Both are driven by the clock, never by the frame count, so a menu at 30
 * frames a second and one at 240 arrive in the same time. Both settle on a
 * still picture, because a menu nobody is touching should not be moving.
 *
 * <p>What changes with time is quantised into a few steps by the caller: each
 * step is a texture, and a texture per frame would be a texture per frame.
 */
public final class Animations {
    private Animations() {}

    /** One button's arrival, from first frame to rest. */
    private static final long ENTRANCE_NANOS = 420_000_000L;
    /** And how much later each one after it starts. */
    private static final long STAGGER_NANOS = 45_000_000L;
    /** Time for a hover to cover about two thirds of the way. */
    private static final float HOVER_TAU_NANOS = 70_000_000F;
    /** How far a button rises as it arrives, in GUI pixels. */
    public static final int RISE = 10;

    /** The screen the entrance is being played for, and when it began. */
    private static Object entranceScreen;
    private static long entranceStart;

    /** A button's hover: how far it is, and when that was worked out. */
    private static final class Hover {
        float value;
        long at;
    }

    private static final Map<Object, Hover> HOVER = new WeakHashMap<Object, Hover>();

    /**
     * Restarts the entrance when a new title screen opens.
     *
     * <p>Keyed on the screen object, not on its class: coming back to the
     * title screen from Options builds a new one, and that is an arrival.
     * Resizing the window does not, and the menu should not replay for it.
     */
    public static void beginFrame(Object screen) {
        long now = System.nanoTime();
        if (screen != entranceScreen) {
            entranceScreen = screen;
            entranceStart = now;
        }
    }

    /** How far button {@code order} has arrived, eased, 0 to 1. */
    public static float entrance(int order) {
        long elapsed = System.nanoTime() - entranceStart - order * STAGGER_NANOS;
        if (elapsed <= 0) return 0F;
        if (elapsed >= ENTRANCE_NANOS) return 1F;
        return easeOutCubic(elapsed / (float) ENTRANCE_NANOS);
    }

    /** The brand arrives with the first button, a little ahead of it. */
    public static float brand() {
        long elapsed = System.nanoTime() - entranceStart;
        if (elapsed >= ENTRANCE_NANOS) return 1F;
        return easeOutCubic(Math.max(0F, elapsed / (float) ENTRANCE_NANOS));
    }

    /** Whether anything is still moving, so the caller can stop asking. */
    public static boolean settled(int buttons) {
        return System.nanoTime() - entranceStart >= ENTRANCE_NANOS + buttons * STAGGER_NANOS;
    }

    /**
     * Moves a button's hover towards where the pointer says it should be.
     *
     * <p>Exponential rather than linear: it leaves quickly and slows as it
     * arrives, which is how a surface answering a finger feels, and it can be
     * reversed half way without a jump.
     */
    public static float hover(Object widget, boolean hovered) {
        if (widget == null) return hovered ? 1F : 0F;
        Hover state = HOVER.get(widget);
        long now = System.nanoTime();
        float target = hovered ? 1F : 0F;
        if (state == null) {
            // A button met for the first time is already where it should be:
            // a menu opening under the pointer does not fade its first button in.
            state = new Hover();
            state.value = target;
            state.at = now;
            HOVER.put(widget, state);
            return state.value;
        }
        // Capped, so a frame that took a second does not count as a second of
        // easing -- and a first frame after a long pause does not jump.
        float elapsed = Math.max(0F, Math.min(200_000_000F, (float) (now - state.at)));
        state.at = now;
        float keep = (float) Math.exp(-elapsed / HOVER_TAU_NANOS);
        state.value = target + (state.value - target) * keep;
        if (Math.abs(state.value - target) < 0.02F) state.value = target;
        return state.value;
    }

    /** One pass of the light across the emblem, and the rest before the next. */
    private static final long SWEEP_NANOS = 650_000_000L;
    private static final long SWEEP_EVERY_NANOS = 1_900_000_000L;
    private static final Map<Object, long[]> SWEEPS = new WeakHashMap<Object, long[]>();

    /**
     * Where the light crossing the emblem is, in {@code steps}: 0 when there
     * is none, 1 as it enters, {@code steps} as it leaves.
     *
     * <p>It crosses the moment the pointer arrives, and again every couple of
     * seconds while it stays -- the emblem answering, not idling. Leaving
     * lets the pass in flight finish rather than cutting it off.
     */
    public static int sweep(Object key, boolean hovered, int steps) {
        long now = System.nanoTime();
        long[] state = SWEEPS.get(key);
        if (state == null) {
            state = new long[] {0L, 0L};
            SWEEPS.put(key, state);
        }
        boolean wasHovered = state[1] != 0L;
        if (hovered && !wasHovered) state[0] = now;
        state[1] = hovered ? 1L : 0L;
        if (state[0] == 0L) return 0;

        long elapsed = now - state[0];
        if (hovered && elapsed >= SWEEP_EVERY_NANOS) {
            state[0] = now;
            elapsed = 0L;
        }
        if (elapsed >= SWEEP_NANOS) {
            if (!hovered) state[0] = 0L;
            return 0;
        }
        float progress = easeInOut(elapsed / (float) SWEEP_NANOS);
        return Math.max(1, Math.min(steps, 1 + Math.round(progress * (steps - 1))));
    }

    public static float easeInOut(float t) {
        float x = Math.max(0F, Math.min(1F, t));
        return x < 0.5F ? 4F * x * x * x : 1F - (float) Math.pow(-2F * x + 2F, 3) / 2F;
    }

    /** {@code value} in {@code steps} even steps, so each one is a texture. */
    public static int step(float value, int steps) {
        return Math.max(0, Math.min(steps, Math.round(value * steps)));
    }

    public static float easeOutCubic(float t) {
        float inverse = 1F - Math.max(0F, Math.min(1F, t));
        return 1F - inverse * inverse * inverse;
    }
}
