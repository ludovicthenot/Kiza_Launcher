package fr.kiza.basemod.hud;

/**
 * Which corner a card is anchored to.
 *
 * <p>Four corners and nothing between them. The middle of the screen is where
 * the player is looking and the bottom centre is where Minecraft keeps the
 * hotbar, the health and the hunger — a HUD that puts anything there is a HUD
 * that gets turned off.
 *
 * <p>The bottom two also have to clear the vanilla bars, which is why they
 * carry their own inset rather than sharing one margin with the top.
 *
 * <p>Java 8 syntax: this compiles into the legacy jar as well as the modern one.
 */
public enum HudCorner {
    TOP_LEFT(false, false),
    TOP_RIGHT(true, false),
    BOTTOM_LEFT(false, true),
    BOTTOM_RIGHT(true, true);

    private final boolean right;
    private final boolean bottom;

    HudCorner(boolean right, boolean bottom) {
        this.right = right;
        this.bottom = bottom;
    }

    public boolean isRight() {
        return right;
    }

    public boolean isBottom() {
        return bottom;
    }

    /** The x of a panel of this width, anchored here on a screen this wide. */
    public int x(int screenWidth, int panelWidth) {
        return right ? screenWidth - HudTheme.MARGIN - panelWidth : HudTheme.MARGIN;
    }

    /**
     * The y of the {@code index}-th panel down (or up) this corner's stack.
     *
     * <p>{@code consumed} is the total height already taken by the panels
     * before it, gaps included, so the caller does not need every panel to be
     * the same height.
     */
    public int y(int screenHeight, int panelHeight, int consumed) {
        return bottom
            ? screenHeight - bottomInset() - consumed - panelHeight
            : HudTheme.MARGIN + consumed;
    }

    /**
     * How far up from the bottom edge this corner starts.
     *
     * <p>The hotbar and its bars are about 40 GUI pixels tall and centred, but
     * the experience bar and the health run wider than the hotbar itself, so
     * clearing the hotbar's width is not enough on either side.
     */
    private int bottomInset() {
        return bottom ? HudTheme.MARGIN + 44 : HudTheme.MARGIN;
    }
}
