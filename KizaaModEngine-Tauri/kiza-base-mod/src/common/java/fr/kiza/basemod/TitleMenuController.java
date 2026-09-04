package fr.kiza.basemod;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collections;
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
        private final int y;
        private final int width;
        private final int height;
        private final String label;

        Entry(int x, int y, int width, int height, String label) {
            this.x = x;
            this.y = y;
            this.width = width;
            this.height = height;
            this.label = label;
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

    static Layout capture(Object screen, int height) {
        List<Entry> buttons = collectButtons(screen);
        int topButtonY = buttons.isEmpty()
            ? height * 40 / 100
            : buttons.stream().mapToInt(Entry::y).min().orElse(height * 40 / 100);
        return new Layout(Collections.unmodifiableList(new ArrayList<>(buttons)), topButtonY);
    }

    static void render(
        Object graphics,
        Object screen,
        int width,
        Layout layout,
        int mouseX,
        int mouseY
    ) {
        if (width < 360 || !layout.supported()) return;

        drawBrandBlock(graphics, width, layout.topButtonY());
        for (int index = 0; index < layout.buttons().size(); index += 1) {
            drawMenuButton(
                graphics,
                screen,
                layout.buttons().get(index),
                mouseX,
                mouseY,
                index == 0
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
        // Small on purpose, and this is the reason.
        //
        // Minecraft's own button is still under this one -- it is what handles
        // the click -- and it has to be covered by an opaque square, or its
        // border shows through as four grey notches. So the square's corners
        // sit outside our rounded shape however round we make it, and the
        // rounder the shape the more of that square there is to see. At eight
        // pixels they read as black blocks at each corner. At three they are
        // a pixel or two of dark against a dark button.
        //
        // The real fix is to stop vanilla drawing the button at all, which
        // means a mixin on the widget itself across four loader generations.
        // Worth doing deliberately, not in passing.
        int radius = Math.min(3, button.height() / 2);
        boolean hovered = mouseX >= left && mouseX < right && mouseY >= top && mouseY < bottom;

        // Square, not rounded, and that is the whole point.
        //
        // Vanilla draws its own button first; this covers it. Rounding the
        // cover left the four corners of the vanilla button uncovered, and its
        // grey border showed through them as little grey notches around every
        // Kiza button — buttons behind the buttons. The rounded Kiza surface
        // goes on top of this, so the only thing the corners cost is a few
        // dark pixels where vanilla's used to be.
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
        Object panel = fr.kiza.basemod.render.KizaGlass.texture(
            button.width(),
            button.height(),
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
                left,
                top,
                button.width(),
                button.height(),
                button.width() * supersample,
                button.height() * supersample
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

                entries.add(new Entry(x, y, width, height, label(widget)));
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
