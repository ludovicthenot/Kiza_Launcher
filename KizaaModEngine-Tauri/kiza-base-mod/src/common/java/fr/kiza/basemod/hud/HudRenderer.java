package fr.kiza.basemod.hud;

import fr.kiza.basemod.KizaClientManager;
import java.util.ArrayList;
import java.util.List;

/**
 * The in-game HUD: what it says, and when it says nothing.
 *
 * <p>Off until the {@code hud} module starts. The module is optional, so a
 * Minecraft version whose render hooks Kiza cannot reach is a plain-looking
 * game rather than a broken one — and a player who turns the module off in
 * {@code client.properties} gets a vanilla screen, not a smaller HUD.
 *
 * <p>{@link #cards} is public so the preview draws the panels the game draws.
 * A preview with its own hand-written sample is a preview of a HUD that does
 * not exist, and it stays convincing long after the real one has changed.
 *
 * <p>Java 8 syntax: this compiles into the legacy jar as well as the modern one.
 */
public final class HudRenderer {
    private static volatile boolean active;
    private static final HudSession SESSION = new HudSession();

    private HudRenderer() {}

    /** Switched on by the module once it has started, and never before. */
    public static void activate() {
        active = true;
    }

    public static boolean isActive() {
        return active;
    }

    /**
     * Draws the HUD for one frame.
     *
     * <p>Called from the render hook on every loader, with whatever that
     * version calls a graphics object. Nothing here throws: a HUD is the last
     * thing that should be able to take the game down, so the whole pass is
     * wrapped and a failure simply means no panels this frame.
     */
    public static void render(Object graphics, Object screen, int width, int height) {
        if (!active || graphics == null) return;
        try {
            SESSION.frame(System.nanoTime());
            List<HudLayout.Placement> placements = HudLayout.arrange(
                cards(SESSION, System.nanoTime()), width, height, HudPainter.MEASURER
            );
            for (HudLayout.Placement placement : placements) {
                HudPainter.draw(graphics, screen, placement);
            }
        } catch (RuntimeException | LinkageError error) {
            // One bad frame, not a crashed game. Silent on purpose: a HUD that
            // logs on every frame fills a log file in a minute.
            active = false;
        }
    }

    /**
     * The panels, in the order they stack.
     *
     * <p>Two of them, and that is the honest extent of it today. The watermark
     * and the session clock are counted from the frames this class already
     * receives. Coordinates, effects and ping are the obvious next three, and
     * each needs the player read through its loader's mapping resolver — real
     * work with a real failure mode, not something to fake with a guessed field
     * name so the screenshot looks fuller.
     */
    public static List<HudCard> cards(HudSession session, long now) {
        List<HudCard> cards = new ArrayList<HudCard>();

        HudCard.Builder watermark = HudCard.at("watermark", HudCorner.TOP_LEFT)
            .title(KizaClientManager.windowTitle());
        int fps = session.fps();
        if (fps > 0) {
            watermark.row("Frames", fps + " fps");
        }
        cards.add(watermark.build());

        cards.add(HudCard.at("session", HudCorner.BOTTOM_RIGHT)
            .row("Played", session.playedFor(now))
            .build());

        return cards;
    }
}
