package fr.kiza.basemod.menu;

import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.File;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import javax.imageio.ImageIO;

/**
 * The Kiza title menu rendered to a PNG, without starting Minecraft.
 *
 * <p>Everything Kiza draws is the real thing: the plan comes from
 * {@link MenuDesign#plan}, the buttons and the wordmark from {@link Buttons},
 * the emblem from the mod's own resources. What is faked is the game -- the
 * panorama is the menu background Kiza ships, and there is no Minecraft
 * button underneath, because in the game there is nothing of it left to see.
 *
 *     node kiza-base-mod/build.mjs --preview
 */
public final class TitleMenuPreview {
    private static final int WIDTH = 480;
    private static final int HEIGHT = 300;
    /** GUI scale: 960x600 on screen. */
    private static final int SCALE = 2;

    private TitleMenuPreview() {}

    public static void main(String[] arguments) throws Exception {
        File output = new File(arguments.length > 0 ? arguments[0] : "title-menu-preview.png");
        String hoveredLabel = arguments.length > 1 ? arguments[1] : "Mods";

        BufferedImage image = new BufferedImage(WIDTH * SCALE, HEIGHT * SCALE, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        Buttons.quality(g);
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);

        BufferedImage background = read("/assets/kiza_base_mod/textures/gui/kiza_menu_background.png");
        if (background != null) cover(g, background, WIDTH * SCALE, HEIGHT * SCALE);
        g.setColor(new Color(MenuDesign.VEIL, true));
        g.fillRect(0, 0, WIDTH * SCALE, HEIGHT * SCALE);

        List<String> labels = Arrays.asList("Singleplayer", "Multiplayer", "Minecraft Realms", "Mods", "Options...", "Quit Game");
        List<MenuDesign.Role> roles = new ArrayList<MenuDesign.Role>();
        for (String label : labels) roles.add(MenuDesign.roleOf(null, label));
        MenuDesign.Plan plan = MenuDesign.plan(roles, WIDTH, HEIGHT);
        if (plan == null) throw new IllegalStateException("No plan for the vanilla title screen");

        BufferedImage emblem = read(MenuDesign.EMBLEM);
        if (emblem != null) {
            // "logo" as the second argument shows the pointer over the emblem,
            // with the light half way across it.
            boolean overLogo = "logo".equals(hoveredLabel);
            BufferedImage painted = Buttons.paintEmblem(
                emblem, plan.emblemSize, SCALE, overLogo ? 1F : 0F, overLogo ? 0.5F : -1F, 1F
            );
            int pad = Buttons.EMBLEM_GLOW * SCALE;
            g.drawImage(painted, plan.emblemX * SCALE - pad, plan.emblemY * SCALE - pad, null);
        }
        BufferedImage wordmark = Buttons.paintWordmark(SCALE, 1F);
        g.drawImage(wordmark, plan.centreX * SCALE - wordmark.getWidth() / 2,
            plan.wordmarkY * SCALE - 3 * SCALE, null);

        for (int index = 0; index < labels.size(); index += 1) {
            MenuDesign.Slot slot = plan.slots.get(index);
            if (slot == null) continue;
            float hover = labels.get(index).equals(hoveredLabel) ? 1F : 0F;
            BufferedImage button = Buttons.paint(
                MenuDesign.displayLabel(roles.get(index), labels.get(index)), roles.get(index),
                slot.width, slot.height, hover, 1F, SCALE);
            g.drawImage(button, slot.x * SCALE, slot.y * SCALE, null);
        }
        g.dispose();
        ImageIO.write(image, "png", output);
        System.out.println("Title menu preview: " + output.getAbsolutePath());
    }

    private static BufferedImage read(String resource) throws Exception {
        InputStream stream = TitleMenuPreview.class.getResourceAsStream(resource);
        if (stream == null) return null;
        try {
            return ImageIO.read(stream);
        } finally {
            stream.close();
        }
    }

    /** Fills the frame with the picture, cropping rather than stretching it. */
    private static void cover(Graphics2D g, BufferedImage picture, int width, int height) {
        double scale = Math.max(width / (double) picture.getWidth(), height / (double) picture.getHeight());
        int w = (int) Math.ceil(picture.getWidth() * scale);
        int h = (int) Math.ceil(picture.getHeight() * scale);
        g.drawImage(picture, (width - w) / 2, (height - h) / 2, w, h, null);
    }
}
