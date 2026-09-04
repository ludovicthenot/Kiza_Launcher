package fr.kiza.basemod.hud;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * One panel of the HUD, as content rather than as pixels.
 *
 * <p>Every panel on that kind of HUD turns out to be the same shape: an
 * optional title, then rows of a label with a value after it. Coordinates are
 * "X 113" and "Y 235"; effects are "Strength II" and "1:07"; the watermark is a
 * title with nothing under it. Writing one panel that does all of them, instead
 * of four panels that each know how to draw themselves, is what keeps the HUD
 * looking like one thing — and it means the layout can measure a card without
 * anything from Minecraft being on screen.
 *
 * <p>A row's value may be null, in which case the label runs the full width.
 *
 * <p>Java 8 syntax: this compiles into the legacy jar as well as the modern one.
 */
public final class HudCard {
    /** A label with an optional value set against the right edge. */
    public static final class Row {
        private final String label;
        private final String value;
        private final int valueColor;

        Row(String label, String value, int valueColor) {
            this.label = label;
            this.value = value;
            this.valueColor = valueColor;
        }

        public String label() {
            return label;
        }

        /** Null when this row is one run of text rather than a pair. */
        public String value() {
            return value;
        }

        public int valueColor() {
            return valueColor;
        }
    }

    private final String id;
    private final HudCorner corner;
    private final String title;
    private final List<Row> rows;
    private final boolean accented;

    private HudCard(String id, HudCorner corner, String title, List<Row> rows, boolean accented) {
        this.id = id;
        this.corner = corner;
        this.title = title;
        this.rows = Collections.unmodifiableList(rows);
        this.accented = accented;
    }

    public static Builder at(String id, HudCorner corner) {
        return new Builder(id, corner);
    }

    public String id() {
        return id;
    }

    public HudCorner corner() {
        return corner;
    }

    /** Null when the card is rows only. */
    public String title() {
        return title;
    }

    public List<Row> rows() {
        return rows;
    }

    /** Whether the rim is drawn in the accent rather than plain white. */
    public boolean accented() {
        return accented;
    }

    public boolean isEmpty() {
        return title == null && rows.isEmpty();
    }

    /**
     * How wide the card's content is, given something that can measure text.
     *
     * <p>The measurer is passed in rather than reached for, because the same
     * arithmetic has to run against Minecraft's font in the game and against
     * Java2D's in the preview, and neither one belongs in here.
     */
    public int contentWidth(Measurer measurer) {
        int widest = title == null ? 0 : measurer.width(title, HudTheme.TITLE_SIZE);
        for (Row row : rows) {
            int width = measurer.width(row.label(), HudTheme.TEXT_SIZE);
            if (row.value() != null) {
                // The gap between a label and its value is the space that keeps
                // "Strength II" and "1:07" from touching on the longest row.
                width += HudTheme.PADDING_X * 2 + measurer.width(row.value(), HudTheme.TEXT_SIZE);
            }
            if (width > widest) widest = width;
        }
        return widest;
    }

    /** How tall the card's content is. */
    public int contentHeight() {
        int height = title == null ? 0 : HudTheme.ROW_HEIGHT + 1;
        height += rows.size() * HudTheme.ROW_HEIGHT;
        return height;
    }

    /** Anything that can say how wide a string will be at a size. */
    public interface Measurer {
        int width(String text, int sizePx);
    }

    public static final class Builder {
        private final String id;
        private final HudCorner corner;
        private final List<Row> rows = new ArrayList<Row>();
        private String title;
        private boolean accented;

        private Builder(String id, HudCorner corner) {
            this.id = id;
            this.corner = corner;
        }

        public Builder title(String value) {
            this.title = value == null || value.trim().isEmpty() ? null : value.trim();
            return this;
        }

        public Builder accented(boolean value) {
            this.accented = value;
            return this;
        }

        /** A row of plain text with no value against the right edge. */
        public Builder line(String label) {
            return row(label, null, HudTheme.TEXT_VALUE);
        }

        public Builder row(String label, String value) {
            return row(label, value, HudTheme.TEXT_VALUE);
        }

        public Builder row(String label, String value, int valueColor) {
            if (label == null || label.trim().isEmpty()) return this;
            String cleaned = value == null || value.trim().isEmpty() ? null : value.trim();
            rows.add(new Row(label.trim(), cleaned, valueColor));
            return this;
        }

        public HudCard build() {
            return new HudCard(id, corner, title, rows, accented);
        }
    }
}
