package fr.kiza.basemod.menu;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.geom.AffineTransform;
import java.awt.geom.Arc2D;
import java.awt.geom.Ellipse2D;
import java.awt.geom.Line2D;
import java.awt.geom.Path2D;
import java.awt.geom.RoundRectangle2D;

/**
 * The small pictures in front of the menu's labels.
 *
 * <p>Drawn as vectors on a 24-unit grid, in the stroke weight the launcher's
 * own icons use, so they stay sharp at every GUI scale and read as the same
 * family as the launcher's. No image files: six shapes are fewer bytes than
 * one PNG, and they cannot be missing from a jar.
 *
 * <p>Only roles Kiza is sure of get one. A button some mod added is drawn with
 * its words alone rather than with a picture that might say the wrong thing.
 */
final class MenuIcons {
    private MenuIcons() {}

    static boolean has(MenuDesign.Role role) {
        return role != null && role != MenuDesign.Role.OTHER;
    }

    static void draw(Graphics2D g, MenuDesign.Role role, int x, int y, int size, Color colour, int scale) {
        Graphics2D icon = (Graphics2D) g.create();
        try {
            AffineTransform grid = new AffineTransform();
            grid.translate(x, y);
            grid.scale(size / 24.0, size / 24.0);
            icon.transform(grid);
            icon.setColor(colour);
            // Heavier than the launcher's 2 units: these are drawn at eight
            // GUI pixels, where a hairline vanishes into the surface.
            icon.setStroke(new BasicStroke(2.6F, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            switch (role) {
                case SINGLEPLAYER:
                    user(icon, 12, 0);
                    break;
                case MULTIPLAYER:
                    users(icon);
                    break;
                case REALMS:
                    globe(icon);
                    break;
                case MODS:
                    grid(icon);
                    break;
                case OPTIONS:
                    gear(icon);
                    break;
                case QUIT:
                    power(icon);
                    break;
                default:
                    break;
            }
        } finally {
            icon.dispose();
        }
    }

    /** A head and shoulders, filled, the way the reference menu draws them. */
    private static void user(Graphics2D g, double centre, double shift) {
        g.fill(new Ellipse2D.Double(centre - 4.5 + shift, 2.5, 9, 9));
        Path2D.Double body = new Path2D.Double();
        body.moveTo(centre - 8 + shift, 21.5);
        body.curveTo(centre - 8 + shift, 15.5, centre - 4 + shift, 13.5, centre + shift, 13.5);
        body.curveTo(centre + 4 + shift, 13.5, centre + 8 + shift, 15.5, centre + 8 + shift, 21.5);
        body.closePath();
        g.fill(body);
    }

    private static void users(Graphics2D g) {
        // The one behind, smaller and to the right, then the one in front.
        g.fill(new Ellipse2D.Double(13.5, 3.5, 7, 7));
        Path2D.Double back = new Path2D.Double();
        back.moveTo(14, 20.5);
        back.curveTo(14, 15, 15.5, 12.8, 17, 12.8);
        back.curveTo(20.5, 12.8, 23.5, 14.8, 23.5, 20.5);
        back.closePath();
        g.fill(back);
        user(g, 9, 0);
    }

    private static void globe(Graphics2D g) {
        g.draw(new Ellipse2D.Double(3, 3, 18, 18));
        g.draw(new Ellipse2D.Double(8, 3, 8, 18));
        g.draw(new Line2D.Double(3.5, 12, 20.5, 12));
    }

    /** Nine squares, filled: the reference's "mods" mark. */
    private static void grid(Graphics2D g) {
        for (int row = 0; row < 3; row += 1) {
            for (int column = 0; column < 3; column += 1) {
                g.fill(new RoundRectangle2D.Double(3 + column * 6.6, 3 + row * 6.6, 4.8, 4.8, 1.4, 1.4));
            }
        }
    }

    private static void gear(Graphics2D g) {
        // Eight teeth around a ring, filled, with the hole punched through.
        Path2D.Double wheel = new Path2D.Double(Path2D.WIND_EVEN_ODD);
        int teeth = 8;
        for (int index = 0; index < teeth * 2; index += 1) {
            double angle = Math.PI * index / teeth - Math.PI / 2;
            boolean tooth = index % 2 == 0;
            double outer = tooth ? 11.2 : 8.6;
            double spread = Math.PI / teeth * 0.42;
            double a1 = angle - spread;
            double a2 = angle + spread;
            double x1 = 12 + Math.cos(a1) * outer;
            double y1 = 12 + Math.sin(a1) * outer;
            double x2 = 12 + Math.cos(a2) * outer;
            double y2 = 12 + Math.sin(a2) * outer;
            if (index == 0) wheel.moveTo(x1, y1);
            else wheel.lineTo(x1, y1);
            wheel.lineTo(x2, y2);
        }
        wheel.closePath();
        wheel.append(new Ellipse2D.Double(8.4, 8.4, 7.2, 7.2), false);
        g.fill(wheel);
    }

    private static void power(Graphics2D g) {
        g.draw(new Arc2D.Double(3.5, 4, 17, 17, 125, 290, Arc2D.OPEN));
        g.draw(new Line2D.Double(12, 2.5, 12, 11));
    }
}
