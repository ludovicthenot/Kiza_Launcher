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

        /** Where in the control, across and down, 0 to 1: a palette uses both. */
        default void set(float across, float down) {
            set(across);
        }
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
                dragging.slider.set(
                    (float) ((at[0] - dragging.x) / Math.max(1, dragging.w)),
                    (float) ((at[1] - dragging.y) / Math.max(1, dragging.h))
                );
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
        rows.add(libraryRow(width));
        y = group(graphics, x, y, width, mouseX, mouseY, out, rows);

        String problem = note != null ? note.toString() : current != ClientSettings.Background.KIZA ? MenuBackground.problem() : null;
        if (problem != null) {
            // Progress is news, not a fault: said in the plain colour.
            boolean news = note != null ? noteIsProgress : MenuBackground.preparing();
            y = footer(graphics, problem, x, y, width, news ? SettingsParts.SECONDARY : SettingsParts.ERROR);
        } else {
            y = footer(graphics, ClientText.get("kiza.settings.drop_hint"), x, y, width, SettingsParts.TERTIARY);
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
        if (ClientSettings.accent() == ClientSettings.Accent.CUSTOM) colour.add(paletteRow());
        y = group(graphics, x, y, width, mouseX, mouseY, out, colour) + GROUP_GAP;

        y = header(graphics, "Interface", x, y);
        List<Row> look = new ArrayList<Row>();
        look.add(toggleRow(ClientText.get("kiza.settings.animations"), "menu.animations", true));
        look.add(toggleRow(ClientText.get("kiza.settings.logo_effect"), "menu.logo-effect", true));
        look.add(toggleRow(ClientText.get("kiza.settings.icons"), "menu.icons", true));
        look.add(toggleRow(ClientText.get("kiza.settings.everywhere"), "menu.everywhere", true));
        look.add(toggleRow(ClientText.get("kiza.settings.loading_screen"), "menu.loading-screen", true));
        look.add(toggleRow(ClientText.get("kiza.settings.screenshot_notice"), "menu.screenshot-notice", true));
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

    /** Library tiles: three a row, 16:9. */
    private static final int TILE_COLUMNS = 3;
    private static final int TILE_GAP = 6;

    /**
     * The library: Kiza's own background, every image, GIF and video added,
     * newest first, and a tile to add another. A click shows one; the cross
     * on a tile under the pointer takes it out of the library.
     */
    private static Row libraryRow(final int width) {
        final List<File> items = MenuLibrary.items();
        final int tileWidth = (width - INSET * 2 - TILE_GAP * (TILE_COLUMNS - 1)) / TILE_COLUMNS;
        final int tileHeight = tileWidth * 9 / 16;
        final int count = items.size() + 2;
        final int rowsOfTiles = (count + TILE_COLUMNS - 1) / TILE_COLUMNS;
        return new Row() {
            @Override
            public int height() {
                return 10 + rowsOfTiles * (tileHeight + TILE_GAP) - TILE_GAP + 10;
            }

            @Override
            public boolean whole() {
                return false;
            }

            @Override
            public void draw(Object graphics, int x, int y, int rowWidth, int mouseX, int mouseY, List<Control> out) {
                ClientSettings.Background current = ClientSettings.background();
                File shownFile = current == ClientSettings.Background.KIZA ? null : ClientSettings.backgroundFile();
                for (int index = 0; index < count; index += 1) {
                    int tx = x + INSET + (index % TILE_COLUMNS) * (tileWidth + TILE_GAP);
                    int ty = y + 10 + (index / TILE_COLUMNS) * (tileHeight + TILE_GAP);
                    boolean over = inside(new int[] {tx, ty, tileWidth, tileHeight}, mouseX, mouseY);
                    if (index == count - 1) {
                        float hover = Animations.hover(key("tile-add"), over);
                        if (graphics != null) {
                            blit(graphics, SettingsParts.addTile(tileWidth, tileHeight, Animations.step(hover, Buttons.HOVER_STEPS)),
                                tx, ty, tileWidth, tileHeight);
                        }
                        out.add(new Control(tx, ty, tileWidth, tileHeight, new Runnable() {
                            @Override
                            public void run() {
                                pendingPick = ClientSettings.Background.IMAGE;
                            }
                        }, null));
                        continue;
                    }
                    final File item = index == 0 ? null : items.get(index - 1);
                    boolean chosen = item == null ? current == ClientSettings.Background.KIZA : item.equals(shownFile);
                    ClientSettings.Background kind = item == null ? ClientSettings.Background.KIZA : kindOf(item);
                    float hover = Animations.hover(key("tile-" + (item == null ? "kiza" : item.getName())), over);
                    if (graphics != null) {
                        Object thumbnail = item == null ? MenuLibrary.kizaThumbnail() : MenuLibrary.thumbnail(item);
                        // Held to the visible band like everything else: drawn
                        // past it, a tile scrolled up covered the title.
                        if (thumbnail != null && inBand(ty, tileHeight)) {
                            MenuLogoRenderer.blitTexture(graphics, thumbnail, tx, ty, tileWidth, tileHeight,
                                MenuLibrary.THUMB_WIDTH, MenuLibrary.THUMB_HEIGHT);
                        }
                        int badge = kind == ClientSettings.Background.GIF ? SettingsParts.BADGE_GIF
                            : kind == ClientSettings.Background.VIDEO ? SettingsParts.BADGE_VIDEO : SettingsParts.BADGE_NONE;
                        blit(graphics, SettingsParts.tileFrame(tileWidth, tileHeight, chosen, Animations.step(hover, Buttons.HOVER_STEPS), badge),
                            tx, ty, tileWidth, tileHeight);
                    }
                    if (item != null && over) {
                        // The cross first: it lies over the tile, and takes the click.
                        int size = 12;
                        int cx = tx + tileWidth - size - 3;
                        int cy = ty + 3;
                        boolean overCross = inside(new int[] {cx, cy, size, size}, mouseX, mouseY);
                        if (graphics != null) {
                            blit(graphics, SettingsParts.removeBadge(size, overCross ? Buttons.HOVER_STEPS : 0), cx, cy, size, size);
                        }
                        out.add(new Control(cx, cy, size, size, new Runnable() {
                            @Override
                            public void run() {
                                removeFromLibrary(item);
                            }
                        }, null));
                    }
                    final ClientSettings.Background tileKind = kind;
                    out.add(new Control(tx, ty, tileWidth, tileHeight, new Runnable() {
                        @Override
                        public void run() {
                            note = null;
                            ClientSettings.setBackground(tileKind, item == null ? null : item.getName());
                        }
                    }, null));
                }
            }
        };
    }

    /**
     * Takes a background out of the library. The one shown goes back to
     * Kiza's first, and is deleted once its player lets go of the file.
     */
    private static void removeFromLibrary(File item) {
        File shownFile = ClientSettings.background() == ClientSettings.Background.KIZA ? null : ClientSettings.backgroundFile();
        if (item.equals(shownFile)) {
            ClientSettings.setBackground(ClientSettings.Background.KIZA, null);
            MenuBackground.forget(item);
            MenuLibrary.changed();
        } else {
            MenuLibrary.remove(item);
        }
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

    /** Where the pointer has taken the custom colour and the menu not yet: hue, saturation, brightness. */
    private static float[] pickedColour;
    private static long colourAppliedAt;
    /**
     * The menu takes a new colour this often at most while the palette is
     * dragged: each one paints its buttons, switches and sliders again. The
     * marker follows the pointer every frame.
     */
    private static final long COLOUR_EVERY_NANOS = 50_000_000L;

    private static void pickColour(float hue, float saturation, float brightness) {
        // Held inside the square and the strip: the pointer may leave them
        // while it drags, the marker may not.
        pickedColour = new float[] {
            Math.max(0F, Math.min(0.999F, hue)),
            Math.max(0F, Math.min(1F, saturation)),
            Math.max(0F, Math.min(1F, brightness))
        };
        applyPickedColour();
    }

    /** Gives the menu the picked colour, if its turn has come. */
    private static void applyPickedColour() {
        float[] picked = pickedColour;
        long now = System.nanoTime();
        if (picked == null || now - colourAppliedAt < COLOUR_EVERY_NANOS) return;
        ClientSettings.setCustomColour(picked[0], picked[1], picked[2]);
        colourAppliedAt = now;
        pickedColour = null;
    }

    /**
     * The custom colour's palette, under the swatches once it is chosen:
     * saturation and brightness in a square, the hue in a strip under it,
     * each dragged like a slider, the colour applied as it moves.
     */
    private static Row paletteRow() {
        return new Row() {
            @Override
            public int height() {
                return 96;
            }

            @Override
            public boolean whole() {
                return false;
            }

            @Override
            public void draw(Object graphics, int x, int y, int width, int mouseX, int mouseY, List<Control> out) {
                // The last pick reaches the menu once its turn comes.
                applyPickedColour();
                final float[] applied = ClientSettings.customHsb();
                final float[] hsb = pickedColour != null ? pickedColour : applied;
                int areaX = x + INSET;
                int areaWidth = width - INSET * 2;
                int squareY = y + 4;
                int squareHeight = 62;
                int stripY = squareY + squareHeight + 8;
                int stripHeight = 10;
                int marker = 10;
                if (graphics != null) {
                    int hueStep = Math.round(applied[0] * 360F) % 360;
                    blit(graphics, SettingsParts.palette(areaWidth, squareHeight, hueStep), areaX, squareY, areaWidth, squareHeight);
                    blit(graphics, SettingsParts.hueStrip(areaWidth, stripHeight), areaX, stripY, areaWidth, stripHeight);
                    // A marker only over its square or strip: scrolled half out,
                    // the square is not drawn, and its marker floated alone.
                    if (inBand(squareY, squareHeight)) {
                        int mx = areaX + Math.round(hsb[1] * areaWidth) - marker / 2;
                        int my = squareY + Math.round((1F - hsb[2]) * squareHeight) - marker / 2;
                        blit(graphics, SettingsParts.marker(marker), mx, my, marker, marker);
                    }
                    if (inBand(stripY, stripHeight)) {
                        int hx = areaX + Math.round(hsb[0] * areaWidth) - marker / 2;
                        blit(graphics, SettingsParts.marker(marker), hx, stripY + stripHeight / 2 - marker / 2, marker, marker);
                    }
                }
                out.add(new Control(areaX, squareY, areaWidth, squareHeight, null, new Slider() {
                    @Override
                    public void set(float value) {
                        set(value, 1F - hsb[2]);
                    }

                    @Override
                    public void set(float across, float down) {
                        pickColour(hsb[0], across, 1F - down);
                    }
                }));
                // Taller than the strip: a ten-pixel bar is a hard target.
                out.add(new Control(areaX, stripY - 4, areaWidth, stripHeight + 8, null, new Slider() {
                    @Override
                    public void set(float value) {
                        pickColour(Math.min(0.999F, Math.max(0F, value)), hsb[1], hsb[2]);
                    }
                }));
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
            Object chosen = open.invoke(null, ClientText.get("kiza.dialog.any"), "", null, null, false);
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
        // Matroska and WebM need the launcher's FFmpeg: JCodec reads MP4 alone.
        if ((name.endsWith(".mkv") || name.endsWith(".webm")) && FFmpegPreparation.executable() != null) {
            return ClientSettings.Background.VIDEO;
        }
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
        if (kind == ClientSettings.Background.VIDEO) {
            // Read from the file's boxes, before a hundred megabytes are
            // copied for a codec the menu cannot play.
            String codec = VideoCodec.fourcc(source);
            if (!VideoCodec.playable(codec)) {
                note = ClientText.of("kiza.video.codec", VideoCodec.name(codec));
                noteIsProgress = false;
                return;
            }
        }
        final long limit = kind == ClientSettings.Background.VIDEO ? 400L << 20 : 60L << 20;
        if (source.length() > limit) {
            note = ClientText.of("kiza.import.too_large", limit >> 20);
            noteIsProgress = false;
            return;
        }
        note = ClientText.of("kiza.import.copying");
        noteIsProgress = true;
        Thread copy = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    // Into the library, which keeps it among the others: the
                    // one shown before stays there to be picked again.
                    File target = MenuLibrary.add(source);
                    ClientSettings.setBackground(kind, target.getName());
                    note = null;
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
                    control.slider.set(
                        (float) ((x - control.x) / Math.max(1, control.w)),
                        (float) ((y - control.y) / Math.max(1, control.h))
                    );
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

    /** Whether something this tall at {@code y} lies wholly in the visible band, or there is no band. */
    private static boolean inBand(int y, int h) {
        return band == null || y >= band[0] && y + h <= band[1];
    }

    private static void blit(Object graphics, Object texture, int x, int y, int w, int h) {
        if (graphics == null || texture == null) return;
        if (!inBand(y, h)) return;
        int scale = Buttons.supersample();
        MenuLogoRenderer.blitTexture(graphics, texture, x, y, w, h, w * scale, h * scale);
    }

    private static void drawText(Object graphics, String text, int size, int colour, boolean bold, int x, int y) {
        if (graphics == null) return;
        if (!inBand(y, size + 4)) return;
        int[] measured = new int[2];
        Object texture = Buttons.text(text, size, colour, bold, measured);
        int scale = Buttons.supersample();
        MenuLogoRenderer.blitTexture(graphics, texture, x, y, measured[0], measured[1], measured[0] * scale, measured[1] * scale);
    }
}
