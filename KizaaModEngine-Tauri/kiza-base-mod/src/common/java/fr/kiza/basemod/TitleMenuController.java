package fr.kiza.basemod;

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
    private static final int MIN_BUTTON_WIDTH = 88;
    private static final int MAX_BUTTON_WIDTH = 420;

    private static Method childrenMethod;

    static final class Entry {
        private final int x;
        private int y;
        private final int width;
        private final int height;
        private final String label;
        /** The widget these bounds were read from, so its y can be written back. */
        private final Object widget;

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

        Layout(List<Entry> buttons, int topButtonY) {
            this.buttons = buttons;
            this.topButtonY = topButtonY;
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

        // The wordmark belongs to the two screens that are Minecraft's front
        // door. It was drawn here for every screen the buttons were drawn on,
        // which was fine while that meant two screens and became absurd the
        // moment it meant all of them: a MINECRAFT logo across the statistics,
        // across the player list, and across the screen you get for sleeping.
        if (brand) drawBrandBlock(graphics, width, layout.topButtonY());

        for (int index = 0; index < layout.buttons().size(); index += 1) {
            drawMenuButton(
                graphics,
                screen,
                layout.buttons().get(index),
                mouseX,
                mouseY,
                // Options has no primary action, and neither has a settings
                // page. Accenting whichever button happens to be topmost tells
                // the player something that is not true.
                highlight && index == 0
            );
        }
    }

    // Minecraft remains the product identity; Kiza branding stays in the footer.
    private static void drawBrandBlock(Object graphics, int width, int topButtonY) {
        int centerX = width / 2;
        int minTop = 24;

        // Fit the complete transparent header above the button stack,
        // scaling it down on short windows so nothing overlaps.
        int available = topButtonY - 12 - minTop;
        int logoHeight = Math.max(24, Math.min(LOGO_HEIGHT, available));
        // The width comes from the renderer that owns the texture, because the
        // wordmark is 256x44 on one version and 310x44 on another and a copy of
        // that ratio here is a copy that can disagree.
        int logoWidth = MenuLogoRenderer.logoWidthFor(logoHeight);

        int logoTop = minTop + Math.max(0, (topButtonY - minTop - logoHeight) / 2);

        MenuLogoRenderer.drawMinecraftLogoAt(
            graphics,
            centerX - logoWidth / 2,
            logoTop,
            logoWidth,
            logoHeight
        );
    }

    private static void drawMenuButton(
        Object graphics,
        Object screen,
        Entry button,
        int mouseX,
        int mouseY,
        boolean primary
    ) {
        int left = button.x();
        int top = button.y();
        int right = left + button.width();
        int bottom = top + button.height();
        // Grown by a pixel on every side, so it covers Minecraft's button
        // whole -- corners included -- instead of sitting inside it.
        //
        // Vanilla's button is still under this one: it is what handles the
        // click, the keyboard focus and the controller, so it cannot go away,
        // and it is a square. A rounded shape the same size leaves the square's
        // four corners sticking out, which is what read as black blocks.
        //
        // A rounded rectangle grown by N covers the corner of the rectangle it
        // grew from when N is at least r(1 - 1/sqrt2), about 0.3 of the radius.
        // At radius 3 that is one pixel. Vanilla stacks these on a 24 pixel
        // pitch and they are 20 tall, so one pixel each way is also all there
        // is to spend: at 2 the buttons would touch, and a rounder shape needs
        // more growth than the layout has room for.
        int radius = 3;
        int grow = 1;

        boolean hovered = mouseX >= left && mouseX < right && mouseY >= top && mouseY < bottom;

        // Still square, and still underneath.
        //
        // The glass above now covers vanilla's button entirely, so this is no
        // longer what hides it. What it does is give the glass's antialiased
        // outer pixels something of ours to be blended against: without it that
        // one-pixel fringe would be mixed with vanilla's grey border, and a
        // faint grey outline would trace every button.
        MenuLogoRenderer.fill(graphics, left, top, right, bottom, COLOR_OCCLUSION);
        int fill = hovered
            ? fr.kiza.basemod.render.KizaMaterial.SURFACE_HOVER
            : (primary
                ? fr.kiza.basemod.render.KizaMaterial.SURFACE_PRIMARY
                : fr.kiza.basemod.render.KizaMaterial.SURFACE);
        int border = hovered
            ? fr.kiza.basemod.render.KizaMaterial.EDGE_HOVER
            : (primary
                ? fr.kiza.basemod.render.KizaMaterial.EDGE_PRIMARY
                : fr.kiza.basemod.render.KizaMaterial.EDGE);

        // Frosted glass rather than a filled rectangle with a line round it.
        // The difference is the rim: brightest along the top and falling away,
        // the way an edge catching the light does, rather than one flat colour
        // all the way round. It is drawn into the texture, so a frame still
        // costs one blit.
        //
        // No shadow and no padding, and KizaMaterial says why: the cover under
        // this surface has to be square, so a soft ring around a rounded shape
        // sitting on it reads as a square rather than as a shadow. The glass
        // ends exactly where vanilla's button does, which is also what the
        // pointer is tested against.
        int panelWidth = button.width() + grow * 2;
        int panelHeight = button.height() + grow * 2;
        Object panel = fr.kiza.basemod.render.KizaGlass.texture(
            panelWidth,
            panelHeight,
            0,
            radius,
            fill,
            border,
            fr.kiza.basemod.render.KizaMaterial.SHEEN,
            0
        );
        if (panel != null) {
            int supersample = fr.kiza.basemod.render.KizaGlass.supersample();
            MenuLogoRenderer.blitTexture(
                graphics,
                panel,
                left - grow,
                top - grow,
                panelWidth,
                panelHeight,
                panelWidth * supersample,
                panelHeight * supersample
            );
        } else {
            MenuLogoRenderer.roundedFill(graphics, left, top, right, bottom, radius, fill);
            outline(graphics, left, top, right, bottom, radius, border);
        }

        // Label only, centred on both axes. The width comes from the renderer
        // that will actually draw it, so the centring is exact rather than an
        // estimate from the character count.
        String label = button.label();
        if (label.trim().isEmpty()) return;

        String fitted = fitted(label, button.width() - 8);
        // Measured in the weight it will be drawn in. A bold label measured as
        // a plain one is centred by a number that is a few pixels short, and
        // every label on the screen sits fractionally left.
        int textWidth = MenuLogoRenderer.textWidth(fitted, LABELS_ARE_BOLD);
        // The height this label will really be drawn at, not vanilla's line
        // height: centring against a number the renderer does not use put every
        // label a couple of pixels low.
        int textHeight = MenuLogoRenderer.textHeight(fitted, LABELS_ARE_BOLD);
        MenuLogoRenderer.drawText(
            graphics,
            screen,
            fitted,
            left + (button.width() - textWidth) / 2,
            top + (button.height() - textHeight) / 2,
            COLOR_TEXT,
            LABELS_ARE_BOLD
        );
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

            for (Object widget : widgets) {
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
                if (width == null || height == null || x == null || y == null) continue;
                if (width < MIN_BUTTON_WIDTH || width > MAX_BUTTON_WIDTH) continue;
                if (height < 14 || height > 34) continue;
                // A screen keeps widgets it is not currently drawing: the pause
                // menu holds buttons a mod has hidden, and the game skips them
                // on the way to the screen. Kiza painted them anyway, so an
                // invisible button came back as a solid Kiza panel lying across
                // the ones next to it.
                if (!visible(widget)) continue;
                // A slider is the right size to be mistaken for a button and
                // the wrong thing to cover: its handle is the part that says
                // where the value sits, and an opaque surface over it leaves a
                // control that cannot be read. Text fields go for the same
                // reason -- what is typed in them is drawn by the widget.
                if (isNotAButton(widget)) continue;

                entries.add(new Entry(x, y, width, height, label(widget), widget));
            }
        } catch (ReflectiveOperationException | RuntimeException error) {
            // Keep the native menu intact and retry on the next screen.
        }
        return withoutOverlaps(entries);
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
        // Sliders.
        "net.minecraft.client.gui.components.AbstractSliderButton",
        "net.minecraft.client.gui.widget.AbstractSliderButton",
        "net.minecraft.class_357",
        "net.minecraft.client.gui.GuiSlider",
        "net.minecraft.client.gui.GuiOptionSlider",
        // Text fields.
        "net.minecraft.client.gui.components.EditBox",
        "net.minecraft.client.gui.widget.TextFieldWidget",
        "net.minecraft.class_342",
        "net.minecraft.client.gui.GuiTextField"
    ));

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
