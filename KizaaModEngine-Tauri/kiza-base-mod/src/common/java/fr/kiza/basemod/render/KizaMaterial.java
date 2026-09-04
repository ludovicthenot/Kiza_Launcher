package fr.kiza.basemod.render;

/**
 * The frosted glass Kiza's in-game surfaces are made of.
 *
 * <p>One material, one accent, in one file — so a button in the pause menu and
 * a button on the title screen cannot drift into being two materials that
 * nearly match. The accent is the launcher's own violet, the same {@code
 * 8B5CF6} the menu, the website and the installer use.
 *
 * <p>What makes it read as glass is not the fill. It is the rim: bright along
 * the top where a pane catches the light and fading towards the bottom, with a
 * soft shadow underneath so the surface sits above what it covers instead of
 * being printed on it. The fill is only the ground those two are drawn against.
 *
 * <p>These fills are opaque, and that is a constraint rather than a taste.
 * Vanilla draws its own button underneath and keeps it there, because that is
 * what still handles the click, the keyboard focus and the controller. A
 * translucent Kiza surface would show a grey Mojang button through it. The
 * frost here is what a pane looks like, not what it lets through.
 *
 * <p>Java 8 syntax: this compiles into the legacy jar as well as the modern one.
 */
public final class KizaMaterial {
    private KizaMaterial() {}

    /** The launcher's violet. The only colour anything here is allowed to be. */
    public static final int ACCENT = 0xFF8B5CF6;
    public static final int ACCENT_SOFT = 0xFFB79BFF;

    /** The pane at rest. */
    public static final int SURFACE = 0xFF14111E;
    /** The one the eye should land on first. */
    public static final int SURFACE_PRIMARY = 0xFF1B1430;
    /** And under the pointer. */
    public static final int SURFACE_HOVER = 0xFF251B3C;

    /**
     * The rim, and most of the effect.
     *
     * <p>Drawn as a gradient by {@link KizaGlass}: this is its value along the
     * top, and it fades to a third of it by the bottom. A rim of one flat
     * colour reads as a border somebody drew; a rim that falls off reads as an
     * edge catching the light.
     */
    public static final int EDGE = 0x59FFFFFF;
    public static final int EDGE_PRIMARY = 0xB38B5CF6;
    public static final int EDGE_HOVER = 0xE6B79BFF;

    /** Light gathered along the top of the pane and dying out below. */
    public static final int SHEEN = 0x24FFFFFF;
    /*
      There is no shadow here, and there cannot be one.

      A shadow needs room outside the surface. The only thing outside a Kiza
      button is Minecraft's own button -- still there, because it is what
      handles the click, the keyboard focus and the controller -- and it has to
      be covered by an opaque rectangle with square corners, or its grey border
      shows through the rounded corners as four grey notches.

      So a soft shadow drawn around a rounded surface sitting on a square cover
      does not read as a shadow. It reads as a square, which is exactly what it
      looked like. The rim and the sheen carry the material on their own; the
      shadow was the one part of it this surface cannot have.
    */
}
