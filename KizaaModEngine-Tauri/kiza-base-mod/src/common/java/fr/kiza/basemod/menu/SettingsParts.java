package fr.kiza.basemod.menu;

import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.FontMetrics;
import java.awt.GradientPaint;
import java.awt.Graphics2D;
import java.awt.geom.Area;
import java.awt.geom.Ellipse2D;
import java.awt.geom.Rectangle2D;
import java.awt.geom.RoundRectangle2D;
import java.awt.image.BufferedImage;

/**
 * The parts of the Kiza Client settings, drawn the way Apple draws its own:
 * a dark sheet, grouped rows on inset cards, segmented controls, switches
 * and a thin slider.
 *
 * <p>The colours are the dark system palette -- a grouped background, a
 * lighter card per group, labels in near-white and secondary text in grey --
 * with the player's accent as the one tint, on what is on: switches, the
 * slider's filled part, links. Nothing glows; hierarchy comes from the cards,
 * the spacing and the weight of the type.
 *
 * <p>Each part is a texture painted with Java2D at the supersampled scale and
 * cached like the menu's buttons. What moves -- a segmented control's thumb,
 * a switch's knob -- is drawn at a few quantised positions, each one a
 * texture, so a glide costs a handful of textures, not one a frame.
 */
final class SettingsParts {
    private SettingsParts() {}

    /** The sheet, behind everything. */
    static final int SHEET = 0xB01B1B21;
    /** A group's card. */
    static final int CARD = 0xD62A2A32;
    static final int CARD_PRESSED = 0xE63A3A44;
    /** Between rows of a card. */
    static final int SEPARATOR = 0x1EFFFFFF;
    static final int LABEL = 0xFFF2F2F7;
    static final int SECONDARY = 0xFF9A9AA6;
    static final int TERTIARY = 0xFF6C6C78;
    static final int ERROR = 0xFFFF6B66;
    private static final int TRACK = 0xFF1E1E23;
    private static final int THUMB = 0xFF5E5E68;
    private static final int OFF = 0xFF45454D;

    /** Steps a thumb or a knob is drawn at, between two positions. */
    static final int GLIDE_STEPS = 12;

    /** The sheet: dark, rounded, a hairline that catches the light along its top. */
    static Object sheet(int width, int height) {
        String key = "as|" + width + "x" + height;
        Object cached = Buttons.cachedPlain(key);
        if (cached != null) return cached;
        int scale = Buttons.supersample();
        int w = width * scale;
        int h = height * scale;
        BufferedImage image = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        Buttons.quality(g);
        float radius = 14F * scale * 2F;
        g.setColor(new Color(SHEET, true));
        g.fill(new RoundRectangle2D.Float(0, 0, w, h, radius, radius));
        float line = Math.max(1F, scale * 0.6F);
        g.setStroke(new BasicStroke(line));
        g.setPaint(new GradientPaint(0, 0, new Color(0x38FFFFFF, true), 0, h * 0.4F, new Color(0x0CFFFFFF, true)));
        g.draw(new RoundRectangle2D.Float(line / 2F, line / 2F, w - line, h - line, radius, radius));
        g.dispose();
        return Buttons.storePlain(key, image);
    }

    /**
     * One row's share of a group's card: the top row carries the card's top
     * corners, the bottom row its bottom ones. Drawn per row so a card
     * scrolled half out of view still has the rows that are in view.
     */
    static Object row(int width, int height, boolean top, boolean bottom, boolean pressed) {
        String key = "ar|" + width + "x" + height + "|" + top + "|" + bottom + "|" + pressed;
        Object cached = Buttons.cachedPlain(key);
        if (cached != null) return cached;
        int scale = Buttons.supersample();
        int w = width * scale;
        int h = height * scale;
        BufferedImage image = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        Buttons.quality(g);
        float radius = 10F * scale * 2F;
        Area shape = new Area(new RoundRectangle2D.Float(0, top ? 0 : -radius, w, h + (top ? 0 : radius) + (bottom ? 0 : radius), radius, radius));
        shape.intersect(new Area(new Rectangle2D.Float(0, 0, w, h)));
        g.setColor(new Color(pressed ? CARD_PRESSED : CARD, true));
        g.fill(shape);
        g.dispose();
        return Buttons.storePlain(key, image);
    }

    /**
     * A segmented control: a recessed track, a raised thumb under the chosen
     * segment, the labels over both. {@code thumb} is the thumb's position in
     * segments, quantised by the caller, so it can glide from one to another.
     */
    static Object segmented(String[] labels, int thumbStep, int width, int height, boolean enabled) {
        StringBuilder joined = new StringBuilder();
        for (String label : labels) joined.append(label).append('/');
        String key = "ag|" + joined + "|" + thumbStep + "|" + width + "x" + height + "|" + enabled;
        Object cached = Buttons.cachedPlain(key);
        if (cached != null) return cached;
        int scale = Buttons.supersample();
        int w = width * scale;
        int h = height * scale;
        float thumb = thumbStep / (float) GLIDE_STEPS;
        BufferedImage image = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        Buttons.quality(g);
        float radius = 7F * scale;
        g.setColor(new Color(TRACK, true));
        g.fill(new RoundRectangle2D.Float(0, 0, w, h, radius * 2F, radius * 2F));

        float each = w / (float) labels.length;
        float inset = 2F * scale;
        // Hairlines between segments, except where the thumb is.
        g.setColor(new Color(0x24FFFFFF, true));
        for (int index = 1; index < labels.length; index += 1) {
            if (Math.abs(index - thumb) < 1.05F || Math.abs(index - 1 - thumb) < 0.05F) continue;
            float x = each * index;
            g.fill(new Rectangle2D.Float(x - scale * 0.3F, h * 0.28F, scale * 0.6F, h * 0.44F));
        }
        RoundRectangle2D.Float raised = new RoundRectangle2D.Float(
            each * thumb + inset, inset, each - inset * 2F, h - inset * 2F, (radius - inset / 2F) * 2F, (radius - inset / 2F) * 2F);
        g.setColor(new Color(0x40000000, true));
        g.fill(new RoundRectangle2D.Float(raised.x, raised.y + scale * 0.6F, raised.width, raised.height, raised.arcwidth, raised.archeight));
        g.setColor(new Color(THUMB, true));
        g.fill(raised);

        Font chosen = Buttons.labelFont(Math.round(7.5F * scale));
        Font other = Buttons.plainFont(Math.round(7.5F * scale));
        for (int index = 0; index < labels.length; index += 1) {
            float near = Math.max(0F, 1F - Math.abs(index - thumb));
            Font font = fr.kiza.basemod.render.KizaText.covering(near > 0.5F ? chosen : other, labels[index]);
            String text = labels[index];
            // A long word in a narrow segment -- "Automatski" -- is set a
            // little smaller rather than spilling over its neighbours.
            float room = each - 5F * scale;
            int natural = g.getFontMetrics(font).stringWidth(text);
            if (natural > room) font = font.deriveFont(font.getSize2D() * Math.max(0.72F, room / natural));
            g.setFont(font);
            FontMetrics metrics = g.getFontMetrics();
            int textWidth = metrics.stringWidth(text);
            float x = each * index + (each - textWidth) / 2F;
            float baseline = (h + metrics.getAscent() * 0.72F) / 2F;
            g.setColor(new Color(MenuDesign.mix(SECONDARY, 0xFFFFFFFF, near), true));
            g.drawString(text, x, baseline);
        }
        g.dispose();
        if (!enabled) fadeAlpha(image, 0.4F);
        return Buttons.storePlain(key, image);
    }

    /**
     * A switch: the track in the accent when on, the white knob gliding
     * across. Held down, the knob stretches towards where it will go, as a
     * finger on glass would press it.
     */
    static Object toggle(int onStep, boolean pressed, int width, int height) {
        String key = "at|" + onStep + "|" + pressed + "|" + width + "x" + height;
        Object cached = Buttons.cached(key);
        if (cached != null) return cached;
        int scale = Buttons.supersample();
        float on = onStep / (float) GLIDE_STEPS;
        int w = width * scale;
        int h = height * scale;
        BufferedImage image = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        Buttons.quality(g);
        g.setColor(new Color(MenuDesign.mix(OFF, ClientSettings.accent().glow(), on), true));
        g.fill(new RoundRectangle2D.Float(0, 0, w, h, h, h));
        float pad = 1.5F * scale;
        float knob = h - pad * 2F;
        float stretch = pressed ? knob * 0.28F : 0F;
        float travel = w - pad * 2F - knob - stretch;
        float x = pad + travel * on;
        g.setColor(new Color(0x38000000, true));
        g.fill(new RoundRectangle2D.Float(x, pad + scale * 0.5F, knob + stretch, knob, knob, knob));
        g.setColor(Color.WHITE);
        g.fill(new RoundRectangle2D.Float(x, pad, knob + stretch, knob, knob, knob));
        g.dispose();
        return Buttons.store(key, image);
    }

    /** A thin track, filled in the accent up to the value, and a round white thumb. */
    static Object slider(int valueStep, int width, int height, boolean pressed) {
        String key = "al|" + valueStep + "|" + width + "x" + height + "|" + pressed;
        Object cached = Buttons.cached(key);
        if (cached != null) return cached;
        int scale = Buttons.supersample();
        float value = valueStep / (float) Buttons.SLIDER_STEPS;
        int w = width * scale;
        int h = height * scale;
        BufferedImage image = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        Buttons.quality(g);
        float thumb = h - scale;
        float track = 3F * scale;
        float left = thumb / 2F;
        float right = w - thumb / 2F;
        float centre = left + (right - left) * value;
        float y = (h - track) / 2F;
        g.setColor(new Color(OFF, true));
        g.fill(new RoundRectangle2D.Float(left - track / 2F, y, right - left + track, track, track, track));
        g.setColor(new Color(ClientSettings.accent().glow(), true));
        g.fill(new RoundRectangle2D.Float(left - track / 2F, y, centre - left + track / 2F, track, track, track));
        float size = pressed ? thumb : thumb * 0.92F;
        g.setColor(new Color(0x40000000, true));
        g.fill(new Ellipse2D.Float(centre - size / 2F, (h - size) / 2F + scale * 0.6F, size, size));
        g.setColor(Color.WHITE);
        g.fill(new Ellipse2D.Float(centre - size / 2F, (h - size) / 2F, size, size));
        g.dispose();
        return Buttons.store(key, image);
    }

    /**
     * The drawer's tab: the sheet's material, rounded on the side away from
     * the edge, a chevron that turns from pointing out to pointing back as
     * the drawer opens. {@code pointing} goes from 0, shut, to
     * {@link #GLIDE_STEPS}, open.
     */
    static Object tab(int width, int height, int hoverStep, int pointing) {
        String key = "ab|" + width + "x" + height + "|" + hoverStep + "|" + pointing;
        Object cached = Buttons.cachedPlain(key);
        if (cached != null) return cached;
        int scale = Buttons.supersample();
        float hover = hoverStep / (float) Buttons.HOVER_STEPS;
        float open = pointing / (float) GLIDE_STEPS;
        int w = width * scale;
        int h = height * scale;
        BufferedImage image = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        Buttons.quality(g);
        float radius = 8F * scale * 2F;
        Area shape = new Area(new RoundRectangle2D.Float(-radius, 0, w + radius, h, radius, radius));
        shape.intersect(new Area(new Rectangle2D.Float(0, 0, w, h)));
        g.setColor(new Color(MenuDesign.mix(SHEET, 0xD8303038, hover), true));
        g.fill(shape);
        g.setColor(new Color(0x24FFFFFF, true));
        g.setStroke(new BasicStroke(Math.max(1F, scale * 0.6F)));
        g.draw(shape);
        // The chevron: > shut, < open, flattening through the middle.
        float cx = w * 0.46F;
        float cy = h / 2F;
        float reach = 2.2F * scale * (1F - 2F * open);
        float span = 4F * scale;
        g.setColor(new Color(MenuDesign.mix(SECONDARY, LABEL, hover), true));
        g.setStroke(new BasicStroke(scale * 1.4F, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        java.awt.geom.Path2D.Float chevron = new java.awt.geom.Path2D.Float();
        chevron.moveTo(cx - reach, cy - span);
        chevron.lineTo(cx + reach, cy);
        chevron.lineTo(cx - reach, cy + span);
        g.draw(chevron);
        g.dispose();
        return Buttons.storePlain(key, image);
    }

    /** An accent colour to pick: a disc, ringed when it is the one chosen. */
    static Object swatch(ClientSettings.Accent accent, boolean chosen, int hoverStep, int size) {
        if (accent == ClientSettings.Accent.CUSTOM) return customSwatch(chosen, hoverStep, size);
        String key = "aw|" + accent + "|" + chosen + "|" + hoverStep + "|" + size;
        Object cached = Buttons.cachedPlain(key);
        if (cached != null) return cached;
        int scale = Buttons.supersample();
        float hover = hoverStep / (float) Buttons.HOVER_STEPS;
        int s = size * scale;
        BufferedImage image = new BufferedImage(s, s, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        Buttons.quality(g);
        float ring = 1.3F * scale;
        float inset = chosen ? ring * 2.4F : ring * (1.6F - hover * 0.6F);
        g.setPaint(new GradientPaint(0, 0, new Color(accent.to, true), 0, s, new Color(accent.from, true)));
        g.fill(new Ellipse2D.Float(inset, inset, s - inset * 2F, s - inset * 2F));
        if (chosen) {
            g.setColor(new Color(accent.to, true));
            g.setStroke(new BasicStroke(ring));
            g.draw(new Ellipse2D.Float(ring / 2F, ring / 2F, s - ring, s - ring));
            g.setColor(Color.WHITE);
            float dot = s * 0.2F;
            g.fill(new Ellipse2D.Float((s - dot) / 2F, (s - dot) / 2F, dot, dot));
        }
        g.dispose();
        return Buttons.storePlain(key, image);
    }

    /**
     * The custom colour's swatch: a ring of every hue, which says "any
     * colour", around the colour picked once it is the one in use.
     */
    private static Object customSwatch(boolean chosen, int hoverStep, int size) {
        int picked = ClientSettings.customColour();
        String key = "ax|" + chosen + "|" + hoverStep + "|" + size + "|" + (chosen ? Integer.toHexString(picked) : "");
        Object cached = Buttons.cached(key);
        if (cached != null) return cached;
        int scale = Buttons.supersample();
        float hover = hoverStep / (float) Buttons.HOVER_STEPS;
        int s = size * scale;
        BufferedImage image = new BufferedImage(s, s, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        Buttons.quality(g);
        float ring = 1.3F * scale;
        float inset = chosen ? 0F : ring * (1.6F - hover * 0.6F) - ring;
        // The ring of hues, drawn as thin wedges around the centre.
        int wedges = 72;
        for (int index = 0; index < wedges; index += 1) {
            g.setColor(new Color(Color.HSBtoRGB(index / (float) wedges, 0.75F, 1F)));
            g.fill(new java.awt.geom.Arc2D.Float(inset, inset, s - inset * 2F, s - inset * 2F,
                index * 360F / wedges - 0.5F, 360F / wedges + 1F, java.awt.geom.Arc2D.PIE));
        }
        float hole = chosen ? ring * 2.4F : s * 0.3F;
        g.setColor(new Color(chosen ? 0xFF000000 | picked : CARD, true));
        g.fill(new Ellipse2D.Float(hole, hole, s - hole * 2F, s - hole * 2F));
        if (chosen) {
            g.setColor(Color.WHITE);
            float dot = s * 0.2F;
            g.fill(new Ellipse2D.Float((s - dot) / 2F, (s - dot) / 2F, dot, dot));
        }
        g.dispose();
        return Buttons.store(key, image);
    }

    /**
     * The palette: saturation across, brightness down, at one hue. Painted
     * per hue step, a degree each, so dragging the hue costs a texture a
     * degree and dragging inside the square costs none.
     */
    static Object palette(int width, int height, int hueStep) {
        String key = "ap|" + width + "x" + height + "|" + hueStep;
        Object cached = Buttons.cachedPlain(key);
        if (cached != null) return cached;
        int scale = Buttons.supersample();
        int w = width * scale;
        int h = height * scale;
        BufferedImage image = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        float hue = hueStep / 360F;
        int[] row = new int[w];
        for (int y = 0; y < h; y += 1) {
            float brightness = 1F - y / (float) Math.max(1, h - 1);
            for (int x = 0; x < w; x += 1) {
                row[x] = 0xFF000000 | Color.HSBtoRGB(hue, x / (float) Math.max(1, w - 1), brightness);
            }
            image.setRGB(0, y, w, 1, row, 0, w);
        }
        roundCorners(image, 6F * scale);
        return Buttons.storePlain(key, image);
    }

    /** Every hue, left to right, as a rounded bar. */
    static Object hueStrip(int width, int height) {
        String key = "ah|" + width + "x" + height;
        Object cached = Buttons.cachedPlain(key);
        if (cached != null) return cached;
        int scale = Buttons.supersample();
        int w = width * scale;
        int h = height * scale;
        BufferedImage image = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        int[] row = new int[w];
        for (int x = 0; x < w; x += 1) row[x] = 0xFF000000 | Color.HSBtoRGB(x / (float) Math.max(1, w - 1), 1F, 1F);
        for (int y = 0; y < h; y += 1) image.setRGB(0, y, w, 1, row, 0, w);
        roundCorners(image, h / 2F);
        return Buttons.storePlain(key, image);
    }

    /** Where the pick is: a white ring with a dark edge, readable on any colour. */
    static Object marker(int size) {
        String key = "am|" + size;
        Object cached = Buttons.cachedPlain(key);
        if (cached != null) return cached;
        int scale = Buttons.supersample();
        int s = size * scale;
        BufferedImage image = new BufferedImage(s, s, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        Buttons.quality(g);
        float edge = scale * 0.8F;
        g.setStroke(new BasicStroke(scale * 2.2F));
        g.setColor(new Color(0x80000000, true));
        g.draw(new Ellipse2D.Float(edge * 1.5F, edge * 1.5F, s - edge * 3F, s - edge * 3F));
        g.setStroke(new BasicStroke(scale * 1.4F));
        g.setColor(Color.WHITE);
        g.draw(new Ellipse2D.Float(edge * 1.5F, edge * 1.5F, s - edge * 3F, s - edge * 3F));
        g.dispose();
        return Buttons.storePlain(key, image);
    }

    /** What a library tile says it holds, in its corner. */
    static final int BADGE_NONE = 0;
    static final int BADGE_GIF = 1;
    static final int BADGE_VIDEO = 2;

    /**
     * Over a library tile's thumbnail: a hairline, the accent ring when it is
     * the background shown, a lift under the pointer, and a small badge for a
     * GIF or a video.
     */
    static Object tileFrame(int width, int height, boolean chosen, int hoverStep, int badge) {
        String key = "af|" + width + "x" + height + "|" + chosen + "|" + hoverStep + "|" + badge;
        Object cached = Buttons.cached(key);
        if (cached != null) return cached;
        int scale = Buttons.supersample();
        float hover = hoverStep / (float) Buttons.HOVER_STEPS;
        int w = width * scale;
        int h = height * scale;
        BufferedImage image = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        Buttons.quality(g);
        float radius = 7F * scale;
        if (hover > 0F && !chosen) {
            g.setColor(new Color(Math.round(0x22 * hover) << 24 | 0xFFFFFF, true));
            g.fill(new RoundRectangle2D.Float(0, 0, w, h, radius * 2F, radius * 2F));
        }
        float line = chosen ? 2F * scale : Math.max(1F, scale * 0.6F);
        g.setStroke(new BasicStroke(line));
        g.setColor(new Color(chosen ? 0xFF000000 | ClientSettings.accent().to : 0x2EFFFFFF, true));
        g.draw(new RoundRectangle2D.Float(line / 2F, line / 2F, w - line, h - line, radius * 2F, radius * 2F));
        if (badge != BADGE_NONE) {
            float size = 9F * scale;
            float x = 4F * scale;
            float y = h - size - 4F * scale;
            g.setColor(new Color(0xB0000000, true));
            if (badge == BADGE_GIF) {
                g.fill(new RoundRectangle2D.Float(x, y, size * 2F, size, size * 0.6F, size * 0.6F));
                g.setColor(Color.WHITE);
                g.setFont(Buttons.labelFont(Math.round(6F * scale)));
                FontMetrics metrics = g.getFontMetrics();
                g.drawString("GIF", x + (size * 2F - metrics.stringWidth("GIF")) / 2F, y + (size + metrics.getAscent() * 0.72F) / 2F);
            } else {
                g.fill(new Ellipse2D.Float(x, y, size, size));
                g.setColor(Color.WHITE);
                java.awt.geom.Path2D.Float play = new java.awt.geom.Path2D.Float();
                play.moveTo(x + size * 0.38F, y + size * 0.28F);
                play.lineTo(x + size * 0.74F, y + size * 0.5F);
                play.lineTo(x + size * 0.38F, y + size * 0.72F);
                play.closePath();
                g.fill(play);
            }
        }
        g.dispose();
        return Buttons.store(key, image);
    }

    /** The tile that adds to the library: a dashed outline round a plus. */
    static Object addTile(int width, int height, int hoverStep) {
        String key = "aa|" + width + "x" + height + "|" + hoverStep;
        Object cached = Buttons.cachedPlain(key);
        if (cached != null) return cached;
        int scale = Buttons.supersample();
        float hover = hoverStep / (float) Buttons.HOVER_STEPS;
        int w = width * scale;
        int h = height * scale;
        BufferedImage image = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        Buttons.quality(g);
        float radius = 7F * scale;
        g.setColor(new Color(MenuDesign.mix(0x10FFFFFF, 0x24FFFFFF, hover), true));
        g.fill(new RoundRectangle2D.Float(0, 0, w, h, radius * 2F, radius * 2F));
        float line = Math.max(1F, scale * 0.8F);
        g.setStroke(new BasicStroke(line, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND, 10F,
            new float[] {3F * scale, 3F * scale}, 0F));
        g.setColor(new Color(MenuDesign.mix(0x50FFFFFF, 0x90FFFFFF, hover), true));
        g.draw(new RoundRectangle2D.Float(line / 2F, line / 2F, w - line, h - line, radius * 2F, radius * 2F));
        float arm = Math.min(w, h) * 0.18F;
        g.setStroke(new BasicStroke(scale * 1.6F, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        g.setColor(new Color(MenuDesign.mix(SECONDARY, LABEL, hover), true));
        g.draw(new java.awt.geom.Line2D.Float(w / 2F - arm, h / 2F, w / 2F + arm, h / 2F));
        g.draw(new java.awt.geom.Line2D.Float(w / 2F, h / 2F - arm, w / 2F, h / 2F + arm));
        g.dispose();
        return Buttons.storePlain(key, image);
    }

    /** The small round cross that takes a tile out of the library. */
    static Object removeBadge(int size, int hoverStep) {
        String key = "ar2|" + size + "|" + hoverStep;
        Object cached = Buttons.cachedPlain(key);
        if (cached != null) return cached;
        int scale = Buttons.supersample();
        float hover = hoverStep / (float) Buttons.HOVER_STEPS;
        int s = size * scale;
        BufferedImage image = new BufferedImage(s, s, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        Buttons.quality(g);
        g.setColor(new Color(MenuDesign.mix(0xD0202026, 0xF0E5484D, hover), true));
        g.fill(new Ellipse2D.Float(0, 0, s, s));
        g.setColor(Color.WHITE);
        g.setStroke(new BasicStroke(scale * 1.2F, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
        float a = s * 0.32F;
        float b = s * 0.68F;
        g.draw(new java.awt.geom.Line2D.Float(a, a, b, b));
        g.draw(new java.awt.geom.Line2D.Float(b, a, a, b));
        g.dispose();
        return Buttons.storePlain(key, image);
    }

    private static void roundCorners(BufferedImage image, float radius) {
        BufferedImage mask = new BufferedImage(image.getWidth(), image.getHeight(), BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = mask.createGraphics();
        Buttons.quality(g);
        g.setColor(Color.WHITE);
        g.fill(new RoundRectangle2D.Float(0, 0, image.getWidth(), image.getHeight(), radius * 2F, radius * 2F));
        g.dispose();
        int[] pixels = image.getRGB(0, 0, image.getWidth(), image.getHeight(), null, 0, image.getWidth());
        int[] shape = mask.getRGB(0, 0, image.getWidth(), image.getHeight(), null, 0, image.getWidth());
        for (int index = 0; index < pixels.length; index += 1) {
            int alpha = ((pixels[index] >>> 24) * (shape[index] >>> 24)) / 255;
            pixels[index] = (alpha << 24) | (pixels[index] & 0xFFFFFF);
        }
        image.setRGB(0, 0, image.getWidth(), image.getHeight(), pixels, 0, image.getWidth());
    }

    private static void fadeAlpha(BufferedImage image, float alpha) {
        int[] pixels = image.getRGB(0, 0, image.getWidth(), image.getHeight(), null, 0, image.getWidth());
        for (int index = 0; index < pixels.length; index += 1) {
            int pixel = pixels[index];
            pixels[index] = (Math.round((pixel >>> 24) * alpha) << 24) | (pixel & 0xFFFFFF);
        }
        image.setRGB(0, 0, image.getWidth(), image.getHeight(), pixels, 0, image.getWidth());
    }
}
