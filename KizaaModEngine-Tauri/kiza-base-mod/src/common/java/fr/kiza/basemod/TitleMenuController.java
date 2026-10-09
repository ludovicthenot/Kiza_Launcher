package fr.kiza.basemod;

import fr.kiza.basemod.menu.Animations;
import fr.kiza.basemod.menu.Buttons;
import fr.kiza.basemod.menu.MenuDesign;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.List;

/**
 * Reskins Minecraft's title and pause menus into the Kiza launcher look without
 * touching input: it reads each vanilla button's bounds and label by
 * reflection and paints an opaque-backed surface on top of it (at render TAIL).
 * The real vanilla buttons stay in place underneath, so clicks, keyboard focus
 * and controller navigation keep working natively. When reflection fails,
 * nothing is drawn and the vanilla menu shows through unchanged.
 */
final class TitleMenuController {
    private static final int COLOR_OCCLUSION = 0xFF08070D;
    /** Room left above and below a respaced block, in GUI pixels. */
    private static final int MARGIN_TOP = 24;
    private static final int MARGIN_BOTTOM = 24;
    private static final int COLOR_TEXT = 0xFFF4F2FA;
    /**
     * Menu labels are set in the heavier face.
     *
     * <p>They are set at ten pixels over a translucent surface with a game
     * behind it, which is the hardest thing small text is ever asked to do. A
     * regular weight there is legible in a screenshot and thin in motion.
     */
    private static final boolean LABELS_ARE_BOLD = true;

    private static final int LOGO_HEIGHT = 44;
    /**
     * Narrower than this is an icon button -- language, accessibility -- whose
     * picture is the label. The multiplayer screen's Edit and Delete are 74.
     */
    private static final int MIN_BUTTON_WIDTH = 40;
    private static final int MAX_BUTTON_WIDTH = 420;

    private static Method childrenMethod;

    static final class Entry {
        private int x;
        private int y;
        private int width;
        private final int height;
        private final String label;
        /** The widget these bounds were read from, so its y can be written back. */
        private final Object widget;
        /** What it does, when the title screen is the one being drawn. */
        private MenuDesign.Role role = MenuDesign.Role.OTHER;
        /** The Kiza surface's own bounds, when the title grid placed it. */
        private MenuDesign.Slot slot;
        /** A slider rather than a button: drawn with its value. */
        private boolean slider;

        Entry(int x, int y, int width, int height, String label) {
            this(x, y, width, height, label, null);
        }

        Entry(int x, int y, int width, int height, String label, Object widget) {
            this.x = x;
            this.y = y;
            this.width = width;
            this.height = height;
            this.label = label;
            this.widget = widget;
        }

        Object widget() {
            return widget;
        }

        void moveTo(int newY) {
            this.y = newY;
        }

        MenuDesign.Role role() {
            return role;
        }

        MenuDesign.Slot slot() {
            return slot;
        }

        int x() {
            return x;
        }

        int y() {
            return y;
        }

        int width() {
            return width;
        }

        int height() {
            return height;
        }

        String label() {
            return label;
        }
    }

    static final class Layout {
        private final List<Entry> buttons;
        private final int topButtonY;
        /** The Kiza title grid, or null where the buttons stayed where they were. */
        private final MenuDesign.Plan plan;
        /** Whether Minecraft's own buttons were faded out under Kiza's. */
        private final boolean vanillaHidden;

        Layout(List<Entry> buttons, int topButtonY) {
            this(buttons, topButtonY, null, false);
        }

        Layout(List<Entry> buttons, int topButtonY, MenuDesign.Plan plan, boolean vanillaHidden) {
            this.buttons = buttons;
            this.topButtonY = topButtonY;
            this.plan = plan;
            this.vanillaHidden = vanillaHidden;
        }

        MenuDesign.Plan plan() {
            return plan;
        }

        boolean vanillaHidden() {
            return vanillaHidden;
        }

        List<Entry> buttons() {
            return buttons;
        }

        int topButtonY() {
            return topButtonY;
        }

        boolean supported() {
            return !buttons.isEmpty();
        }
    }

    private TitleMenuController() {}

    /**
     * Space between two rows of buttons once Kiza has had its say, in GUI
     * pixels. Vanilla leaves four, which is tight for surfaces that carry a rim
     * and are meant to read as separate objects.
     */
    private static final int ROW_GAP = 9;
    /** Rows within this many pixels of each other are the same row. */
    private static final int SAME_ROW = 3;
    /** Set once a position write has been proven not to take, and never retried. */
    private static boolean cannotMoveWidgets;

    static Layout capture(Object screen, int height) {
        return capture(screen, height, true);
    }

    /** Set once the title grid has been refused, and never tried again. */
    private static boolean cannotPlaceWidgets;
    /** Set once fading Minecraft's buttons out has been refused. */
    private static boolean cannotHideWidgets;
    /**
     * Nearly nothing, but not nothing. Minecraft's font treats a colour whose
     * alpha is below 4 as opaque, so a label faded to exactly zero comes back
     * at full strength; this keeps it at six, which nobody can see.
     */
    private static final float HIDDEN_ALPHA = 0.02F;

    /**
     * The title screen in the Kiza layout: Minecraft's buttons moved into the
     * grid {@link MenuDesign#plan} describes and faded out under Kiza's.
     *
     * <p>Falls back to {@link #capture} -- Minecraft's layout in Kiza's
     * colours -- whenever any part of that is not possible here: buttons it
     * cannot tell apart, a widget that will not move, a window too small.
     */
    static Layout captureTitle(Object screen, int width, int height) {
        if (cannotPlaceWidgets) return capture(screen, height, true);
        List<Entry> buttons = collectButtons(screen);
        List<MenuDesign.Role> roles = new ArrayList<>();
        for (Entry entry : buttons) {
            entry.role = MenuDesign.roleOf(translationKey(entry.widget()), entry.label());
            roles.add(entry.role);
        }
        MenuDesign.Plan plan = MenuDesign.plan(roles, width, height);
        if (plan == null || !place(buttons, plan)) return capture(screen, height, true);
        placeSmallButtons(screen, buttons, plan);

        boolean hidden = !cannotHideWidgets;
        for (Entry entry : buttons) {
            if (!hidden) break;
            if (!writeAlpha(entry.widget(), HIDDEN_ALPHA)) {
                cannotHideWidgets = true;
                hidden = false;
                // Put back what was already faded: half the buttons hidden is
                // a menu with holes in it.
                for (Entry other : buttons) writeAlpha(other.widget(), 1F);
            }
        }
        int top = plan.slots.isEmpty() ? height * 40 / 100 : plan.emblemY;
        return new Layout(Collections.unmodifiableList(new ArrayList<>(buttons)), top, plan, hidden);
    }

    /**
     * Moves every button to its slot, or none of them.
     *
     * <p>Each write is read back, and the first one that did not take puts
     * every widget already moved back where it was: a grid half applied is a
     * menu with two buttons on top of each other.
     */
    private static boolean place(List<Entry> buttons, MenuDesign.Plan plan) {
        int[][] before = new int[buttons.size()][];
        for (int index = 0; index < buttons.size(); index += 1) {
            Entry entry = buttons.get(index);
            MenuDesign.Slot slot = plan.slots.get(index);
            if (slot == null) continue;
            before[index] = new int[] {entry.x(), entry.y(), entry.width()};
            if (!moveTo(entry, slot.widgetX(), slot.widgetY(), slot.widgetWidth())) {
                for (int undo = 0; undo <= index; undo += 1) {
                    if (before[undo] == null) continue;
                    moveTo(buttons.get(undo), before[undo][0], before[undo][1], before[undo][2]);
                }
                cannotPlaceWidgets = true;
                return false;
            }
            entry.slot = slot;
        }
        return true;
    }

    private static boolean moveTo(Entry entry, int x, int y, int width) {
        Object widget = entry.widget();
        if (widget == null) return false;
        if (entry.width() != width) {
            if (!writeInt(widget, width, "method_25358", "setWidth", "m_93674_")
                && !writeField(widget, width, "field_22758", "f_93618_", "field_146120_f", "width")) {
                return false;
            }
            Integer read = readInt(widget, "method_25368", "getWidth", "m_5711_", "field_146120_f", "width");
            if (read == null || read != width) return false;
            entry.width = width;
        }
        if (entry.x() != x) {
            if (!writeInt(widget, x, "method_46421", "setX", "m_252865_")
                && !writeField(widget, x, "field_22760", "f_93620_", "field_146128_h", "xPosition", "x")) {
                return false;
            }
            Integer read = readInt(widget, "method_46426", "getX", "m_252754_", "field_146128_h", "xPosition", "x");
            if (read == null || read != x) return false;
            entry.x = x;
        }
        if (entry.y() != y && !moveWidget(entry, y)) return false;
        return true;
    }

    /**
     * The two square buttons -- language and accessibility -- either side of
     * the last row, where vanilla keeps them beside Options and Quit.
     *
     * <p>Left as Minecraft draws them: their picture is a sprite the game
     * owns, and a Kiza surface over it would hide the only thing that says
     * what they are.
     */
    private static void placeSmallButtons(Object screen, List<Entry> buttons, MenuDesign.Plan plan) {
        MenuDesign.Slot last = null;
        for (MenuDesign.Slot slot : plan.slots) {
            if (slot != null && (last == null || slot.y > last.y)) last = slot;
        }
        if (last == null) return;
        int left = plan.centreX - MenuDesign.COLUMN_WIDTH / 2;
        int right = plan.centreX + MenuDesign.COLUMN_WIDTH / 2;
        try {
            List<?> widgets = widgets(screen);
            if (widgets == null) return;
            int placed = 0;
            for (Object widget : widgets) {
                Integer w = readInt(widget, "method_25368", "getWidth", "m_5711_", "field_146120_f", "width");
                Integer h = readInt(widget, "method_25364", "getHeight", "m_93694_", "field_146121_g", "height");
                Integer x = readInt(widget, "method_46426", "getX", "m_252754_", "field_146128_h", "xPosition", "x");
                Integer y = readInt(widget, "method_46427", "getY", "m_252907_", "field_146129_i", "yPosition", "y");
                if (w == null || h == null || x == null || y == null) continue;
                if (w < 16 || w > 24 || !w.equals(h) || !visible(widget) || isNotAButton(widget)) continue;
                Entry small = new Entry(x, y, w, h, "", widget);
                int targetX = placed == 0 ? left - MenuDesign.GAP - w : right + MenuDesign.GAP;
                int targetY = last.y + (last.height - h) / 2;
                if (!moveTo(small, targetX, targetY, w)) return;
                placed += 1;
                if (placed == 2) return;
            }
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            // They stay where Minecraft put them.
        }
    }

    /**
     * The translation key behind a button's label, wherever this version
     * keeps it.
     *
     * <p>Found by looking rather than by name: the key is a string field on
     * the label's contents, and that object is named differently in every
     * mapping and every few versions. Any string that looks like one of the
     * keys the title screen uses is the answer.
     */
    private static String translationKey(Object widget) {
        if (widget == null) return null;
        try {
            Object message = invokeNoArg(widget, "method_25369", "getMessage", "m_6035_");
            return findKey(message, 0);
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            return null;
        }
    }

    private static String findKey(Object owner, int depth) {
        if (owner == null || depth > 2) return null;
        if (owner instanceof String) return looksLikeKey((String) owner) ? (String) owner : null;
        for (Class<?> type = owner.getClass(); type != null && type != Object.class; type = type.getSuperclass()) {
            for (Field field : type.getDeclaredFields()) {
                if (java.lang.reflect.Modifier.isStatic(field.getModifiers())) continue;
                Class<?> kind = field.getType();
                if (kind.isPrimitive() || kind.isArray() || List.class.isAssignableFrom(kind)) continue;
                try {
                    field.setAccessible(true);
                    Object value = field.get(owner);
                    String found = value instanceof String
                        ? (looksLikeKey((String) value) ? (String) value : null)
                        : findKey(value, depth + 1);
                    if (found != null) return found;
                } catch (ReflectiveOperationException | RuntimeException ignored) {
                    // A field this module may not open; the label decides instead.
                }
            }
        }
        return null;
    }

    private static boolean looksLikeKey(String value) {
        return value.startsWith("menu.") || value.startsWith("fml.menu.") || value.startsWith("modmenu.");
    }

    private static boolean writeAlpha(Object widget, float alpha) {
        if (widget == null) return false;
        for (String name : new String[] {"method_25350", "setAlpha", "m_93650_"}) {
            try {
                Method method = widget.getClass().getMethod(name, float.class);
                method.invoke(widget, alpha);
                return true;
            } catch (ReflectiveOperationException | RuntimeException ignored) {
                // Try the next mapping.
            }
        }
        for (String name : new String[] {"field_22765", "f_93625_", "alpha"}) {
            for (Class<?> type = widget.getClass(); type != null; type = type.getSuperclass()) {
                try {
                    Field field = type.getDeclaredField(name);
                    if (field.getType() != float.class) continue;
                    field.setAccessible(true);
                    field.setFloat(widget, alpha);
                    return true;
                } catch (ReflectiveOperationException | RuntimeException ignored) {
                    // Try the next superclass or mapping.
                }
            }
        }
        return false;
    }

    static Layout capture(Object screen, int height, boolean respace) {
        List<Entry> buttons = collectButtons(screen);
        if (respace) spaceRows(buttons, height);
        int topButtonY = buttons.isEmpty()
            ? height * 40 / 100
            : buttons.stream().mapToInt(Entry::y).min().orElse(height * 40 / 100);
        return new Layout(Collections.unmodifiableList(new ArrayList<>(buttons)), topButtonY);
    }

    /**
     * Pushes the rows of buttons apart, moving Minecraft's widgets rather than
     * only what Kiza draws over them.
     *
     * <p>Drawing them apart and leaving the widgets where they were would put
     * every button's picture off its hit box, so the position is written and
     * vanilla's own click, focus and controller handling follows it.
     *
     * <p>This runs every frame, so it has to land on the same answer every
     * time. It does, by construction: the new gap between two rows is
     * ROW_GAP plus however much that gap exceeded the smallest one, and the
     * block is re-centred on where it already is. Run it on its own output and
     * the smallest gap is now ROW_GAP, so every gap comes out unchanged and the
     * centre has not moved. That also keeps the shape of the menu -- the wider
     * space vanilla leaves above the bottom row survives instead of being
     * flattened into an even column.
     */
    private static void spaceRows(List<Entry> buttons, int screenHeight) {
        if (cannotMoveWidgets || buttons.size() < 2 || screenHeight <= 0) return;

        List<List<Entry>> rows = rowsOf(buttons);
        if (rows.size() < 2) return;

        int[] gaps = new int[rows.size() - 1];
        int smallest = Integer.MAX_VALUE;
        for (int index = 0; index + 1 < rows.size(); index += 1) {
            Entry above = rows.get(index).get(0);
            int gap = rows.get(index + 1).get(0).y() - (above.y() + above.height());
            // A row overlapping the one above it is not a layout this
            // understands, and spreading it would only make that worse.
            if (gap < 0) return;
            gaps[index] = gap;
            if (gap < smallest) smallest = gap;
        }

        int blockHeight = 0;
        for (int index = 0; index < rows.size(); index += 1) {
            blockHeight += rows.get(index).get(0).height();
            if (index < gaps.length) blockHeight += ROW_GAP + (gaps[index] - smallest);
        }

        Entry first = rows.get(0).get(0);
        Entry last = rows.get(rows.size() - 1).get(0);
        int centre = (first.y() + last.y() + last.height()) / 2;
        int top = centre - blockHeight / 2;

        // A menu that no longer fits is a menu somebody cannot use. Vanilla's
        // spacing was chosen to fit; ours is an improvement only while there is
        // room for it.
        if (top < MARGIN_TOP || top + blockHeight > screenHeight - MARGIN_BOTTOM) return;

        int[] targets = new int[rows.size()];
        int cursor = top;
        for (int index = 0; index < rows.size(); index += 1) {
            targets[index] = cursor;
            cursor += rows.get(index).get(0).height();
            if (index < gaps.length) cursor += ROW_GAP + (gaps[index] - smallest);
        }

        for (int index = 0; index < rows.size(); index += 1) {
            for (Entry entry : rows.get(index)) {
                if (entry.y() == targets[index]) continue;
                if (!moveWidget(entry, targets[index])) {
                    // Half a menu moved is worse than none of it. Stop at the
                    // first refusal and never ask again on this run.
                    cannotMoveWidgets = true;
                    return;
                }
            }
        }
    }

    /** Buttons grouped by the row they sit on, rows ordered down the screen. */
    private static List<List<Entry>> rowsOf(List<Entry> buttons) {
        List<Entry> sorted = new ArrayList<>(buttons);
        sorted.sort(new java.util.Comparator<Entry>() {
            @Override
            public int compare(Entry left, Entry right) {
                return Integer.compare(left.y(), right.y());
            }
        });

        List<List<Entry>> rows = new ArrayList<>();
        for (Entry entry : sorted) {
            List<Entry> row = rows.isEmpty() ? null : rows.get(rows.size() - 1);
            if (row != null
                && Math.abs(entry.y() - row.get(0).y()) <= SAME_ROW
                && entry.height() == row.get(0).height()) {
                row.add(entry);
            } else {
                List<Entry> started = new ArrayList<>();
                started.add(entry);
                rows.add(started);
            }
        }
        return rows;
    }

    /**
     * Writes a widget's y, and reads it back to be sure it took.
     *
     * <p>Reflection that silently does nothing is the failure mode here: a
     * setter that exists under a different name, a field this version moved to
     * another class. Reading back turns "it did not work" into something this
     * can act on, which is to stop moving anything at all.
     */
    private static boolean moveWidget(Entry entry, int y) {
        Object widget = entry.widget();
        if (widget == null) return false;
        if (!writeInt(widget, y, "method_46419", "setY", "m_253211_")
            && !writeField(widget, y, "field_146129_i", "yPosition", "y")) {
            return false;
        }
        Integer readBack = readInt(
            widget, "method_46427", "getY", "m_252907_", "field_146129_i", "yPosition", "y"
        );
        if (readBack == null || readBack != y) return false;
        entry.moveTo(y);
        return true;
    }

    private static boolean writeInt(Object owner, int value, String... methodNames) {
        for (String name : methodNames) {
            try {
                Method method = owner.getClass().getMethod(name, int.class);
                method.setAccessible(true);
                method.invoke(owner, value);
                return true;
            } catch (ReflectiveOperationException | RuntimeException ignored) {
                // Try the next mapping.
            }
        }
        return false;
    }

    private static boolean writeField(Object owner, int value, String... fieldNames) {
        for (String name : fieldNames) {
            for (Class<?> type = owner.getClass(); type != null; type = type.getSuperclass()) {
                try {
                    Field field = type.getDeclaredField(name);
                    if (field.getType() != int.class) continue;
                    field.setAccessible(true);
                    field.setInt(owner, value);
                    return true;
                } catch (ReflectiveOperationException | RuntimeException ignored) {
                    // Try the next superclass or mapping.
                }
            }
        }
        return false;
    }

    static void render(
        Object graphics,
        Object screen,
        int width,
        Layout layout,
        int mouseX,
        int mouseY
    ) {
        render(graphics, screen, width, layout, mouseX, mouseY, true, true);
    }

    /**
     * @param brand     whether to draw the Minecraft wordmark above the buttons
     * @param highlight whether the first button is the one the screen leads with
     */
    static void render(
        Object graphics,
        Object screen,
        int width,
        Layout layout,
        int mouseX,
        int mouseY,
        boolean brand,
        boolean highlight
    ) {
        if (width < 360 || !layout.supported()) return;

        if (layout.plan() != null) {
            renderTitleGrid(graphics, screen, layout, mouseX, mouseY);
            return;
        }

        // The wordmark belongs to the two screens that are Minecraft's front
        // door. It was drawn here for every screen the buttons were drawn on,
        // which was fine while that meant two screens and became absurd the
        // moment it meant all of them: a MINECRAFT logo across the statistics,
        // across the player list, and across the screen you get for sleeping.
        if (brand) drawBrandBlock(graphics, width, layout.topButtonY());

        for (int index = 0; index < layout.buttons().size(); index += 1) {
            drawMenuButton(graphics, layout.buttons().get(index), mouseX, mouseY, brand);
        }
    }

    /**
     * The Kiza title menu: the emblem, KIZA CLIENT, and the grid of buttons,
     * arriving one after another the first time the screen is shown.
     *
     * <p>The arrival only plays where Minecraft's buttons could be faded out:
     * with them still showing, a Kiza button rising into place would uncover
     * a grey one for the length of the animation.
     */
    private static void renderTitleGrid(
        Object graphics,
        Object screen,
        Layout layout,
        int mouseX,
        int mouseY
    ) {
        MenuDesign.Plan plan = layout.plan();
        Animations.beginFrame(screen);
        boolean animate = layout.vanillaHidden();

        float brand = animate ? Animations.brand() : 1F;
        int brandFade = Animations.step(brand, Buttons.FADE_STEPS);
        int rise = Math.round((1F - brand) * Animations.RISE);
        if (brandFade > 0) {
            // The pointer over the emblem sends a violet light across it.
            boolean overEmblem = mouseX >= plan.emblemX && mouseX < plan.emblemX + plan.emblemSize
                && mouseY >= plan.emblemY && mouseY < plan.emblemY + plan.emblemSize;
            float glow = Animations.hover(EMBLEM_KEY, overEmblem);
            int sweep = Animations.sweep(EMBLEM_KEY, overEmblem, Buttons.SWEEP_STEPS);
            Object emblem = Buttons.emblem(
                plan.emblemSize, brandFade, Animations.step(glow, Buttons.HOVER_STEPS), sweep
            );
            int scale = Buttons.supersample();
            if (emblem != null) {
                // The texture carries a margin for the glow around the emblem.
                int pad = Buttons.EMBLEM_GLOW;
                int drawn = plan.emblemSize + pad * 2;
                MenuLogoRenderer.blitTexture(graphics, emblem, plan.emblemX - pad, plan.emblemY - pad + rise,
                    drawn, drawn, drawn * scale, drawn * scale);
            }
            int[] size = new int[2];
            // Under the emblem here, where there is room for the two to stand
            // one above the other; the pause menu sets them side by side.
            Object wordmark = Buttons.wordmark(brandFade, MenuDesign.WORDMARK_SIZE, size);
            if (wordmark != null) {
                int w = size[0] / scale;
                int h = size[1] / scale;
                MenuLogoRenderer.blitTexture(graphics, wordmark, plan.centreX - w / 2,
                    plan.wordmarkY - Buttons.WORDMARK_PAD + rise, w, h, size[0], size[1]);
            }
        }

        int order = 0;
        for (Entry entry : layout.buttons()) {
            MenuDesign.Slot slot = entry.slot();
            if (slot == null) continue;
            float arrived = animate ? Animations.entrance(order) : 1F;
            order += 1;
            int fade = Animations.step(arrived, Buttons.FADE_STEPS);
            if (fade == 0) continue;
            boolean hovered = mouseX >= slot.x && mouseX < slot.x + slot.width
                && mouseY >= slot.y && mouseY < slot.y + slot.height;
            hovered = active(entry.widget()) && (hovered || focused(entry.widget()));
            float hover = Animations.hover(entry.widget(), hovered);
            int y = slot.y + Math.round((1F - arrived) * Animations.RISE);
            if (!layout.vanillaHidden()) {
                // Minecraft's button is still drawn: cover it before the
                // rounded surface goes on, or its corners show.
                MenuLogoRenderer.fill(graphics, entry.x(), entry.y(), entry.x() + entry.width(),
                    entry.y() + entry.height(), COLOR_OCCLUSION);
            }
            Object texture = Buttons.texture(
                MenuDesign.displayLabel(entry.role(), entry.label()),
                entry.role(),
                slot.width,
                slot.height,
                Animations.step(hover, Buttons.HOVER_STEPS),
                fade,
                active(entry.widget())
            );
            if (texture == null) continue;
            int scale = Buttons.supersample();
            MenuLogoRenderer.blitTexture(graphics, texture, slot.x, y, slot.width, slot.height,
                slot.width * scale, slot.height * scale);
        }
    }

    /** What the emblem's hover is remembered under; it has no widget of its own. */
    private static final Object EMBLEM_KEY = new Object();

    /** Whether the keyboard or a controller is on this button. */
    private static boolean focused(Object widget) {
        if (widget == null) return false;
        Boolean focused = readBoolean(widget, "field_22762", "focused", "f_93616_");
        return focused != null && focused;
    }

    // Minecraft remains the product identity; Kiza branding stays in the footer.
    /**
     * The Kiza emblem and KIZA CLIENT side by side, over the pause menu.
     *
     * <p>It was Minecraft's own wordmark, which made the pause menu the one
     * Kiza screen still signed by somebody else. Side by side rather than
     * stacked: the room between the screen's title and its first button is
     * a strip, and an emblem tall enough to read would not fit above a name.
     */
    private static void drawBrandBlock(Object graphics, int width, int topButtonY) {
        int minTop = 24;
        int available = topButtonY - 10 - minTop;
        int emblem = Math.min(40, available);
        if (emblem < 18) return;
        int scale = Buttons.supersample();
        int[] size = new int[2];
        // Beside the emblem, a little under half its height: the strip above
        // the pause menu's buttons is too short to stack them.
        Object wordmark = Buttons.wordmark(Buttons.FADE_STEPS, Math.max(10, emblem * 45 / 100), size);
        int wordWidth = wordmark == null ? 0 : size[0] / scale;
        int wordHeight = wordmark == null ? 0 : size[1] / scale;
        int gap = wordmark == null ? 0 : 6;
        int left = width / 2 - (emblem + gap + wordWidth) / 2;
        int top = minTop + Math.max(0, (available - emblem) / 2);

        Object picture = Buttons.emblem(emblem, Buttons.FADE_STEPS, 0, 0);
        if (picture != null) {
            int pad = Buttons.EMBLEM_GLOW;
            int drawn = emblem + pad * 2;
            MenuLogoRenderer.blitTexture(graphics, picture, left - pad, top - pad, drawn, drawn,
                drawn * scale, drawn * scale);
        }
        if (wordmark != null) {
            MenuLogoRenderer.blitTexture(graphics, wordmark, left + emblem + gap,
                top + (emblem - wordHeight) / 2, wordWidth, wordHeight, size[0], size[1]);
        }
    }

    /**
     * One button on any Minecraft screen, in the same material as the title
     * menu: dark, a rim catching the light, a violet fill under the pointer,
     * the label in spaced capitals.
     *
     * <p>The button stays where the screen put it; only the title screen is
     * rearranged. Minecraft's own is faded out underneath where this version
     * allows it, and covered by a square of the background colour where it
     * does not -- that square is what kept its grey corners from showing
     * round a rounded surface.
     *
     * @param icons whether the label may carry a picture: only on the title
     *              and pause screens, whose buttons Kiza recognises
     */
    private static void drawMenuButton(Object graphics, Entry button, int mouseX, int mouseY, boolean icons) {
        Object widget = button.widget();
        int left = button.x();
        int top = button.y();
        int grow = fr.kiza.basemod.menu.MenuDesign.GROW;
        int width = button.width() + grow * 2;
        int height = button.height() + grow * 2;

        boolean enabled = active(widget);
        boolean pointer = mouseX >= left && mouseX < left + button.width()
            && mouseY >= top && mouseY < top + button.height();
        boolean hovered = enabled && (pointer || focused(widget));
        float hover = Animations.hover(widget, hovered);

        if (button.slider) {
            Double value = sliderValue(widget);
            if (value == null) return;
            Object slider = Buttons.slider(
                button.label(),
                width,
                height,
                Animations.step((float) Math.max(0D, Math.min(1D, value)), Buttons.SLIDER_STEPS),
                Animations.step(hover, Buttons.HOVER_STEPS),
                enabled
            );
            if (slider == null) return;
            if (!hide(widget)) {
                MenuLogoRenderer.fill(graphics, left, top, left + button.width(), top + button.height(), COLOR_OCCLUSION);
            }
            int sliderScale = Buttons.supersample();
            MenuLogoRenderer.blitTexture(graphics, slider, left - grow, top - grow, width, height,
                width * sliderScale, height * sliderScale);
            return;
        }

        MenuDesign.Role role = icons
            ? MenuDesign.roleOf(translationKey(widget), button.label())
            : MenuDesign.Role.OTHER;
        Object texture = Buttons.texture(
            MenuDesign.displayLabel(role, button.label()),
            role,
            width,
            height,
            Animations.step(hover, Buttons.HOVER_STEPS),
            Buttons.FADE_STEPS,
            enabled
        );
        if (texture == null) {
            // No canvas on this build: Minecraft's own button is left showing.
            return;
        }
        if (!hide(widget)) {
            MenuLogoRenderer.fill(graphics, left, top, left + button.width(), top + button.height(), COLOR_OCCLUSION);
        }
        int scale = Buttons.supersample();
        MenuLogoRenderer.blitTexture(graphics, texture, left - grow, top - grow, width, height,
            width * scale, height * scale);
    }

    /** Widget types that would not be faded, so they are not asked again every frame. */
    private static final Set<Class<?>> CANNOT_HIDE = new HashSet<>();

    /**
     * Fades Minecraft's button out under Kiza's, where this version lets it.
     *
     * <p>A refusal counts for that kind of widget only. It used to switch the
     * fading off for everything, so one widget a mod made without an alpha
     * left every grey button on the screen showing under Kiza's corners.
     */
    private static boolean hide(Object widget) {
        if (widget == null || CANNOT_HIDE.contains(widget.getClass())) return false;
        if (writeAlpha(widget, HIDDEN_ALPHA)) return true;
        CANNOT_HIDE.add(widget.getClass());
        return false;
    }

    /**
     * Whether the button can be pressed right now. A greyed-out button in
     * vanilla is a dimmed one here; drawn at full strength it would invite a
     * click that does nothing.
     */
    private static boolean active(Object widget) {
        if (widget == null) return true;
        Boolean active = readBoolean(widget, "field_22763", "active", "f_93623_", "field_146124_l", "enabled");
        return active == null || active;
    }

    /**
     * Trims a label to the room its button has.
     *
     * <p>Minecraft shortens its own labels to the widget; Kiza measured the
     * full string and centred that, so a translation longer than its button
     * ran out past both edges and over whatever was beside it.
     */
    static String fitted(String label, int room) {
        if (room <= 0) return "";
        if (MenuLogoRenderer.textWidth(label) <= room) return label;

        String ellipsis = "...";
        int forEllipsis = MenuLogoRenderer.textWidth(ellipsis);
        if (forEllipsis > room) return "";
        int end = label.length();
        while (end > 0
            && MenuLogoRenderer.textWidth(label.substring(0, end)) + forEllipsis > room) {
            end -= 1;
        }
        return label.substring(0, end) + ellipsis;
    }

    private static void outline(Object graphics, int left, int top, int right, int bottom, int radius, int color) {
        MenuLogoRenderer.roundedFill(graphics, left, top, right, top + 1, radius, color);
        MenuLogoRenderer.roundedFill(graphics, left, bottom - 1, right, bottom, radius, color);
        MenuLogoRenderer.fill(graphics, left, top + 1, left + 1, bottom - 1, color);
        MenuLogoRenderer.fill(graphics, right - 1, top + 1, right, bottom - 1, color);
    }

    private static List<Entry> collectButtons(Object screen) {
        List<Entry> entries = new ArrayList<>();
        try {
            List<?> widgets = widgets(screen);
            if (widgets == null) return entries;
            collect(widgets, null, 0, entries);
        } catch (ReflectiveOperationException | RuntimeException error) {
            // Keep the native menu intact and retry on the next screen.
        }
        return withoutOverlaps(entries);
    }

    /**
     * Gathers the buttons and sliders in a list of widgets, and in the lists
     * those hold.
     *
     * <p>The screen's own children were all that used to be looked at, and
     * every options page keeps its controls one level down: in a scrolling
     * list, whose rows each hold a button or two. So Video Settings, Music
     * and Sounds and the rest stayed grey while the screens around them were
     * Kiza's. A widget too tall to be a button and holding children of its
     * own is now looked into.
     *
     * <p>What a list holds is drawn only when the whole of it is inside the
     * list's visible area. A row half scrolled away is clipped by the game;
     * Kiza's surface, drawn after, would not be, and would lie over the
     * screen's title. A list whose bounds this version does not expose is left
     * as it is.
     *
     * @param clip the visible band, top and bottom, or null for the whole screen
     */
    private static void collect(List<?> widgets, int[] clip, int depth, List<Entry> entries) {
        for (Object widget : widgets) {
            if (widget == null) continue;
            Integer width = readInt(
                widget, "method_25368", "getWidth", "m_5711_", "field_146120_f", "width"
            );
            Integer height = readInt(
                widget, "method_25364", "getHeight", "m_93694_", "field_146121_g", "height"
            );
            Integer x = readInt(
                widget, "method_46426", "getX", "m_252754_", "field_146128_h", "xPosition", "x"
            );
            Integer y = readInt(
                widget, "method_46427", "getY", "m_252907_", "field_146129_i", "yPosition", "y"
            );
            boolean bounded = width != null && height != null && x != null && y != null;

            // Something that holds widgets is a container, whatever its size.
            // A row of an options list is button-sized on recent versions --
            // it has a position and a width of its own -- and was drawn as a
            // blank button over the very controls it holds.
            List<?> children = depth < 3 ? childrenOf(widget) : null;
            boolean container = children != null && !children.isEmpty();

            if (!container
                && bounded
                && width >= MIN_BUTTON_WIDTH && width <= MAX_BUTTON_WIDTH
                && height >= 14 && height <= 34) {
                // A screen keeps widgets it is not currently drawing: the pause
                // menu holds buttons a mod has hidden, and the game skips them
                // on the way to the screen. Kiza painted them anyway, so an
                // invisible button came back as a solid Kiza panel lying across
                // the ones next to it.
                if (!visible(widget)) continue;
                if (clip != null && (y < clip[0] || y + height > clip[1])) continue;
                boolean slider = isSlider(widget);
                // Text fields, checkboxes and tabs draw what they hold
                // themselves, and an opaque surface over them would hide it.
                if (!slider && isNotAButton(widget)) continue;
                Entry entry = new Entry(x, y, width, height, label(widget), widget);
                entry.slider = slider;
                entries.add(entry);
                continue;
            }

            if (!container) continue;
            int[] inner = clip;
            if (bounded) {
                int top = y;
                int bottom = y + height;
                inner = clip == null
                    ? new int[] {top, bottom}
                    : new int[] {Math.max(clip[0], top), Math.min(clip[1], bottom)};
            } else if (depth == 0) {
                // A list on the screen whose bounds cannot be read: what it
                // holds may be scrolled under the title, so it is left alone.
                continue;
            }
            collect(children, inner, depth + 1, entries);
        }
    }

    private static final java.util.Map<Class<?>, Method> CHILDREN = new java.util.HashMap<>();

    /** What a container -- a list, one of its rows -- holds, or null. */
    private static List<?> childrenOf(Object owner) {
        Class<?> type = owner.getClass();
        Method method = CHILDREN.get(type);
        if (method == null && !CHILDREN.containsKey(type)) {
            for (String name : new String[] {"method_25396", "children", "m_6702_"}) {
                try {
                    Method candidate = type.getMethod(name);
                    if (List.class.isAssignableFrom(candidate.getReturnType())) {
                        candidate.setAccessible(true);
                        method = candidate;
                        break;
                    }
                } catch (ReflectiveOperationException | RuntimeException ignored) {
                    // Try the next mapping.
                }
            }
            CHILDREN.put(type, method);
        }
        if (method == null) return null;
        try {
            Object result = method.invoke(owner);
            return result instanceof List<?> ? (List<?>) result : null;
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            return null;
        }
    }

    /**
     * Drops a button that lies across a smaller one.
     *
     * <p>Kiza paints an opaque surface per button, so two overlapping bounds do
     * not merely look crowded: the wider one erases the narrower one's label
     * outright. Whatever put them there, the narrower button is the more
     * specific of the two, so it is the one that survives.
     */
    private static List<Entry> withoutOverlaps(List<Entry> entries) {
        List<Entry> kept = new ArrayList<>();
        for (Entry candidate : entries) {
            boolean swallowsSomething = false;
            for (Entry other : entries) {
                if (other == candidate) continue;
                if (area(candidate) > area(other) && overlaps(candidate, other)) {
                    swallowsSomething = true;
                    break;
                }
            }
            if (!swallowsSomething) kept.add(candidate);
        }
        return kept;
    }

    private static long area(Entry entry) {
        return (long) entry.width() * (long) entry.height();
    }

    private static boolean overlaps(Entry left, Entry right) {
        return left.x() < right.x() + right.width()
            && right.x() < left.x() + left.width()
            && left.y() < right.y() + right.height()
            && right.y() < left.y() + left.height();
    }

    /**
     * Whether the game would draw this widget at all.
     *
     * <p>Unknown means yes: on a version where the field cannot be found, this
     * leaves the menu exactly as it was rather than emptying it.
     */
    private static boolean visible(Object widget) {
        Boolean drawn = readBoolean(
            widget, "field_22764", "visible", "f_93624_", "field_146125_m"
        );
        return drawn == null || drawn;
    }

    private static List<?> widgets(Object screen) throws ReflectiveOperationException {
        try {
            if (childrenMethod == null) childrenMethod = findChildrenMethod(screen.getClass());
            Object result = childrenMethod.invoke(screen);
            if (result instanceof List<?>) return (List<?>) result;
        } catch (NoSuchMethodException ignored) {
            // Minecraft 1.7-1.12 exposes a button-list field instead.
        }

        Object result = readField(screen, "field_146292_n", "buttonList");
        return result instanceof List<?> ? (List<?>) result : null;
    }

    private static String label(Object widget) {
        try {
            Object message = invokeNoArg(widget, "method_25369", "getMessage", "m_6035_");
            if (message != null) {
                Object text = invokeNoArg(message, "getString", "method_10851");
                if (text instanceof String) return (String) text;
            }
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            // Fall back to the public string field used by legacy GuiButton.
        }
        Object message = readField(widget, "field_146126_j", "displayString");
        return message instanceof String ? (String) message : "";
    }

    private static Method findChildrenMethod(Class<?> screenType) throws NoSuchMethodException {
        for (String name : new String[] {"method_25396", "children", "m_6702_"}) {
            for (Class<?> type = screenType; type != null; type = type.getSuperclass()) {
                try {
                    Method method = type.getDeclaredMethod(name);
                    if (List.class.isAssignableFrom(method.getReturnType())) {
                        method.setAccessible(true);
                        return method;
                    }
                } catch (NoSuchMethodException ignored) {
                    // Try the next name or superclass.
                }
            }
        }
        throw new NoSuchMethodException("Screen children accessor");
    }

    private static Boolean readBoolean(Object owner, String... names) {
        for (String name : names) {
            for (Class<?> type = owner.getClass(); type != null; type = type.getSuperclass()) {
                try {
                    Field field = type.getDeclaredField(name);
                    if (field.getType() == boolean.class) {
                        field.setAccessible(true);
                        return field.getBoolean(owner);
                    }
                } catch (ReflectiveOperationException | RuntimeException ignored) {
                    // Try the next superclass or mapping.
                }
            }
        }
        return null;
    }

    /**
     * Widget types that are the size of a button and are not one.
     *
     * <p>Matched on the hierarchy, not the concrete class: a mod's slider still
     * extends Minecraft's, and it is the base type that says what the thing is.
     * Names are checked as text so a class that does not exist on this version
     * simply never matches.
     */
    private static final Set<String> NOT_BUTTONS = new HashSet<>(Arrays.asList(
        // Checkboxes: the tick is the whole point, and a surface over it hides it.
        "net.minecraft.client.gui.components.Checkbox",
        "net.minecraft.client.gui.widget.CheckboxButton",
        "net.minecraft.class_4286",
        // Tabs: which one is selected is drawn by the tab itself.
        "net.minecraft.client.gui.components.tabs.TabButton",
        "net.minecraft.class_8088",
        // Text fields.
        "net.minecraft.client.gui.components.EditBox",
        "net.minecraft.client.gui.widget.TextFieldWidget",
        "net.minecraft.class_342",
        "net.minecraft.client.gui.GuiTextField"
    ));

    /** Sliders, drawn by Kiza with their value rather than left grey. */
    private static final Set<String> SLIDERS = new HashSet<>(Arrays.asList(
        "net.minecraft.client.gui.components.AbstractSliderButton",
        "net.minecraft.client.gui.widget.AbstractSliderButton",
        "net.minecraft.class_357",
        "net.minecraft.client.gui.GuiSlider",
        "net.minecraft.client.gui.GuiOptionSlider"
    ));

    private static boolean isSlider(Object widget) {
        for (Class<?> type = widget.getClass(); type != null; type = type.getSuperclass()) {
            if (SLIDERS.contains(type.getName())) return true;
        }
        return false;
    }

    /** Where a slider's handle is, 0 to 1, or null when it cannot be read. */
    private static Double sliderValue(Object widget) {
        for (String name : new String[] {"field_22753", "value", "f_93577_", "field_146134_p", "sliderValue"}) {
            for (Class<?> type = widget.getClass(); type != null; type = type.getSuperclass()) {
                try {
                    Field field = type.getDeclaredField(name);
                    field.setAccessible(true);
                    if (field.getType() == double.class) return field.getDouble(widget);
                    if (field.getType() == float.class) return (double) field.getFloat(widget);
                } catch (ReflectiveOperationException | RuntimeException ignored) {
                    // Try the next superclass or mapping.
                }
            }
        }
        return null;
    }

    private static boolean isNotAButton(Object widget) {
        for (Class<?> type = widget.getClass(); type != null; type = type.getSuperclass()) {
            if (NOT_BUTTONS.contains(type.getName())) return true;
        }
        return false;
    }

    private static Integer readInt(Object owner, String... methodNames) {
        for (String name : methodNames) {
            try {
                Method method = owner.getClass().getMethod(name);
                if (method.getParameterCount() == 0 && method.getReturnType() == int.class) {
                    return (int) method.invoke(owner);
                }
            } catch (ReflectiveOperationException | RuntimeException ignored) {
                for (Class<?> type = owner.getClass(); type != null; type = type.getSuperclass()) {
                    try {
                        Field field = type.getDeclaredField(name);
                        if (field.getType() == int.class) {
                            field.setAccessible(true);
                            return field.getInt(owner);
                        }
                    } catch (ReflectiveOperationException | RuntimeException ignoredField) {
                        // Try the next superclass or mapping.
                    }
                }
            }
        }
        return null;
    }

    private static Object readField(Object owner, String... names) {
        if (owner == null) return null;
        for (String name : names) {
            for (Class<?> type = owner.getClass(); type != null; type = type.getSuperclass()) {
                try {
                    Field field = type.getDeclaredField(name);
                    field.setAccessible(true);
                    return field.get(owner);
                } catch (ReflectiveOperationException | RuntimeException ignored) {
                    // Try the next superclass or mapping.
                }
            }
        }
        return null;
    }

    private static Object invokeNoArg(Object owner, String... methodNames)
        throws ReflectiveOperationException {
        for (String name : methodNames) {
            try {
                Method method = owner.getClass().getMethod(name);
                if (method.getParameterCount() == 0) {
                    method.setAccessible(true);
                    return method.invoke(owner);
                }
            } catch (NoSuchMethodException ignored) {
                // Try the next mapped name.
            }
        }
        return null;
    }
}
