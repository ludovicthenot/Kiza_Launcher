package fr.kiza.basemod;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collections;
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

    private static final int LOGO_WIDTH = 210;
    private static final int LOGO_HEIGHT = 90;
    private static final int MIN_BUTTON_WIDTH = 88;
    private static final int MAX_BUTTON_WIDTH = 420;

    private static Method childrenMethod;
    private static boolean childrenUnavailable;

    private static final class Entry {
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
        int mouseY,
        boolean withBrandBlock
    ) {
        if (width < 360 || !layout.supported()) return;

        // The header belongs to the title screen only; every other screen just
        // gets its buttons reskinned so the look is the same throughout.
        if (withBrandBlock) drawBrandBlock(graphics, screen, width, layout.topButtonY());
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
        // a subtle lift on hover keep the clean Lunar look. The antialiased
        // panel is preferred; stacked rectangles are the fallback.
        int fill = hovered ? COLOR_BUTTON_HOVER : COLOR_BUTTON;
        int border = hovered ? COLOR_BORDER_HOVER : COLOR_BORDER;
        Object panel = fr.kiza.basemod.render.KizaPanel.texture(
            button.width(), button.height(), radius, fill, border
        );
        if (panel != null) {
            MenuLogoRenderer.blitTexture(
                graphics,
                panel,
                left,
                top,
                button.width(),
                button.height(),
                button.width(),
                button.height()
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

        int textWidth = MenuLogoRenderer.textWidth(label);
        int textHeight = MenuLogoRenderer.textHeight();
        MenuLogoRenderer.drawText(
            graphics,
            screen,
            label,
            left + (button.width() - textWidth) / 2,
            top + (button.height() - textHeight) / 2,
            COLOR_TEXT
        );
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
            if (!(result instanceof List<?>)) return entries;
            List<?> widgets = (List<?>) result;

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
            return text instanceof String ? (String) text : "";
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
