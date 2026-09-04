package fr.kiza.basemod.hud;

/**
 * Every colour and measurement the in-game HUD uses, in one place.
 *
 * <p>The HUD sits on top of a game whose background is never the same twice:
 * a snow field, a nether ceiling, a dark cave. So the panels cannot be tuned
 * against one backdrop. What holds across all of them is a dark, mostly opaque
 * base with a bright edge — the glass reads as glass because of its rim and the
 * light gathered along its top, not because of what shows through it.
 *
 * <p>One accent, and it is the launcher's own violet — the same {@code 8B5CF6}
 * the menu and the website use. A HUD in a second accent colour would be a
 * second product.
 *
 * <p>Java 8 syntax: this compiles into the legacy jar as well as the modern one.
 */
public final class HudTheme {
    private HudTheme() {}

    /* ------------------------------------------------------------ colours -- */

    /** The launcher's violet. The only hue the HUD is allowed to be excited in. */
    public static final int ACCENT = 0xFF8B5CF6;
    /** Its paler end, for text that should read as accent without shouting. */
    public static final int ACCENT_SOFT = 0xFFB79BFF;

    /**
     * The glass itself: its colour, and how much of it is glass.
     *
     * <p>Alpha 0x59 — a third — is far more transparent than a readable panel
     * has any right to be, and it works because the panel is no longer doing
     * the work alone. What separates the text from the world is the bending at
     * the rim and the light gathered there, not a slab of dark laid over it.
     * That is the whole difference between glass and a tinted rectangle.
     */
    public static final int PANEL = 0x73161124;
    /**
     * The colour light picks up crossing the thick part of the pane.
     *
     * <p>Where the accent belongs. An edge is the one place a strong colour
     * reads as material rather than as decoration, because that is where a real
     * pane concentrates it.
     */
    public static final int PANEL_EDGE = 0x6E8B5CF6;
    /** A brighter edge for a panel meant to be noticed. */
    public static final int PANEL_EDGE_ACCENT = 0xA8B79BFF;
    /** How far the corner is rounded, which is also how thick the pane looks. */
    public static final int LENS_RADIUS = 8;

    /* ------------------------------------------- when there is no lens -- */

    /**
     * The panel drawn when the pane cannot be: no {@code java.desktop}, no
     * framebuffer to read, a Minecraft build whose texture manager moved.
     *
     * <p>Much more opaque than the glass, and that is the point rather than an
     * oversight. The glass gets away with a third alpha because the rim does
     * the separating; with no rim there is nothing holding the text off the
     * world, so the panel has to do it the blunt way. It is not glass and does
     * not pretend to be — but the coordinates are still readable in a cave,
     * which is what the panel is for.
     */
    public static final int FLAT_PANEL = 0xB2120F1C;
    public static final int FLAT_EDGE = 0x5CFFFFFF;
    public static final int FLAT_SHEEN = 0x2BFFFFFF;
    public static final int FLAT_SHADOW = 0x80000000;

    public static final int TEXT = 0xFFF4F2FA;
    public static final int TEXT_MUTED = 0xFFA9A3BC;
    /** Numbers that change every frame, kept quieter than their labels. */
    public static final int TEXT_VALUE = 0xFFD9D3E8;

    /* ---------------------------------------------------------- measures -- */

    /** Corner radius of a panel, in GUI pixels. */
    public static final int RADIUS = 6;
    /** Space between a panel's edge and its content. */
    public static final int PADDING_X = 6;
    public static final int PADDING_Y = 4;
    /** Space between two stacked panels. */
    public static final int GAP = 4;
    /** Space between the screen edge and the first panel. */
    public static final int MARGIN = 6;
    /** Room reserved around the glass for its shadow to fall into. */
    public static final int SHADOW_PAD = 4;

    /** Body text. Small on purpose: a HUD that competes with the game loses. */
    public static final int TEXT_SIZE = 8;
    /** The watermark, the one line allowed to be the product's name. */
    public static final int TITLE_SIZE = 10;
    /** Height of one row of body text, including its leading. */
    public static final int ROW_HEIGHT = 11;
}
