package fr.kiza.basemod.menu;

import java.util.ArrayList;
import java.util.List;

/**
 * What the Kiza title menu looks like, in numbers, for every loader at once.
 *
 * <p>The menu is a column: the emblem, the words KIZA CLIENT under it, and the
 * buttons in a grid below. Singleplayer and Multiplayer take a row each, the
 * width of the column; whatever else the title screen offers is paired two to
 * a row underneath. The buttons are Minecraft's own, moved into those places,
 * so a click still lands on the widget that handles it.
 *
 * <p>Nothing here knows about a loader or a mapping. It is given a screen size
 * and a list of buttons with a role each, and answers where everything goes.
 * Fabric, Forge and NeoForge differ in how they reach the title screen, not in
 * what it should look like, and that difference stops at their own classes.
 *
 * <p>Java 8 syntax: this compiles into the legacy jars as well.
 */
public final class MenuDesign {
    private MenuDesign() {}

    // ---- Colours ------------------------------------------------------------

    /** A button at rest: near black, a breath of blue. Opaque, on purpose. */
    public static final int SURFACE = 0xFF15141C;
    /** Its rim, brightest along the top. */
    public static final int EDGE = 0x2EFFFFFF;
    /**
     * Under the pointer the button fades to violet: deep on the left, into
     * the launcher's own {@code 8B5CF6} and a little lighter on the right.
     */
    public static final int ACCENT_FROM = 0xFF6D28D9;
    public static final int ACCENT_TO = 0xFFA07CFB;
    /** The light that crosses the emblem, and the halo behind it. */
    public static final int GLOW = 0xFF8B5CF6;
    public static final int SHINE = 0xFFD9C8FF;
    public static final int TEXT = 0xFFF1EFF7;
    public static final int TEXT_SOFT = 0xFFC9C5D6;
    /** A button that cannot be pressed. */
    public static final int TEXT_DISABLED = 0xFF6E6A7C;
    /** Laid over the panorama so the column reads against any world. */
    public static final int VEIL = 0x8C07060C;

    // ---- Sizes, in GUI pixels -------------------------------------------------

    /** The column's width: a full-width button. */
    public static final int COLUMN_WIDTH = 200;
    /** Between two buttons on a row, and between two rows. */
    public static final int GAP = 4;
    /**
     * A button's height as drawn. Minecraft's widget is 20 and sits a pixel
     * inside it on every side, which is what lets a square widget hide under a
     * rounded surface without its corners showing.
     */
    public static final int BUTTON_HEIGHT = 22;
    public static final int RADIUS = 3;
    /** How far the drawn surface extends past the widget, on every side. */
    public static final int GROW = 1;

    public static final int EMBLEM_SIZE = 58;
    public static final int EMBLEM_MIN = 30;
    public static final int WORDMARK_SIZE = 15;
    /** Emblem to wordmark, and wordmark to buttons. */
    public static final int EMBLEM_GAP = 6;
    public static final int WORDMARK_GAP = 14;

    public static final int LABEL_SIZE = 8;
    /** Letter spacing for labels and the wordmark, as a fraction of an em. */
    public static final float LABEL_TRACKING = 0.14F;
    public static final float WORDMARK_TRACKING = 0.12F;
    public static final int ICON_SIZE = 8;
    public static final int ICON_GAP = 5;

    public static final String WORDMARK = "KIZA CLIENT";
    public static final String EMBLEM = "/assets/kiza_base_mod/textures/gui/kiza_client_emblem.png";

    // ---- Roles ----------------------------------------------------------------

    /** What a title-screen button does, so it can be put in its place. */
    public enum Role {
        SINGLEPLAYER,
        MULTIPLAYER,
        REALMS,
        MODS,
        OPTIONS,
        QUIT,
        OTHER;

        /** The order the grid fills in below the two full-width rows. */
        int rank() {
            return ordinal();
        }
    }

    /**
     * Which button this is, from what Minecraft says about it.
     *
     * <p>The translation key first, when the caller could find one: it is the
     * same in every language. Then the label, in the languages Kiza's players
     * actually use, because a key is not always reachable by reflection.
     */
    public static Role roleOf(String translationKey, String label) {
        if (translationKey != null) {
            String key = translationKey.toLowerCase(java.util.Locale.ROOT);
            if (key.equals("menu.singleplayer")) return Role.SINGLEPLAYER;
            if (key.equals("menu.multiplayer")) return Role.MULTIPLAYER;
            if (key.equals("menu.online")) return Role.REALMS;
            if (key.equals("menu.options")) return Role.OPTIONS;
            if (key.equals("menu.quit")) return Role.QUIT;
            if (key.equals("fml.menu.mods") || key.startsWith("modmenu.")) return Role.MODS;
        }
        String text = label == null ? "" : label.trim().toLowerCase(java.util.Locale.ROOT);
        if (text.isEmpty()) return Role.OTHER;
        if (containsAny(text, "singleplayer", "solo", "un joueur", "einzelspieler", "un jugador", "giocatore singolo")) {
            return Role.SINGLEPLAYER;
        }
        if (containsAny(text, "multiplayer", "multijoueur", "mehrspieler", "multijugador", "multigiocatore")) {
            return Role.MULTIPLAYER;
        }
        if (text.contains("realms")) return Role.REALMS;
        if (text.equals("mods") || text.startsWith("mods ") || text.startsWith("mods(")) return Role.MODS;
        if (containsAny(text, "options", "optionen", "opciones", "opzioni")) return Role.OPTIONS;
        if (containsAny(text, "quit", "quitter", "beenden", "salir", "esci")) return Role.QUIT;
        return Role.OTHER;
    }

    /**
     * The words a button shows in the Kiza menu.
     *
     * <p>Minecraft's own, in the player's language, with two trims: the dots
     * after "Options..." promise a dialogue in a menu where every button
     * opens one, and "Minecraft Realms" does not fit half a row, where
     * "Realms" says the same.
     */
    public static String displayLabel(Role role, String label) {
        if (label == null) return "";
        String text = label.trim();
        while (text.endsWith(".") || text.endsWith("…")) text = text.substring(0, text.length() - 1).trim();
        if (role == Role.REALMS && text.toLowerCase(java.util.Locale.ROOT).startsWith("minecraft ")) {
            text = text.substring("minecraft ".length()).trim();
        }
        return text;
    }

    private static boolean containsAny(String text, String... words) {
        for (String word : words) {
            if (text.contains(word)) return true;
        }
        return false;
    }

    // ---- Layout ---------------------------------------------------------------

    /** Where one button goes: the surface Kiza draws, in GUI pixels. */
    public static final class Slot {
        public final int index;
        public final int x;
        public final int y;
        public final int width;
        public final int height;

        Slot(int index, int x, int y, int width, int height) {
            this.index = index;
            this.x = x;
            this.y = y;
            this.width = width;
            this.height = height;
        }

        /** The widget's own bounds: the surface, a pixel in on every side. */
        public int widgetX() {
            return x + GROW;
        }

        public int widgetY() {
            return y + GROW;
        }

        public int widgetWidth() {
            return width - GROW * 2;
        }
    }

    /** The whole title menu: the brand above, the buttons below. */
    public static final class Plan {
        public final int emblemX;
        public final int emblemY;
        public final int emblemSize;
        public final int wordmarkY;
        public final int centreX;
        /** One per button handed in, in the same order; null where it has no place. */
        public final List<Slot> slots;

        Plan(int emblemX, int emblemY, int emblemSize, int wordmarkY, int centreX, List<Slot> slots) {
            this.emblemX = emblemX;
            this.emblemY = emblemY;
            this.emblemSize = emblemSize;
            this.wordmarkY = wordmarkY;
            this.centreX = centreX;
            this.slots = slots;
        }
    }

    /**
     * Lays out the title screen, or answers null when it should be left alone.
     *
     * <p>Left alone when the two buttons the menu is built around cannot be
     * told apart from the rest -- a title screen some mod rebuilt, a language
     * the labels were not matched in and no key to fall back on. A grid made
     * of guesses would put Quit where Singleplayer was, which is worse than
     * Minecraft's own layout in Kiza's colours.
     *
     * @param roles one per button, in the order the screen holds them
     */
    public static Plan plan(List<Role> roles, int screenWidth, int screenHeight) {
        int single = roles.indexOf(Role.SINGLEPLAYER);
        int multi = roles.indexOf(Role.MULTIPLAYER);
        if (single < 0 || multi < 0 || screenWidth < COLUMN_WIDTH + 24) return null;

        // The rest, by role and then in the order the screen made them.
        List<Integer> rest = new ArrayList<Integer>();
        for (int index = 0; index < roles.size(); index += 1) {
            if (index != single && index != multi) rest.add(index);
        }
        final List<Role> byIndex = roles;
        java.util.Collections.sort(rest, new java.util.Comparator<Integer>() {
            @Override
            public int compare(Integer left, Integer right) {
                int byRole = Integer.compare(byIndex.get(left).rank(), byIndex.get(right).rank());
                return byRole != 0 ? byRole : Integer.compare(left, right);
            }
        });

        int pairedRows = (rest.size() + 1) / 2;
        int rows = 2 + pairedRows;
        int buttonsHeight = rows * BUTTON_HEIGHT + (rows - 1) * GAP;

        // The emblem gives way first on a short window: the buttons are the
        // part somebody came here to press.
        int room = screenHeight - 40 - buttonsHeight - WORDMARK_SIZE - EMBLEM_GAP - WORDMARK_GAP;
        int emblem = Math.max(EMBLEM_MIN, Math.min(EMBLEM_SIZE, room));
        if (room < EMBLEM_MIN) return null;

        int blockHeight = emblem + EMBLEM_GAP + WORDMARK_SIZE + WORDMARK_GAP + buttonsHeight;
        // A little above the middle, where a menu sits comfortably.
        int top = Math.max(16, (screenHeight - blockHeight) / 2 - 6);
        int centre = screenWidth / 2;
        int left = centre - COLUMN_WIDTH / 2;
        int half = (COLUMN_WIDTH - GAP) / 2;

        Slot[] slots = new Slot[roles.size()];
        int y = top + emblem + EMBLEM_GAP + WORDMARK_SIZE + WORDMARK_GAP;
        slots[single] = new Slot(single, left, y, COLUMN_WIDTH, BUTTON_HEIGHT);
        y += BUTTON_HEIGHT + GAP;
        slots[multi] = new Slot(multi, left, y, COLUMN_WIDTH, BUTTON_HEIGHT);
        y += BUTTON_HEIGHT + GAP;

        for (int position = 0; position < rest.size(); position += 2) {
            int first = rest.get(position);
            if (position + 1 < rest.size()) {
                int second = rest.get(position + 1);
                slots[first] = new Slot(first, left, y, half, BUTTON_HEIGHT);
                slots[second] = new Slot(second, left + COLUMN_WIDTH - half, y, half, BUTTON_HEIGHT);
            } else {
                // An odd one out takes the row: a lone half button reads as
                // one that lost its partner.
                slots[first] = new Slot(first, left, y, COLUMN_WIDTH, BUTTON_HEIGHT);
            }
            y += BUTTON_HEIGHT + GAP;
        }

        List<Slot> ordered = new ArrayList<Slot>();
        for (Slot slot : slots) ordered.add(slot);
        return new Plan(centre - emblem / 2, top, emblem, top + emblem + EMBLEM_GAP, centre, ordered);
    }

    /** {@code from} towards {@code to} by {@code amount}, per channel, alpha included. */
    public static int mix(int from, int to, float amount) {
        float t = Math.max(0F, Math.min(1F, amount));
        int a = channel(from >>> 24, to >>> 24, t);
        int r = channel((from >> 16) & 0xFF, (to >> 16) & 0xFF, t);
        int g = channel((from >> 8) & 0xFF, (to >> 8) & 0xFF, t);
        int b = channel(from & 0xFF, to & 0xFF, t);
        return (a << 24) | (r << 16) | (g << 8) | b;
    }

    private static int channel(int from, int to, float t) {
        return Math.round(from + (to - from) * t);
    }
}
