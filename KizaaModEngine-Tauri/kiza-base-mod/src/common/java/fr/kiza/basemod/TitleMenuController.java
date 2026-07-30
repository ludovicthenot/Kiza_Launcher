package fr.kiza.basemod;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;

/**
 * Reskins the vanilla title-screen menu into the Kiza client look without
 * touching input: it reads each vanilla button's bounds and label by
 * reflection and paints a rounded, translucent pill on top of it (at render
 * TAIL). The real vanilla buttons stay in place underneath, so clicks and
 * navigation keep working natively. When reflection fails, nothing is drawn and
 * the vanilla menu shows through unchanged.
 */
final class TitleMenuController {
    // Lunar-style: dark, lightly translucent buttons with a hairline border.
    private static final int COLOR_BUTTON = 0xD8121016;
    private static final int COLOR_BUTTON_HOVER = 0xF01C1926;
    private static final int COLOR_BORDER = 0x33FFFFFF;
    private static final int COLOR_BORDER_HOVER = 0x99B79BFF;
    private static final int COLOR_TEXT = 0xFFF4F2FA;
    private static final int COLOR_ICON = 0xFFCBB7FF;

    private static final int LOGO_WIDTH = 210;
    private static final int LOGO_HEIGHT = 90;
    private static final int MIN_BUTTON_WIDTH = 88;
    private static final int MAX_BUTTON_WIDTH = 420;

    private static Method childrenMethod;
    private static boolean childrenUnavailable;

    private record Entry(int x, int y, int width, int height, String label) {}

    static record Layout(List<Entry> buttons, int topButtonY) {
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
        return new Layout(List.copyOf(buttons), topButtonY);
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

        drawBrandBlock(graphics, screen, width, layout.topButtonY());
        for (Entry button : layout.buttons()) {
            drawMenuButton(graphics, screen, button, mouseX, mouseY);
        }
    }

    // Dedicated Kiza Client header, sitting just above the native button stack.
    private static void drawBrandBlock(Object graphics, Object screen, int width, int topButtonY) {
        int centerX = width / 2;
        int minTop = 36;

        // Fit the complete transparent header above the button stack,
        // scaling it down on short windows so nothing overlaps.
        int available = topButtonY - 14 - minTop;
        int logoHeight = Math.max(38, Math.min(LOGO_HEIGHT, available));
        int logoWidth = logoHeight * LOGO_WIDTH / LOGO_HEIGHT;

        int logoTop = topButtonY - 14 - logoHeight;
        if (logoTop < minTop) logoTop = minTop;

        MenuLogoRenderer.drawTitleLogoAt(
            graphics,
            centerX - logoWidth / 2,
            logoTop,
            logoWidth,
            logoHeight
        );
    }

    private static void drawMenuButton(Object graphics, Object screen, Entry button, int mouseX, int mouseY) {
        int left = button.x();
        int top = button.y();
        int right = left + button.width();
        int bottom = top + button.height();
        int radius = Math.min(8, button.height() / 2);
        boolean hovered = mouseX >= left && mouseX < right && mouseY >= top && mouseY < bottom;

        // Dark translucent fill covers the vanilla button; a hairline border and
        // a subtle lift on hover keep the clean Lunar look.
        MenuLogoRenderer.roundedFill(
            graphics, left, top, right, bottom, radius, hovered ? COLOR_BUTTON_HOVER : COLOR_BUTTON
        );
        outline(graphics, left, top, right, bottom, radius, hovered ? COLOR_BORDER_HOVER : COLOR_BORDER);

        // Centre the icon and label together so they never overlap, even on the
        // narrow bottom-row buttons.
        String label = button.label();
        int centerY = top + button.height() / 2;
        int iconSize = 11;
        int iconGap = 8;
        int textWidth = label.isBlank() ? 0 : label.length() * 6;
        int groupWidth = iconSize + (label.isBlank() ? 0 : iconGap + textWidth);
        int groupLeft = left + Math.max(8, (button.width() - groupWidth) / 2);

        drawGlyph(graphics, glyphFor(label), groupLeft + iconSize / 2, centerY, COLOR_ICON);
        if (!label.isBlank()) {
            MenuLogoRenderer.drawText(
                graphics, screen, label, groupLeft + iconSize + iconGap, top + (button.height() - 8) / 2, COLOR_TEXT
            );
        }
    }

    private enum Glyph { PERSON, PEOPLE, CUBE, GEAR, POWER, GLOBE, DOT }

    private static Glyph glyphFor(String label) {
        String value = label.toLowerCase();
        if (value.contains("single") || value.contains("solo")) return Glyph.PERSON;
        if (value.contains("multi")) return Glyph.PEOPLE;
        if (value.contains("mod")) return Glyph.CUBE;
        if (value.contains("option")
            || value.contains("setting")
            || value.contains("param")
            || value.contains("langu")) return Glyph.GEAR;
        if (value.contains("quit")
            || value.contains("exit")
            || value.contains("quitter")) return Glyph.POWER;
        if (value.contains("realm")
            || value.contains("server")
            || value.contains("serveur")) return Glyph.GLOBE;
        return Glyph.DOT;
    }

    // Small filled glyphs drawn in an ~11px box centred on (cx, cy).
    private static void drawGlyph(Object graphics, Glyph glyph, int cx, int cy, int color) {
        int x = cx - 5;
        int y = cy - 5;
        switch (glyph) {
            case PERSON -> {
                MenuLogoRenderer.roundedFill(graphics, x + 3, y, x + 8, y + 5, 2, color);
                MenuLogoRenderer.roundedFill(graphics, x + 1, y + 6, x + 10, y + 11, 3, color);
            }
            case PEOPLE -> {
                MenuLogoRenderer.roundedFill(graphics, x + 5, y + 1, x + 9, y + 5, 1, color);
                MenuLogoRenderer.roundedFill(graphics, x + 4, y + 5, x + 11, y + 10, 2, color);
                MenuLogoRenderer.roundedFill(graphics, x, y, x + 5, y + 5, 2, color);
                MenuLogoRenderer.roundedFill(graphics, x - 1, y + 5, x + 6, y + 11, 2, color);
            }
            case CUBE -> {
                MenuLogoRenderer.fill(graphics, x, y + 1, x + 11, y + 3, color);
                MenuLogoRenderer.fill(graphics, x, y + 1, x + 2, y + 10, color);
                MenuLogoRenderer.fill(graphics, x + 9, y + 1, x + 11, y + 10, color);
                MenuLogoRenderer.fill(graphics, x, y + 8, x + 11, y + 10, color);
                MenuLogoRenderer.fill(graphics, x + 4, y + 3, x + 7, y + 8, color);
            }
            case GEAR -> {
                MenuLogoRenderer.roundedFill(graphics, x + 1, y + 1, x + 10, y + 10, 4, color);
                MenuLogoRenderer.fill(graphics, x + 4, y + 4, x + 7, y + 7, COLOR_BUTTON);
            }
            case POWER -> {
                MenuLogoRenderer.roundedFill(graphics, x + 1, y + 2, x + 10, y + 11, 4, color);
                MenuLogoRenderer.fill(graphics, x + 4, y - 1, x + 7, y + 5, color);
                MenuLogoRenderer.fill(graphics, x + 4, y + 4, x + 7, y + 7, COLOR_BUTTON);
            }
            case GLOBE -> {
                MenuLogoRenderer.roundedFill(graphics, x, y, x + 11, y + 11, 5, color);
                MenuLogoRenderer.fill(graphics, x + 5, y, x + 6, y + 11, COLOR_BUTTON);
                MenuLogoRenderer.fill(graphics, x, y + 5, x + 11, y + 6, COLOR_BUTTON);
            }
            case DOT -> MenuLogoRenderer.roundedFill(graphics, x + 3, y + 3, x + 8, y + 8, 2, color);
        }
    }

    private static void outline(Object graphics, int left, int top, int right, int bottom, int radius, int color) {
        MenuLogoRenderer.roundedFill(graphics, left, top, right, top + 1, radius, color);
        MenuLogoRenderer.roundedFill(graphics, left, bottom - 1, right, bottom, radius, color);
        MenuLogoRenderer.fill(graphics, left, top + 1, left + 1, bottom - 1, color);
        MenuLogoRenderer.fill(graphics, right - 1, top + 1, right, bottom - 1, color);
    }

    private static List<Entry> collectButtons(Object screen) {
        List<Entry> entries = new ArrayList<>();
        if (childrenUnavailable) return entries;
        try {
            if (childrenMethod == null) childrenMethod = findChildrenMethod(screen.getClass());
            Object result = childrenMethod.invoke(screen);
            if (!(result instanceof List<?> widgets)) return entries;

            for (Object widget : widgets) {
                Integer width = readInt(widget, "method_25368", "getWidth", "m_5711_");
                Integer height = readInt(widget, "method_25364", "getHeight", "m_93694_");
                Integer x = readInt(widget, "method_46426", "getX", "m_252754_");
                Integer y = readInt(widget, "method_46427", "getY", "m_252907_");
                if (width == null || height == null || x == null || y == null) continue;
                if (width < MIN_BUTTON_WIDTH || width > MAX_BUTTON_WIDTH) continue;
                if (height < 14 || height > 34) continue;

                entries.add(new Entry(x, y, width, height, label(widget)));
            }
        } catch (ReflectiveOperationException | RuntimeException error) {
            childrenUnavailable = true;
        }
        return entries;
    }

    private static String label(Object widget) {
        try {
            Object message = invokeNoArg(widget, "method_25369", "getMessage", "m_6035_");
            if (message == null) return "";
            Object text = invokeNoArg(message, "getString", "method_10851");
            return text instanceof String value ? value : "";
        } catch (ReflectiveOperationException | RuntimeException error) {
            return "";
        }
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

    private static Integer readInt(Object owner, String... methodNames) {
        for (String name : methodNames) {
            try {
                Method method = owner.getClass().getMethod(name);
                if (method.getParameterCount() == 0 && method.getReturnType() == int.class) {
                    return (int) method.invoke(owner);
                }
            } catch (ReflectiveOperationException | RuntimeException ignored) {
                // Try the next mapped name.
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
