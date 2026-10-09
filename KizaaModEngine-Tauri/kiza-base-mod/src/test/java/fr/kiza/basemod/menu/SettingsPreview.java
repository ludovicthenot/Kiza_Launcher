package fr.kiza.basemod.menu;

import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

/**
 * The title screen with the Kiza Client settings open, rendered to a PNG.
 *
 * <p>The panel's own drawing code, the game's blits standing in as Java2D
 * through the preview mode. The pointer rests on the first switch.
 *
 *     node kiza-base-mod/build.mjs --preview
 */
public final class SettingsPreview {
    private static final int WIDTH = 480;
    private static final int HEIGHT = 300;
    private static final int SCALE = 2;

    private SettingsPreview() {}

    public static void main(String[] arguments) throws Exception {
        fr.kiza.basemod.render.KizaCanvas.previewMode();
        MenuInput.previewMode();
        File output = new File(arguments.length > 0 ? arguments[0] : "settings-preview.png");
        boolean open = arguments.length < 2 || !"closed".equals(arguments[1]);

        BufferedImage image = new BufferedImage(WIDTH * SCALE, HEIGHT * SCALE, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        java.io.InputStream stream = SettingsPreview.class.getResourceAsStream("/assets/kiza_base_mod/textures/gui/kiza_menu_background.png");
        BufferedImage background = ImageIO.read(stream);
        stream.close();
        g.drawImage(background, 0, 0, WIDTH * SCALE, HEIGHT * SCALE, null);
        g.scale(SCALE, SCALE);
        if (open) SettingsPanel.previewOpen();
        // Twice: the first frame lays out, the second has the hovers settled.
        for (int frame = 0; frame < 2; frame += 1) {
            SettingsPanel.render(g, WIDTH, HEIGHT, HEIGHT - 30, open ? 360 : 18, open ? 92 : HEIGHT - 40);
        }
        g.dispose();
        ImageIO.write(image, "png", output);
        System.out.println("Settings preview: " + output.getAbsolutePath());
    }
}
