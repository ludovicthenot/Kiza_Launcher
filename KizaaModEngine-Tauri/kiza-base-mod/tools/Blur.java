import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.awt.image.ConvolveOp;
import java.awt.image.Kernel;
import java.io.File;
import java.util.Arrays;
import javax.imageio.ImageIO;

/** Blurs the menu background at build time, so the game pays nothing for it. */
public class Blur {
    public static void main(String[] a) throws Exception {
        BufferedImage source = ImageIO.read(new File(a[0]));
        int radius = Integer.parseInt(a[2]);

        // Three box passes are a Gaussian close enough, and separable, so the
        // cost is linear in the radius rather than square.
        float[] line = new float[radius * 2 + 1];
        Arrays.fill(line, 1.0f / line.length);
        ConvolveOp across =
            new ConvolveOp(new Kernel(line.length, 1, line), ConvolveOp.EDGE_NO_OP, null);
        ConvolveOp down =
            new ConvolveOp(new Kernel(1, line.length, line), ConvolveOp.EDGE_NO_OP, null);

        BufferedImage image = source;
        for (int pass = 0; pass < 3; pass += 1) {
            image = down.filter(across.filter(image, null), null);
        }

        // EDGE_NO_OP leaves an unblurred border the width of the kernel, which
        // reads as a sharp frame around a soft picture. Trimming it and scaling
        // back is cheaper than any of the alternatives and invisible.
        int trim = radius * 3;
        BufferedImage cropped = image.getSubimage(
            trim, trim, image.getWidth() - trim * 2, image.getHeight() - trim * 2);
        BufferedImage out = new BufferedImage(
            source.getWidth(), source.getHeight(), BufferedImage.TYPE_INT_RGB);
        Graphics2D g = out.createGraphics();
        g.setRenderingHint(
            RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g.drawImage(cropped, 0, 0, out.getWidth(), out.getHeight(), null);
        g.dispose();

        ImageIO.write(out, "PNG", new File(a[1]));
        System.out.println("radius " + radius + " -> " + out.getWidth() + "x" + out.getHeight()
            + ", " + (new File(a[1]).length() / 1024) + " KB");
    }
}
