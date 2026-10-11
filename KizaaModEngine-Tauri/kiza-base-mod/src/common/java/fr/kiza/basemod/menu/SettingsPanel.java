package fr.kiza.basemod.menu;

import fr.kiza.basemod.MenuLogoRenderer;
import java.io.File;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The Kiza Client settings: a tab halfway down the left edge of the title
 * screen, and the drawer it slides out.
 *
 * <p>Minecraft has no widget here, so nothing of this is a widget: it is drawn
 * by Kiza like the rest of the menu, and {@link MenuInput} brings it the
 * window's clicks. With the panel shut the only click taken is the one on the
 * tab; with it open every click is the panel's, and a click beside it shuts
 * it, as Escape does.
 *
 * <p>Drawn as a translucent sheet of grouped rows, the way Apple lays out its settings:
 * cards of rows with a label on the left and the control on the right,
 * segmented controls for a choice among a few, switches, a thin slider, a
 * header over each group and a grey note under it. Each part is its own
 * small texture, see {@link SettingsParts}, so the pointer moving over one
 * redraws that one. The layout is worked out every
 * frame and kept, so a click is tested against exactly what was drawn.
 */
public final class SettingsPanel {
    private SettingsPanel() {}

    private static final int PAD = 12;
    private static final int HEADER = 36;

    private static boolean open;
    /** Tests only: no motion, so a preview shows where things come to rest. */
    private static boolean instant;
    private static int scroll;
    private static int maxScroll;
    private static boolean tabPressed;
    private static Control pressed;
    private static Control dragging;
    private static ClientSettings.Background pendingPick;
    private static volatile ClientText.Phrase note;
    /** Whether the note is news -- a copy under way -- rather than a fault. */
    private static volatile boolean noteIsProgress;

    private static int[] tab;
    private static int[] panel;
    /** The visible band of the scrolling part while it is drawn: nothing outside it is. */
    private static int[] band;
    private static List<Control> controls = new ArrayList<Control>();
    private static final Map<String, Object> KEYS = new HashMap<String, Object>();

    /** One thing the pointer can press, where it was last drawn. */
    private static final class Control {
        final int x;
        final int y;
        final int w;
        final int h;
        final Runnable action;
        final Slider slider;

        Control(int x, int y, int w, int h, Runnable action, Slider slider) {
            this.x = x;
            this.y = y;
            this.w = w;
            this.h = h;
            this.action = action;
            this.slider = slider;
        }

        boolean contains(double px, double py) {
            return px >= x && px < x + w && py >= y && py < y + h;
        }
    }

    private interface Slider {
        void set(float value);
    }

    public static boolean isOpen() {
        return open;
    }

    /**
     * The title screen is no longer on show: the panel goes with it, so coming
     * back does not find it open over the menu. Never keeps the event.
     */
    static boolean leftTitle() {
        open = false;
        pressed = null;
        dragging = null;
        tabPressed = false;
        return false;
    }

    /** Tests only: the panel open, for the preview. */
    static void previewOpen() {
        open = true;
        instant = true;
    }

    // ---- Drawing --------------------------------------------------------------

    /** Inside a card: from its edge to the text. */
    private static final int INSET = 10;
    private static final int ROW_HEIGHT = 24;
    /** Between one group and the next header. */
    private static final int GROUP_GAP = 10;
    /** Time for a glide to cover about two thirds of the way. */
    private static final float GLIDE_TAU_NANOS = 55_000_000F;
    private static final Map<String, float[]> GLIDES = new HashMap<String, float[]>();
    private static final Map<String, long[]> GLIDE_TIMES = new HashMap<String, long[]>();

    /** The tab on the left edge: how wide it stands out, and how tall it is. */
    private static final int TAB_WIDTH = 13;
    private static final int TAB_HEIGHT = 46;
    /** Between the drawer and the screen's edges. */
    private static final int MARGIN = 8;
    private static final int DRAWER_WIDTH = 252;

    /**
     * The tab, and the drawer when it is open. Called by the title screen
     * after its buttons.
     *
     * <p>A tab sits halfway down the left edge. Pressed, the drawer slides
     * out from that edge to the right with the tab on its border, and slides
     * back the same way: the panel comes from where it was asked for, and
     * goes back there. Narrow and as tall as the screen, it leaves the menu
     * in view beside it, so the light veil only steps back the rest. Its
     * motion is an approach, not a timeline -- a click halfway turns it round
     * from where it is.
     *
     * @param bottom unused since the tab moved off the footer; kept for the callers
     */
    public static void render(Object graphics, int width, int height, int bottom, int mouseX, int mouseY) {
        MenuInput.frame(width, height);
        if (!MenuInput.available()) return;
        if (pendingPick != null) pick();

        float shown = instant ? (open ? 1F : 0F) : Animations.hover(key("sheet"), open);
        int drawerWidth = Math.min(DRAWER_WIDTH, width - MARGIN * 2 - TAB_WIDTH - 20);
        int drawerX = MARGIN - Math.round((1F - shown) * (drawerWidth + MARGIN + 4));
        int tabX = Math.max(0, drawerX + drawerWidth);
        int tabY = (height - TAB_HEIGHT) / 2;
        // The tab's box takes the click when the drawer is shut; open, a click
        // outside the drawer shuts it, the tab included.
        tab = new int[] {tabX, tabY, TAB_WIDTH, TAB_HEIGHT};

        if (shown >= 0.02F || open) {
            int veil = Math.round(0x58 * Math.min(1F, shown));
            MenuLogoRenderer.fill(graphics, 0, 0, width, height, (veil << 24) | 0x050409);
            drawPanel(graphics, drawerX, drawerWidth, height, mouseX, mouseY);
            if (!open) controls = new ArrayList<Control>();
        } else {
            controls = new ArrayList<Control>();
            panel = null;
        }
        boolean overTab = inside(tab, mouseX, mouseY);
        float hover = Animations.hover(key("tab"), overTab);
        int pointing = Math.round(shown * SettingsParts.GLIDE_STEPS);
        blit(graphics, SettingsParts.tab(TAB_WIDTH, TAB_HEIGHT, Animations.step(hover, Buttons.HOVER_STEPS), pointing),
            tabX, tabY, TAB_WIDTH, TAB_HEIGHT);
    }

    private static void drawPanel(Object graphics, int x, int panelWidth, int height, int mouseX, int mouseY) {
        int column = panelWidth - PAD * 2;

        // Laid out once to measure, then drawn at the scroll it allows.
        int content = backgroundColumn(null, 0, 0, column, mouseX, mouseY, new ArrayList<Control>())
            + interfaceColumn(null, 0, 0, column, mouseX, mouseY, new ArrayList<Control>());
        int panelHeight = height - MARGIN * 2;
        maxScroll = Math.max(0, HEADER + content + PAD - panelHeight);
        scroll = Math.max(0, Math.min(maxScroll, scroll));

        int y = MARGIN;
        panel = new int[] {x, y, panelWidth, panelHeight};
        blit(graphics, SettingsParts.sheet(panelWidth, panelHeight), x, y, panelWidth, panelHeight);

        List<Control> drawn = new ArrayList<Control>();
        drawText(graphics, ClientText.get("kiza.settings.title"), 12, SettingsParts.LABEL, true, x + PAD + 2, y + 11);
        // No close button: the tab on the drawer's edge closes it, where it
        // was opened, as do Escape and a click beside it.

        int top = y + HEADER - scroll;
        int band0 = y + HEADER - 4;
        int band1 = y + panelHeight - 6;
        List<Control> visible = new ArrayList<Control>();
        band = new int[] {band0, band1};
        int below = backgroundColumn(graphics, x + PAD, top, column, mouseX, mouseY, visible);
        interfaceColumn(graphics, x + PAD, top + below, column, mouseX, mouseY, visible);
        band = null;
        // Only what lies wholly inside the panel takes a click: a row scrolled
        // half out of view is not drawn and must not answer.
        for (Control control : visible) {
            if (control.y >= band0 && control.y + control.h <= band1) drawn.add(control);
        }
        controls = drawn;

        if (dragging != null) {
            double[] at = MenuInput.pointer();
            if (at != null && MenuInput.leftDown()) {
                dragging.slider.set((float) ((at[0] - dragging.x) / Math.max(1, dragging.w)));
            } else {
                dragging = null;
            }
        }
    }

    /** The background column; returns its height. Measures only when {@code graphics} is null. */
    private static int backgroundColumn(Object graphics, int x, int y, int width, int mouseX, int mouseY, List<Control> out) {
        int top = y;
        final ClientSettings.Background current = ClientSettings.background();
        final ClientSettings.Background[] kinds = ClientSettings.Background.values();

        y = header(graphics, ClientText.get("kiza.settings.background"), x, y);
        List<Row> rows = new ArrayList<Row>();
        rows.add(segmentedRow(null, "background", new String[] {"Kiza", ClientText.get("kiza.settings.image"), "GIF", ClientText.get("kiza.settings.video")}, current.ordinal(), true,
            new java.util.function.IntConsumer() {
                @Override
                public void accept(int chosen) {
                    choose(kinds[chosen]);
                }
            }));
        if (current != ClientSettings.Background.KIZA) rows.add(fileRow(current));
        y = group(graphics, x, y, width, mouseX, mouseY, out, rows);

        String problem = note != null ? note.toString() : MenuBackground.problem();
        if (current != ClientSettings.Background.KIZA) {
            if (problem != null) {
                // Progress is news, not a fault: said in the plain colour.
                boolean news = note != null ? noteIsProgress : MenuBackground.preparing();
                y = footer(graphics, problem, x, y, width, news ? SettingsParts.SECONDARY : SettingsParts.ERROR);
            } else {
                y = footer(graphics, ClientText.get("kiza.settings.drop_hint"), x, y, width, SettingsParts.TERTIARY);
            }
        }
        y += GROUP_GAP;

        if (current == ClientSettings.Background.VIDEO) {
            boolean performance = ClientSettings.videoPerformance();
            final ClientSettings.VideoQuality[] qualities = ClientSettings.VideoQuality.values();
            final ClientSettings.VideoFps[] rates = ClientSettings.VideoFps.values();
            y = header(graphics, ClientText.get("kiza.settings.video"), x, y);
            List<Row> video = new ArrayList<Row>();
            video.add(segmentedRow(ClientText.get("kiza.settings.quality"), "quality", new String[] {ClientText.get("kiza.settings.auto"), "720p", "1080p", "1440p"},
                ClientSettings.videoQuality().ordinal(), !performance, new java.util.function.IntConsumer() {
                    @Override
                    public void accept(int chosen) {
                        ClientSettings.setVideoQuality(qualities[chosen]);
                    }
                }));
            video.add(segmentedRow(ClientText.get("kiza.settings.smoothness"), "fps", new String[] {ClientText.get("kiza.settings.auto"), "30 fps", "60 fps"},
                ClientSettings.videoFps().ordinal(), !performance, new java.util.function.IntConsumer() {
                    @Override
                    public void accept(int chosen) {
                        ClientSettings.setVideoFps(rates[chosen]);
                    }
                }));
            video.add(toggleRow(ClientText.get("kiza.settings.performance"), "menu.video.performance", false));
            video.add(toggleRow(ClientText.get("kiza.settings.stats"), "menu.video.stats", false));
            y = group(graphics, x, y, width, mouseX, mouseY, out, video);
            y = footer(graphics, performance
                ? ClientText.get("kiza.settings.performance_note")
                : ClientText.get("kiza.settings.video_note"),
                x, y, width, SettingsParts.TERTIARY);
            y += GROUP_GAP;
        }

        y = header(graphics, ClientText.get("kiza.settings.display"), x, y);
        List<Row> display = new ArrayList<Row>();
        display.add(toggleRow(ClientText.get("kiza.settings.background_everywhere"), "menu.background-everywhere", true));
        final int dim = ClientSettings.dim();
        display.add(sliderRow(ClientText.get("kiza.settings.dimming"), dim + " %", dim / 90F, new Slider() {
            @Override
            public void set(float value) {
                ClientSettings.setDim(Math.round(Math.max(0F, Math.min(1F, value)) * 90F));
            }
        }));
        y = group(graphics, x, y, width, mouseX, mouseY, out, display);
        y += GROUP_GAP;
        return y - top;
    }

    /** The interface column; returns its height. */
    private static int interfaceColumn(Object graphics, int x, int y, int width, int mouseX, int mouseY, List<Control> out) {
        int top = y;
        y = header(graphics, ClientText.get("kiza.settings.colour"), x, y);
        List<Row> colour = new ArrayList<Row>();
        colour.add(swatchRow());
        y = group(graphics, x, y, width, mouseX, mouseY, out, colour) + GROUP_GAP;

        y = header(graphics, "Interface", x, y);
        List<Row> look = new ArrayList<Row>();
        look.add(toggleRow(ClientText.get("kiza.settings.animations"), "menu.animations", true));
        look.add(toggleRow(ClientText.get("kiza.settings.logo_effect"), "menu.logo-effect", true));
        look.add(toggleRow(ClientText.get("kiza.settings.icons"), "menu.icons", true));
        look.add(toggleRow(ClientText.get("kiza.settings.everywhere"), "menu.everywhere", true));
        y = group(graphics, x, y, width, mouseX, mouseY, out, look) + GROUP_GAP;

        y = header(graphics, ClientText.get("kiza.settings.information"), x, y);
        List<Row> about = new ArrayList<Row>();
        about.add(toggleRow(ClientText.get("kiza.settings.footer"), "menu.footer", true));
        about.add(toggleRow(ClientText.get("kiza.settings.debug_line"), "menu.debug-line", true));
        y = group(graphics, x, y, width, mouseX, mouseY, out, about);
        y = footer(graphics, ClientText.get("kiza.settings.saved"), x, y, width, SettingsParts.TERTIARY);
        return y + GROUP_GAP - top;
    }

    // ---- Rows -----------------------------------------------------------------

    /** One row of a group: its height, and what it draws and answers inside its box. */
    private interface Row {
        int height();

        /** Whether a press lights the whole row, as a list row does. */
        boolean whole();

        void draw(Object graphics, int x, int y, int width, int mouseX, int mouseY, List<Control> out);
    }

    /**
     * A group: rows on one card, hairlines between them inset from the left,
     * as a grouped list draws them. A row that answers as a whole lights up
     * the moment it is pressed, not when it is let go.
     */
    private static int group(Object graphics, int x, int y, int width, int mouseX, int mouseY, List<Control> out, List<Row> rows) {
        for (int index = 0; index < rows.size(); index += 1) {
            Row row = rows.get(index);
            int height = row.height();
            boolean held = row.whole() && pressed != null && pressed.x == x && pressed.y == y && pressed.w == width
                && MenuInput.leftDown();
            if (graphics != null) {
                blit(graphics, SettingsParts.row(width, height, index == 0, index == rows.size() - 1, held), x, y, width, height);
            }
            row.draw(graphics, x, y, width, mouseX, mouseY, out);
            if (graphics != null && index < rows.size() - 1) line(graphics, x + INSET, y + height - 1, width - INSET, SettingsParts.SEPARATOR);
            y += height;
        }
        return y;
    }

    private static int header(Object graphics, String title, int x, int y) {
        drawText(graphics, title, 8, SettingsParts.SECONDARY, true, x + INSET, y);
        return y + 14;
    }

    /** The grey note under a group, wrapped to it. */
    private static int footer(Object graphics, String text, int x, int y, int width, int colour) {
        y += 4;
        for (String line : wrapToWidth(text, 8, width - INSET * 2)) {
            drawText(graphics, line, 8, colour, false, x + INSET, y);
            y += 10;
        }
        return y;
    }

    private static Row toggleRow(final String label, final String setting, final boolean fallback) {
        return new Row() {
            @Override
            public int height() {
                return ROW_HEIGHT;
            }

            @Override
            public boolean whole() {
                return true;
            }

            @Override
            public void draw(Object graphics, int x, int y, int width, int mouseX, int mouseY, List<Control> out) {
                boolean on = ClientSettings.flag(setting, fallback);
                float knob = glide("switch-" + setting, on ? 1F : 0F);
                boolean held = pressed != null && pressed.x == x && pressed.y == y && MenuInput.leftDown();
                if (graphics != null) {
                    drawText(graphics, label, 9, SettingsParts.LABEL, false, x + INSET, y + 6);
                    int step = Math.round(knob * SettingsParts.GLIDE_STEPS);
                    blit(graphics, SettingsParts.toggle(step, held, 24, 14), x + width - INSET - 24, y + 5, 24, 14);
                }
                out.add(new Control(x, y, width, ROW_HEIGHT, new Runnable() {
                    @Override
                    public void run() {
                        ClientSettings.setFlag(setting, !ClientSettings.flag(setting, fallback));
                    }
                }, null));
            }
        };
    }

    /**
     * Choices side by side: a segmented control, with its label on the left
     * when it has one, alone across the row when it has not. The thumb glides
     * to the choice made.
     */
    private static Row segmentedRow(
        final String label, final String group, final String[] labels, final int selected, final boolean enabled,
        final java.util.function.IntConsumer pick
    ) {
        return new Row() {
            @Override
            public int height() {
                return label == null ? 30 : 28;
            }

            @Override
            public boolean whole() {
                return false;
            }

            @Override
            public void draw(Object graphics, int x, int y, int width, int mouseX, int mouseY, List<Control> out) {
                int controlHeight = 18;
                int labelWidth = label == null ? 0 : textWidth(label, 9, false) + 10;
                int controlX = x + INSET + labelWidth;
                int controlWidth = width - INSET * 2 - labelWidth;
                int controlY = y + (height() - controlHeight) / 2;
                float thumb = glide("segment-" + group, selected);
                if (graphics != null) {
                    if (label != null) drawText(graphics, label, 9, enabled ? SettingsParts.LABEL : SettingsParts.TERTIARY, false, x + INSET, y + 8);
                    int step = Math.round(thumb * SettingsParts.GLIDE_STEPS);
                    blit(graphics, SettingsParts.segmented(labels, step, controlWidth, controlHeight, enabled),
                        controlX, controlY, controlWidth, controlHeight);
                }
                if (!enabled) return;
                int each = controlWidth / labels.length;
                for (int index = 0; index < labels.length; index += 1) {
                    final int choice = index;
                    out.add(new Control(controlX + each * index, controlY, each, controlHeight, new Runnable() {
                        @Override
                        public void run() {
                            pick.accept(choice);
                        }
                    }, null));
                }
            }
        };
    }

    /** The chosen file, and a link to choose another. */
    private static Row fileRow(final ClientSettings.Background kind) {
        return new Row() {
            @Override
            public int height() {
                return ROW_HEIGHT;
            }

            @Override
            public boolean whole() {
                return true;
            }

            @Override
            public void draw(Object graphics, int x, int y, int width, int mouseX, int mouseY, List<Control> out) {
                if (graphics != null) {
                    File chosen = ClientSettings.backgroundFile();
                    String link = ClientText.get("kiza.settings.choose");
                    int linkWidth = textWidth(link, 9, true);
                    int linkX = x + width - INSET - linkWidth;
                    drawText(graphics, link, 9, ClientSettings.accent().to, true, linkX, y + 6);
                    int nameRoom = linkX - 10 - (x + INSET);
                    String name = fitToWidth(chosen == null ? ClientText.get("kiza.settings.no_file") : chosen.getName(), 9, nameRoom);
                    drawText(graphics, name, 9, SettingsParts.SECONDARY, false, x + INSET, y + 6);
                }
                out.add(new Control(x, y, width, ROW_HEIGHT, new Runnable() {
                    @Override
                    public void run() {
                        pendingPick = kind;
                    }
                }, null));
            }
        };
    }

    /** A label and its value on one line, the slider under them. */
    private static Row sliderRow(final String label, final String value, final float fraction, final Slider set) {
        return new Row() {
            @Override
            public int height() {
                return 40;
            }

            @Override
            public boolean whole() {
                return false;
            }

            @Override
            public void draw(Object graphics, int x, int y, int width, int mouseX, int mouseY, List<Control> out) {
                int trackX = x + INSET;
                int trackWidth = width - INSET * 2;
                int trackY = y + 22;
                if (graphics != null) {
                    drawText(graphics, label, 9, SettingsParts.LABEL, false, x + INSET, y + 6);
                    drawText(graphics, value, 9, SettingsParts.SECONDARY, false, x + width - INSET - textWidth(value, 9, false), y + 6);
                    int step = Math.round(Math.max(0F, Math.min(1F, fraction)) * Buttons.SLIDER_STEPS);
                    blit(graphics, SettingsParts.slider(step, trackWidth, 12, dragging != null), trackX, trackY, trackWidth, 12);
                }
                // A little taller than the track: a thin line is a hard target.
                out.add(new Control(trackX, trackY - 4, trackWidth, 20, null, set));
            }
        };
    }

    private static Row swatchRow() {
        return new Row() {
            @Override
            public int height() {
                return 32;
            }

            @Override
            public boolean whole() {
                return false;
            }

            @Override
            public void draw(Object graphics, int x, int y, int width, int mouseX, int mouseY, List<Control> out) {
                int size = 18;
                int sx = x + INSET;
                for (final ClientSettings.Accent accent : ClientSettings.Accent.values()) {
                    boolean chosen = accent == ClientSettings.accent();
                    boolean over = inside(new int[] {sx, y + 7, size, size}, mouseX, mouseY);
                    float hover = Animations.hover(key("swatch-" + accent), over);
                    if (graphics != null) {
                        blit(graphics, SettingsParts.swatch(accent, chosen, Animations.step(hover, Buttons.HOVER_STEPS), size),
                            sx, y + 7, size, size);
                    }
                    out.add(new Control(sx, y + 7, size, size, new Runnable() {
                        @Override
                        public void run() {
                            ClientSettings.setAccent(accent);
                        }
                    }, null));
                    sx += size + 10;
                }
            }
        };
    }

    /**
     * Moves a value towards {@code target}, by the clock: most of the way in
     * a tenth of a second, slowing as it arrives, and reversible at any point
     * without a jump, since it always starts from where it is.
     */
    private static float glide(String key, float target) {
        float[] value = GLIDES.get(key);
        long now = System.nanoTime();
        if (value == null || instant) {
            GLIDES.put(key, new float[] {target});
            GLIDE_TIMES.put(key, new long[] {now});
            return target;
        }
        long[] at = GLIDE_TIMES.get(key);
        float elapsed = Math.min(200_000_000L, now - at[0]);
        at[0] = now;
        value[0] = target + (value[0] - target) * (float) Math.exp(-elapsed / GLIDE_TAU_NANOS);
        if (Math.abs(value[0] - target) < 0.004F) value[0] = target;
        return value[0];
    }

    private static void line(Object graphics, int x, int y, int width, int colour) {
        if (band != null && (y < band[0] || y >= band[1])) return;
        MenuLogoRenderer.fill(graphics, x, y, x + width, y + 1, colour);
    }

    private static final java.awt.image.BufferedImage PROBE = new java.awt.image.BufferedImage(1, 1, java.awt.image.BufferedImage.TYPE_INT_ARGB);

    /** How wide {@code text} is drawn, in GUI pixels. */
    private static int textWidth(String text, int size, boolean bold) {
        int scale = Buttons.supersample();
        java.awt.Graphics2D g = PROBE.createGraphics();
        Buttons.quality(g);
        java.awt.Font font = fr.kiza.basemod.render.KizaText.covering(
            bold ? Buttons.labelFont(size * scale) : Buttons.plainFont(size * scale), text);
        int width = (int) Math.ceil(font.getStringBounds(text, g.getFontRenderContext()).getWidth());
        g.dispose();
        return (width + scale * 3 + scale - 1) / scale;
    }

    private static String fitToWidth(String text, int size, int room) {
        if (textWidth(text, size, false) <= room) return text;
        int end = text.length();
        while (end > 1 && textWidth(text.substring(0, end) + "...", size, false) > room) end -= 1;
        return text.substring(0, end) + "...";
    }

    private static List<String> wrapToWidth(String text, int size, int room) {
        List<String> lines = new ArrayList<String>();
        StringBuilder line = new StringBuilder();
        for (String word : text.split(" ")) {
            String tried = line.length() == 0 ? word : line + " " + word;
            if (line.length() > 0 && textWidth(tried, size, false) > room) {
                lines.add(line.toString());
                line.setLength(0);
                line.append(word);
            } else {
                line.setLength(0);
                line.append(tried);
            }
        }
        if (line.length() > 0) lines.add(line.toString());
        return lines;
    }

    // ---- What a click does ----------------------------------------------------

    /** Kiza's own needs nothing; the others use their file, or ask for one. */
    private static void choose(ClientSettings.Background kind) {
        note = null;
        if (kind == ClientSettings.Background.KIZA || ClientSettings.backgroundFile(kind) != null) {
            ClientSettings.setBackground(kind, null);
        } else {
            pendingPick = kind;
        }
    }

    /**
     * Asks Windows for a file, through the dialog LWJGL ships with Minecraft.
     *
     * <p>Done at the start of a frame rather than inside the click: the
     * dialog runs its own message loop, and starting one from inside GLFW's
     * callback is how a window stops answering.
     */
    private static void pick() {
        ClientSettings.Background kind = pendingPick;
        pendingPick = null;
        try {
            Class<?> dialogs = Class.forName("org.lwjgl.util.tinyfd.TinyFileDialogs");
            Method open = dialogs.getMethod(
                "tinyfd_openFileDialog",
                CharSequence.class,
                CharSequence.class,
                Class.forName("org.lwjgl.PointerBuffer"),
                CharSequence.class,
                boolean.class
            );
            Object chosen = open.invoke(null, article(kind), "", null, null, false);
            if (chosen instanceof String && !((String) chosen).isEmpty()) importFile(new File((String) chosen), kind);
        } catch (Throwable unavailable) {
            note = ClientText.of("kiza.import.drop_only");
            noteIsProgress = false;
        }
    }

    private static String article(ClientSettings.Background kind) {
        switch (kind) {
            case IMAGE:
                return ClientText.get("kiza.dialog.image");
            case GIF:
                return ClientText.get("kiza.dialog.gif");
            default:
                return ClientText.get("kiza.dialog.video");
        }
    }

    /** What a file is, from its name. Null for what the menu cannot show. */
    static ClientSettings.Background kindOf(File file) {
        String name = file.getName().toLowerCase(Locale.ROOT);
        if (name.endsWith(".gif")) return ClientSettings.Background.GIF;
        if (name.endsWith(".mp4") || name.endsWith(".m4v") || name.endsWith(".mov")) return ClientSettings.Background.VIDEO;
        if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".bmp")) {
            return ClientSettings.Background.IMAGE;
        }
        return null;
    }

    /**
     * Copies the chosen file into the instance's runtime folder and uses it.
     *
     * <p>A copy, so moving or deleting the original does not take the menu's
     * background with it. Done on a thread of its own: a video can be large.
     */
    private static void importFile(final File source, ClientSettings.Background asked) {
        final ClientSettings.Background kind = kindOf(source) != null ? kindOf(source) : asked;
        if (kindOf(source) == null) {
            note = ClientText.of("kiza.import.unsupported");
            noteIsProgress = false;
            return;
        }
        final long limit = kind == ClientSettings.Background.VIDEO ? 400L << 20 : 60L << 20;
        if (source.length() > limit) {
            note = ClientText.of("kiza.import.too_large", limit >> 20);
            noteIsProgress = false;
            return;
        }
        final File folder = ClientSettings.folder();
        if (folder == null) {
            note = ClientText.of("kiza.import.failed");
            noteIsProgress = false;
            return;
        }
        note = ClientText.of("kiza.import.copying");
        noteIsProgress = true;
        Thread copy = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    String extension = source.getName().substring(source.getName().lastIndexOf('.')).toLowerCase(Locale.ROOT);
                    // A new name each time, copied whole under a temporary one
                    // first: the file the menu is showing is never written to
                    // while it shows it, and a half-copied file is never chosen.
                    String name = "menu-background-" + kind.name().toLowerCase(Locale.ROOT) + "-"
                        + Long.toString(System.currentTimeMillis(), 36) + extension;
                    folder.mkdirs();
                    File target = new File(folder, name);
                    File partial = new File(folder, name + ".copying");
                    java.nio.file.Files.copy(source.toPath(), partial.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                    java.nio.file.Files.move(partial.toPath(), target.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                    File previous = ClientSettings.backgroundFile(kind);
                    ClientSettings.setBackground(kind, name);
                    note = null;
                    if (previous != null && !previous.equals(target)) MenuBackground.forget(previous);
                } catch (Exception failure) {
                    note = ClientText.of("kiza.import.failed");
                    noteIsProgress = false;
                }
            }
        }, "kiza-menu-background-copy");
        copy.setDaemon(true);
        copy.start();
    }

    // ---- Input, from MenuInput --------------------------------------------------

    static boolean mouse(int button, boolean press, boolean release, double x, double y) {
        if (!open) {
            if (tab == null || button != 0) return false;
            if (press && inside(tab, x, y)) {
                tabPressed = true;
                return true;
            }
            if (release && tabPressed) {
                tabPressed = false;
                if (inside(tab, x, y)) {
                    open = true;
                    scroll = 0;
                }
                return true;
            }
            return false;
        }
        if (press) {
            if (button != 0) return true;
            if (panel == null || !inside(panel, x, y)) {
                open = false;
                return true;
            }
            for (Control control : controls) {
                if (!control.contains(x, y)) continue;
                if (control.slider != null) {
                    dragging = control;
                    control.slider.set((float) ((x - control.x) / Math.max(1, control.w)));
                } else {
                    pressed = control;
                }
                return true;
            }
            return true;
        }
        if (release) {
            Control was = pressed;
            pressed = null;
            dragging = null;
            if (was != null && was.contains(x, y) && was.action != null) was.action.run();
        }
        return true;
    }

    static boolean scroll(double amount) {
        if (!open) return false;
        scroll = Math.max(0, Math.min(maxScroll, scroll - (int) Math.round(amount * 14)));
        return true;
    }

    static boolean key(int key, boolean press) {
        if (!open) return false;
        // Escape is 256 in GLFW.
        if (press && key == 256) open = false;
        return true;
    }

    static boolean drop(String[] paths) {
        if (!open || paths.length == 0) return false;
        File file = new File(paths[0]);
        importFile(file, kindOf(file) != null ? kindOf(file) : ClientSettings.background());
        return true;
    }

    // ---- Helpers --------------------------------------------------------------

    private static Object key(String name) {
        Object found = KEYS.get(name);
        if (found == null) {
            found = new Object();
            KEYS.put(name, found);
        }
        return found;
    }

    private static boolean inside(int[] box, double x, double y) {
        return box != null && x >= box[0] && x < box[0] + box[2] && y >= box[1] && y < box[1] + box[3];
    }

    private static void blit(Object graphics, Object texture, int x, int y, int w, int h) {
        if (graphics == null || texture == null) return;
        if (band != null && (y < band[0] || y + h > band[1])) return;
        int scale = Buttons.supersample();
        MenuLogoRenderer.blitTexture(graphics, texture, x, y, w, h, w * scale, h * scale);
    }

    private static void drawText(Object graphics, String text, int size, int colour, boolean bold, int x, int y) {
        if (graphics == null) return;
        if (band != null && (y < band[0] || y + size + 4 > band[1])) return;
        int[] measured = new int[2];
        Object texture = Buttons.text(text, size, colour, bold, measured);
        int scale = Buttons.supersample();
        MenuLogoRenderer.blitTexture(graphics, texture, x, y, measured[0], measured[1], measured[0] * scale, measured[1] * scale);
    }
}
