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
 * The Kiza Client settings: a round gear at the bottom left of the title
 * screen, and the panel it opens.
 *
 * <p>Minecraft has no widget here, so nothing of this is a widget: it is drawn
 * by Kiza like the rest of the menu, and {@link MenuInput} brings it the
 * window's clicks. With the panel shut the only click taken is the one on the
 * gear; with it open every click is the panel's, and a click beside it shuts
 * it, as Escape does.
 *
 * <p>Each part is its own small texture -- a label, a switch, a chip -- so the
 * pointer moving over one redraws that one. The layout is worked out every
 * frame and kept, so a click is tested against exactly what was drawn.
 */
public final class SettingsPanel {
    private SettingsPanel() {}

    private static final int GEAR = 20;
    private static final int PAD = 12;
    private static final int HEADER = 30;
    private static final int ROW = 20;
    private static final int GAP = 4;

    private static boolean open;
    private static int scroll;
    private static int maxScroll;
    private static boolean gearPressed;
    private static Control pressed;
    private static Control dragging;
    private static ClientSettings.Background pendingPick;
    private static volatile String note;

    private static int[] gear;
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
        gearPressed = false;
        return false;
    }

    /** Tests only: the panel open, for the preview. */
    static void previewOpen() {
        open = true;
    }

    // ---- Drawing --------------------------------------------------------------

    /**
     * The gear, and the panel when it is open. Called by the title screen
     * after its buttons.
     *
     * @param bottom the lowest the gear may reach: just above the footer
     */
    public static void render(Object graphics, int width, int height, int bottom, int mouseX, int mouseY) {
        MenuInput.frame(width, height);
        if (!MenuInput.available()) return;
        if (pendingPick != null) pick();

        int gearY = bottom - GEAR;
        gear = new int[] {10, gearY, GEAR, GEAR};
        boolean overGear = !open && inside(gear, mouseX, mouseY);
        blitRound(graphics, "gear", gear[0], gear[1], GEAR, Animations.hover(key("gear"), overGear || open));

        if (!open) {
            controls = new ArrayList<Control>();
            panel = null;
            return;
        }
        MenuLogoRenderer.fill(graphics, 0, 0, width, height, 0x9E050409);
        drawPanel(graphics, width, height, mouseX, mouseY);
    }

    private static void drawPanel(Object graphics, int width, int height, int mouseX, int mouseY) {
        int panelWidth = Math.min(460, width - 24);
        boolean twoColumns = panelWidth >= 420;
        int column = twoColumns ? (panelWidth - PAD * 3) / 2 : panelWidth - PAD * 2;

        // Laid out once to measure, then drawn at the scroll it allows.
        int leftHeight = background(null, 0, 0, column, mouseX, mouseY, new ArrayList<Control>());
        int rightHeight = interfaceRows(null, 0, 0, column, mouseX, mouseY, new ArrayList<Control>());
        int content = twoColumns ? Math.max(leftHeight, rightHeight) : leftHeight + PAD + rightHeight;
        int panelHeight = Math.min(HEADER + content + PAD, height - 24);
        maxScroll = Math.max(0, HEADER + content + PAD - panelHeight);
        scroll = Math.max(0, Math.min(maxScroll, scroll));

        int x = (width - panelWidth) / 2;
        int y = (height - panelHeight) / 2;
        panel = new int[] {x, y, panelWidth, panelHeight};
        blit(graphics, Buttons.card(panelWidth, panelHeight), x, y, panelWidth, panelHeight);

        List<Control> drawn = new ArrayList<Control>();
        drawText(graphics, "Paramètres du client", 11, MenuDesign.TEXT, true, x + PAD, y + 9);
        int closeX = x + panelWidth - PAD - 16;
        int closeY = y + 7;
        blitRound(graphics, "close", closeX, closeY, 16, Animations.hover(key("close"), inside(new int[] {closeX, closeY, 16, 16}, mouseX, mouseY)));
        drawn.add(new Control(closeX, closeY, 16, 16, new Runnable() {
            @Override
            public void run() {
                open = false;
            }
        }, null));

        int top = y + HEADER - scroll;
        int band0 = y + HEADER - 2;
        int band1 = y + panelHeight - 4;
        List<Control> visible = new ArrayList<Control>();
        band = new int[] {band0, band1};
        if (twoColumns) {
            background(graphics, x + PAD, top, column, mouseX, mouseY, visible);
            interfaceRows(graphics, x + PAD * 2 + column, top, column, mouseX, mouseY, visible);
        } else {
            int below = background(graphics, x + PAD, top, column, mouseX, mouseY, visible);
            interfaceRows(graphics, x + PAD, top + below + PAD, column, mouseX, mouseY, visible);
        }
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
    private static int background(Object graphics, int x, int y, int width, int mouseX, int mouseY, List<Control> out) {
        int top = y;
        y = section(graphics, "FOND DU MENU", x, y);

        final ClientSettings.Background current = ClientSettings.background();
        y = chips(graphics, x, y, width, mouseX, mouseY, out, new ClientSettings.Background[] {ClientSettings.Background.KIZA}, current);
        y = chips(graphics, x, y, width, mouseX, mouseY, out, new ClientSettings.Background[] {
            ClientSettings.Background.IMAGE, ClientSettings.Background.GIF, ClientSettings.Background.VIDEO
        }, current);

        if (current != ClientSettings.Background.KIZA) {
            File chosen = ClientSettings.backgroundFile();
            String name = chosen == null ? "Aucun fichier" : chosen.getName();
            int button = 64;
            visibleText(graphics, shorten(name, 30), 9, MenuDesign.TEXT_SOFT, false, x, y + 5, y);
            final ClientSettings.Background kind = current;
            y = button(graphics, "Choisir", x + width - button, y, button, mouseX, mouseY, out, new Runnable() {
                @Override
                public void run() {
                    pendingPick = kind;
                }
            });
        }
        String problem = note != null ? note : MenuBackground.problem();
        if (problem != null && current != ClientSettings.Background.KIZA) {
            // Progress is news, not a fault: said in the plain colour.
            int colour = problem.startsWith("Préparation") || problem.startsWith("Copie") ? MenuDesign.TEXT_SOFT : 0xFFF0A0A8;
            for (String line : wrap(problem, 44)) {
                visibleText(graphics, line, 8, colour, false, x, y, y);
                y += 11;
            }
            y += 2;
        } else if (current != ClientSettings.Background.KIZA) {
            visibleText(graphics, "Ou glisse le fichier sur la fenêtre du jeu.", 8, MenuDesign.TEXT_DISABLED, false, x, y, y);
            y += 13;
        }

        y = toggle(graphics, "Fond sur tous les menus", "menu.background-everywhere", x, y, width, mouseX, mouseY, out);

        final int dim = ClientSettings.dim();
        y = slider(graphics, "Assombrissement : " + dim + " %", dim / 90F, x, y, width, mouseX, mouseY, out, new Slider() {
            @Override
            public void set(float value) {
                ClientSettings.setDim(Math.round(Math.max(0F, Math.min(1F, value)) * 90F));
            }
        });

        y += 4;
        y = section(graphics, "COULEUR", x, y);
        int swatch = 18;
        int sx = x;
        for (final ClientSettings.Accent accent : ClientSettings.Accent.values()) {
            boolean chosen = accent == ClientSettings.accent();
            boolean over = inside(new int[] {sx, y, swatch, swatch}, mouseX, mouseY);
            float hover = Animations.hover(key("swatch-" + accent), over);
            if (graphics != null) {
                blit(graphics, Buttons.swatch(accent, chosen, Animations.step(hover, Buttons.HOVER_STEPS)), sx, y, swatch, swatch);
            }
            out.add(new Control(sx, y, swatch, swatch, new Runnable() {
                @Override
                public void run() {
                    ClientSettings.setAccent(accent);
                }
            }, null));
            sx += swatch + 6;
        }
        y += swatch + 2;
        return y - top;
    }

    /** The interface column; returns its height. */
    private static int interfaceRows(Object graphics, int x, int y, int width, int mouseX, int mouseY, List<Control> out) {
        int top = y;
        y = section(graphics, "INTERFACE", x, y);
        y = toggle(graphics, "Animations d'ouverture", "menu.animations", x, y, width, mouseX, mouseY, out);
        y = toggle(graphics, "Effet du logo au survol", "menu.logo-effect", x, y, width, mouseX, mouseY, out);
        y = toggle(graphics, "Icônes dans les boutons", "menu.icons", x, y, width, mouseX, mouseY, out);
        y = toggle(graphics, "Style Kiza sur tous les écrans", "menu.everywhere", x, y, width, mouseX, mouseY, out);
        y += 4;
        y = section(graphics, "INFORMATIONS", x, y);
        y = toggle(graphics, "Version en bas de l'écran", "menu.footer", x, y, width, mouseX, mouseY, out);
        y = toggle(graphics, "Ligne Kiza Client dans F3", "menu.debug-line", x, y, width, mouseX, mouseY, out);
        y += 4;
        visibleText(graphics, "Enregistré pour cette instance.", 8, MenuDesign.TEXT_DISABLED, false, x, y, y);
        y += 12;
        return y - top;
    }

    private static int section(Object graphics, String title, int x, int y) {
        visibleText(graphics, title, 8, 0xFF9F99B5, true, x, y, y);
        return y + 14;
    }

    private static int chips(
        Object graphics,
        int x,
        int y,
        int width,
        int mouseX,
        int mouseY,
        List<Control> out,
        ClientSettings.Background[] kinds,
        ClientSettings.Background current
    ) {
        int each = (width - GAP * (kinds.length - 1)) / kinds.length;
        int cx = x;
        for (final ClientSettings.Background kind : kinds) {
            boolean over = inside(new int[] {cx, y, each, ROW}, mouseX, mouseY);
            float hover = Animations.hover(key("chip-" + kind), over || kind == current);
            if (graphics != null) {
                Object texture = Buttons.texture(label(kind), MenuDesign.Role.OTHER, each, ROW,
                    Animations.step(hover, Buttons.HOVER_STEPS), Buttons.FADE_STEPS, true);
                blit(graphics, texture, cx, y, each, ROW);
            }
            out.add(new Control(cx, y, each, ROW, new Runnable() {
                @Override
                public void run() {
                    choose(kind);
                }
            }, null));
            cx += each + GAP;
        }
        return y + ROW + GAP;
    }

    private static int button(Object graphics, String text, int x, int y, int width, int mouseX, int mouseY, List<Control> out, Runnable action) {
        boolean over = inside(new int[] {x, y, width, ROW}, mouseX, mouseY);
        float hover = Animations.hover(key("button-" + text), over);
        if (graphics != null) {
            blit(graphics, Buttons.texture(text, MenuDesign.Role.OTHER, width, ROW,
                Animations.step(hover, Buttons.HOVER_STEPS), Buttons.FADE_STEPS, true), x, y, width, ROW);
        }
        out.add(new Control(x, y, width, ROW, action, null));
        return y + ROW + GAP;
    }

    private static int slider(Object graphics, String text, float value, int x, int y, int width, int mouseX, int mouseY, List<Control> out, Slider set) {
        boolean over = inside(new int[] {x, y, width, ROW}, mouseX, mouseY);
        Control control = new Control(x, y, width, ROW, null, set);
        float hover = Animations.hover(key("slider-" + text.split(":")[0]), over || dragging != null);
        if (graphics != null) {
            blit(graphics, Buttons.slider(text, width, ROW, Animations.step(value, Buttons.SLIDER_STEPS),
                Animations.step(hover, Buttons.HOVER_STEPS), true), x, y, width, ROW);
        }
        out.add(control);
        return y + ROW + GAP;
    }

    private static int toggle(Object graphics, String text, final String setting, int x, int y, int width, int mouseX, int mouseY, List<Control> out) {
        int rowHeight = 18;
        boolean on = ClientSettings.flag(setting);
        boolean over = inside(new int[] {x, y, width, rowHeight}, mouseX, mouseY);
        float hover = Animations.hover(key("toggle-" + setting), over);
        if (graphics != null) {
            drawText(graphics, text, 9, MenuDesign.mix(MenuDesign.TEXT_SOFT, 0xFFFFFFFF, hover), false, x, y + 3);
            blit(graphics, Buttons.toggle(on, Animations.step(hover, Buttons.HOVER_STEPS)), x + width - 26, y + 2, 26, 14);
        }
        out.add(new Control(x, y, width, rowHeight, new Runnable() {
            @Override
            public void run() {
                ClientSettings.setFlag(setting, !ClientSettings.flag(setting));
            }
        }, null));
        return y + rowHeight + 2;
    }

    private static String label(ClientSettings.Background kind) {
        switch (kind) {
            case IMAGE:
                return "Image";
            case GIF:
                return "GIF";
            case VIDEO:
                return "Vidéo";
            default:
                return "Kiza";
        }
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
            Object chosen = open.invoke(null, "Choisir " + article(kind), "", null, null, false);
            if (chosen instanceof String && !((String) chosen).isEmpty()) importFile(new File((String) chosen), kind);
        } catch (Throwable unavailable) {
            note = "Glisse le fichier sur la fenêtre du jeu.";
        }
    }

    private static String article(ClientSettings.Background kind) {
        switch (kind) {
            case IMAGE:
                return "une image";
            case GIF:
                return "un GIF";
            default:
                return "une vidéo MP4";
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
            note = "Ce type de fichier n'est pas pris en charge (PNG, JPG, GIF ou MP4).";
            return;
        }
        final long limit = kind == ClientSettings.Background.VIDEO ? 400L << 20 : 60L << 20;
        if (source.length() > limit) {
            note = "Ce fichier est trop lourd (" + (limit >> 20) + " Mo au plus).";
            return;
        }
        final File folder = ClientSettings.folder();
        if (folder == null) {
            note = "Le fichier n'a pas pu être copié.";
            return;
        }
        note = "Copie du fichier...";
        Thread copy = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    String extension = source.getName().substring(source.getName().lastIndexOf('.')).toLowerCase(Locale.ROOT);
                    String name = "menu-background-" + kind.name().toLowerCase(Locale.ROOT) + extension;
                    folder.mkdirs();
                    File target = new File(folder, name);
                    java.nio.file.Files.copy(source.toPath(), target.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                    ClientSettings.setBackground(kind, name);
                    note = null;
                } catch (Exception failure) {
                    note = "Le fichier n'a pas pu être copié.";
                }
            }
        }, "kiza-menu-background-copy");
        copy.setDaemon(true);
        copy.start();
    }

    // ---- Input, from MenuInput --------------------------------------------------

    static boolean mouse(int button, boolean press, boolean release, double x, double y) {
        if (!open) {
            if (gear == null || button != 0) return false;
            if (press && inside(gear, x, y)) {
                gearPressed = true;
                return true;
            }
            if (release && gearPressed) {
                gearPressed = false;
                if (inside(gear, x, y)) {
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

    private static void blitRound(Object graphics, String icon, int x, int y, int size, float hover) {
        blit(graphics, Buttons.round(icon, size, Animations.step(hover, Buttons.HOVER_STEPS)), x, y, size, size);
    }

    private static void drawText(Object graphics, String text, int size, int colour, boolean bold, int x, int y) {
        if (graphics == null) return;
        if (band != null && (y < band[0] || y + size + 4 > band[1])) return;
        int[] measured = new int[2];
        Object texture = Buttons.text(text, size, colour, bold, measured);
        int scale = Buttons.supersample();
        MenuLogoRenderer.blitTexture(graphics, texture, x, y, measured[0], measured[1], measured[0] * scale, measured[1] * scale);
    }

    /** Text in the scrolling part; the band decides whether it is in view. */
    private static void visibleText(Object graphics, String text, int size, int colour, boolean bold, int x, int y, int rowTop) {
        drawText(graphics, text, size, colour, bold, x, y);
    }

    private static String shorten(String text, int max) {
        return text.length() <= max ? text : text.substring(0, max - 3) + "...";
    }

    private static List<String> wrap(String text, int max) {
        List<String> lines = new ArrayList<String>();
        StringBuilder line = new StringBuilder();
        for (String word : text.split(" ")) {
            if (line.length() > 0 && line.length() + word.length() + 1 > max) {
                lines.add(line.toString());
                line.setLength(0);
            }
            if (line.length() > 0) line.append(' ');
            line.append(word);
        }
        if (line.length() > 0) lines.add(line.toString());
        return lines;
    }
}
