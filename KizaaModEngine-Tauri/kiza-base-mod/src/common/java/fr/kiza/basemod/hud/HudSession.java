package fr.kiza.basemod.hud;

/**
 * What the HUD knows about the run it is drawing on top of.
 *
 * <p>Everything here is counted rather than asked for. Minecraft does hold a
 * frame rate and a session clock, but reaching them means naming a field that
 * has a different name on each of the four loader generations this jar runs on
 * — and a HUD is not worth a mapping lookup that can fail at load time when the
 * same number can be counted from the render calls the HUD already receives.
 *
 * <p>What is <em>not</em> here is the deliberate part. Coordinates, active
 * effects and ping all live on the player, and reading the player means going
 * through each loader's mapping resolver, the way {@code
 * FabricMinecraftStateDetector} already does for the player state. That is the
 * next step and it is a real one; it is not this class quietly guessing at
 * field names.
 *
 * <p>Java 8 syntax: this compiles into the legacy jar as well as the modern one.
 */
public final class HudSession {
    private final long startedAt;
    private long windowOpenedAt;
    private int framesThisWindow;
    private int fps;

    public HudSession() {
        this(System.nanoTime());
    }

    HudSession(long now) {
        this.startedAt = now;
        this.windowOpenedAt = now;
    }

    /**
     * Counts one drawn frame, and once a second turns the count into a rate.
     *
     * <p>A whole second rather than a rolling average of the last few frames:
     * a number that changes every frame is a number nobody can read, and the
     * reason to look at a frame rate is to see whether it is holding.
     */
    public void frame(long now) {
        framesThisWindow += 1;
        long elapsed = now - windowOpenedAt;
        if (elapsed < 1_000_000_000L) return;
        // Scaled by the window that actually elapsed, not assumed to be exactly
        // a second: a stalled frame makes the window longer than one, and
        // dividing by one there reports a drop that did not happen.
        fps = (int) Math.round(framesThisWindow * 1_000_000_000.0 / elapsed);
        framesThisWindow = 0;
        windowOpenedAt = now;
    }

    /** Zero until the first second is up, which reads as "not yet" and is true. */
    public int fps() {
        return fps;
    }

    /** How long this launch has been running, as {@code h:mm:ss} or {@code m:ss}. */
    public String playedFor(long now) {
        long seconds = Math.max(0L, (now - startedAt) / 1_000_000_000L);
        long hours = seconds / 3600L;
        long minutes = (seconds % 3600L) / 60L;
        long remainder = seconds % 60L;
        if (hours > 0L) {
            return hours + ":" + twoDigits(minutes) + ":" + twoDigits(remainder);
        }
        return minutes + ":" + twoDigits(remainder);
    }

    private static String twoDigits(long value) {
        return value < 10L ? "0" + value : Long.toString(value);
    }
}
