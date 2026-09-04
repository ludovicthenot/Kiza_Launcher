package fr.kiza.basemod;

import java.lang.reflect.Method;

public final class MenuLogoRendererTest {
    private MenuLogoRendererTest() {}

    public static void main(String[] args) throws Exception {
        // Texture and fill resolution now lives in GuiDispatch, which covers
        // both GUI generations; see GuiDispatchTest.
        assert MenuLogoRenderer.findStringDrawMethod(FakeGraphics.class)
            .getName()
            .equals("drawString");

        // Screen height is read by field name, walking up the class hierarchy.
        assert MenuLogoRenderer.screenHeight(new FakeScreen()) == 480;
        assert MenuLogoRenderer.screenHeight(new FakeInventoryScreen()) == 300;
        assert MenuLogoRenderer.screenHeight(null) == 0;

        TitleMenuController.Layout legacyLayout = TitleMenuController.capture(
            new FakeLegacyScreen(),
            480
        );
        assert legacyLayout.supported();

        theRowsArePushedApartAndStayPut();

        theWordmarkKeepsItsProportions();
        aLabelIsCentredAgainstTheHeightItIsDrawnAt();
        aHiddenButtonIsNotPainted();
        aButtonLyingAcrossAnotherIsDropped();
        aLabelIsTrimmedToItsButton();

        String previousClientVersion = System.getProperty("kiza.client.version");
        String previousMinecraftVersion = System.getProperty("kiza.minecraft.version");
        try {
            System.setProperty("kiza.client.version", "0.0.245");
            System.setProperty("kiza.minecraft.version", "1.21.11");
            ClientIdentity identity = ClientIdentity.fromSystemProperties();
            assert identity.windowTitle().equals("Minecraft by Kiza");
            assert identity.footerLabel().equals("Kiza Launcher v0.0.245");

            System.setProperty("kiza.client.version", "../invalid");
            assert ClientIdentity.fromSystemProperties().clientVersion().equals("dev");
        } finally {
            restoreProperty("kiza.client.version", previousClientVersion);
            restoreProperty("kiza.minecraft.version", previousMinecraftVersion);
        }
    }

    /**
     * The wordmark is 256x44 units on 1.20 and later, and two halves of 155x44
     * before that. The renderer used to declare the modern sheet as 44 units
     * tall when it is 64, so the vertical coordinate ran over the empty space
     * below the wordmark and squashed it: 256 wide against 30 tall instead of
     * 44, an aspect of 8.46 where Mojang's own file measures 5.82.
     */
    private static void theWordmarkKeepsItsProportions() {
        assert MenuLogoRenderer.logoWidthFor(44, true) == 256;
        assert MenuLogoRenderer.logoWidthFor(22, true) == 128;
        assert MenuLogoRenderer.logoWidthFor(44, false) == 310;

        assert MenuLogoRenderer.versionIsBefore("1.19.4", 1, 20);
        assert !MenuLogoRenderer.versionIsBefore("1.20", 1, 20);
        assert !MenuLogoRenderer.versionIsBefore("1.21.11", 1, 20);
        assert MenuLogoRenderer.versionIsBefore("1.8.9", 1, 20);
        // Unreadable means current: the layout every supported version has had
        // for years, rather than the one none of them still use.
        assert !MenuLogoRenderer.versionIsBefore("snapshot", 1, 20);
    }

    /**
     * Centring needs the height the renderer will actually use.
     *
     * `textHeight()` is vanilla's line height and the TrueType renderer draws a
     * texture measured from the font's own bounds, which at this size is around
     * twelve pixels rather than eight. Centring against the constant put every
     * button label low by a couple of pixels.
     *
     * No font is loaded in a test, so both answers are the fallback here; what
     * this pins is that the label is asked about at all, and that an empty or
     * absent one still has a height to be centred against.
     */
    private static void aLabelIsCentredAgainstTheHeightItIsDrawnAt() {
        assert MenuLogoRenderer.textHeight("Singleplayer") > 0;
        assert MenuLogoRenderer.textHeight("") == MenuLogoRenderer.textHeight();
        assert MenuLogoRenderer.textHeight(null) == MenuLogoRenderer.textHeight();
    }

    /**
     * A screen keeps widgets it is not drawing. Kiza paints an opaque surface
     * per widget, so a hidden button came back as a solid panel lying across
     * the buttons beside it — which is how "Mods" ended up underneath
     * "Report Bugs" in the pause menu.
     */
    private static void aHiddenButtonIsNotPainted() {
        FakeScreenWithWidgets screen = new FakeScreenWithWidgets(
            new FakeWidget(220, 160, 200, 20, "Back to Game", true),
            new FakeWidget(220, 184, 200, 20, "Feedback", false)
        );
        TitleMenuController.Layout layout = TitleMenuController.capture(screen, 480);

        assert layout.buttons().size() == 1 : layout.buttons().size();
        assert layout.buttons().get(0).label().equals("Back to Game");
    }

    private static void aButtonLyingAcrossAnotherIsDropped() {
        FakeScreenWithWidgets screen = new FakeScreenWithWidgets(
            new FakeWidget(120, 184, 400, 20, "Mods", true),
            new FakeWidget(324, 184, 196, 20, "Report Bugs", true),
            new FakeWidget(120, 160, 200, 20, "Advancements", true)
        );
        TitleMenuController.Layout layout = TitleMenuController.capture(screen, 480);

        assert layout.buttons().size() == 2 : layout.buttons().size();
        assert layout.buttons().get(0).label().equals("Report Bugs");
        assert layout.buttons().get(1).label().equals("Advancements");
    }

    private static void aLabelIsTrimmedToItsButton() {
        // Six pixels per character is the fallback metric the renderer uses
        // when no font is loaded, which is the case here.
        assert TitleMenuController.fitted("Mods", 200).equals("Mods");
        String trimmed = TitleMenuController.fitted("Report Bugs and Feedback", 60);
        assert trimmed.endsWith("...") : trimmed;
        assert MenuLogoRenderer.textWidth(trimmed) <= 60 : trimmed;
        assert TitleMenuController.fitted("Anything", 4).isEmpty();
    }

    public static final class FakeScreenWithWidgets {
        private final java.util.List<FakeWidget> widgets;

        FakeScreenWithWidgets(FakeWidget... widgets) {
            this.widgets = java.util.Arrays.asList(widgets);
        }

        public java.util.List<FakeWidget> children() {
            return widgets;
        }
    }

    public static final class FakeWidget {
        public int x;
        public int y;
        public int width;
        public int height;
        public boolean visible;
        public String displayString;

        FakeWidget(int x, int y, int width, int height, String label, boolean visible) {
            this.x = x;
            this.y = y;
            this.width = width;
            this.height = height;
            this.displayString = label;
            this.visible = visible;
        }
    }

    public static class FakeScreen {
        public int width = 640;
        public int height = 480;
        public FakeFont font = new FakeFont();
    }

    public static final class FakeInventoryScreen extends FakeScreen {
        {
            height = 300;
        }
    }

    /**
     * The rows are pushed apart, the block does not wander, and running it
     * again changes nothing.
     *
     * <p>That last part is the one worth a test. This runs on every frame, so
     * an implementation that added a little space each time would look right in
     * a screenshot and walk the menu off the screen over a few seconds. It is
     * idempotent by construction -- each gap becomes ROW_GAP plus however much
     * it already exceeded the smallest gap, and the block is re-centred where
     * it was -- and this is the check that it stays that way.
     */
    private static void theRowsArePushedApartAndStayPut() {
        FakeLegacyScreen screen = new FakeLegacyScreen();
        int centreBefore = middleOf(screen);
        int gapBefore = gapIn(screen);

        TitleMenuController.capture(screen, 480);
        int gapAfter = gapIn(screen);
        assert gapAfter > gapBefore : "expected more room, got " + gapAfter;
        assert Math.abs(middleOf(screen) - centreBefore) <= 1
            : "the block moved to " + middleOf(screen) + " from " + centreBefore;

        int[] settled = positionsOf(screen);
        for (int again = 0; again < 5; again += 1) {
            TitleMenuController.capture(screen, 480);
        }
        int[] later = positionsOf(screen);
        for (int index = 0; index < settled.length; index += 1) {
            assert settled[index] == later[index]
                : "button " + index + " drifted from " + settled[index] + " to " + later[index];
        }

        // A window too short for the wider spacing keeps vanilla's, because a
        // menu that no longer fits is a menu somebody cannot use.
        FakeLegacyScreen cramped = new FakeLegacyScreen();
        int[] untouched = positionsOf(cramped);
        TitleMenuController.capture(cramped, 60);
        int[] after = positionsOf(cramped);
        for (int index = 0; index < untouched.length; index += 1) {
            assert untouched[index] == after[index] : "a cramped menu was moved anyway";
        }
    }

    private static int[] positionsOf(FakeLegacyScreen screen) {
        int[] found = new int[screen.buttonList.size()];
        for (int index = 0; index < found.length; index += 1) {
            found[index] = screen.buttonList.get(index).yPosition;
        }
        return found;
    }

    private static int gapIn(FakeLegacyScreen screen) {
        FakeLegacyButton first = screen.buttonList.get(0);
        return screen.buttonList.get(1).yPosition - (first.yPosition + first.height);
    }

    private static int middleOf(FakeLegacyScreen screen) {
        FakeLegacyButton first = screen.buttonList.get(0);
        FakeLegacyButton last = screen.buttonList.get(screen.buttonList.size() - 1);
        return (first.yPosition + last.yPosition + last.height) / 2;
    }

    public static final class FakeLegacyScreen {
        public java.util.List<FakeLegacyButton> buttonList = java.util.Arrays.asList(
            new FakeLegacyButton(220, 160, 200, 20, "Singleplayer"),
            new FakeLegacyButton(220, 184, 200, 20, "Multiplayer")
        );
    }

    public static final class FakeLegacyButton {
        public int xPosition;
        public int yPosition;
        public int width;
        public int height;
        public String displayString;

        FakeLegacyButton(int x, int y, int width, int height, String label) {
            this.xPosition = x;
            this.yPosition = y;
            this.width = width;
            this.height = height;
            this.displayString = label;
        }
    }

    public static final class FakeIdentifier {}
    public static final class FakePipeline {}
    public static final class FakeFont {}

    public static final class FakeGraphics {
        public void drawTexture(
            FakeIdentifier identifier,
            int x,
            int y,
            int width,
            int height,
            float u,
            float v,
            int regionWidth,
            int regionHeight,
            int textureWidth,
            int textureHeight
        ) {}

        public void fill(int left, int top, int right, int bottom, int color) {}

        public int drawString(
            FakeFont font,
            String text,
            int x,
            int y,
            int color,
            boolean shadow
        ) {
            return text.length();
        }
    }

    public static final class UnsupportedGraphics {
        public void drawTexture(FakeIdentifier identifier, int x, int y) {}
    }

    public static final class FakeModernGraphics {
        public void drawTexture(
            com.mojang.blaze3d.pipeline.RenderPipeline pipeline,
            FakeIdentifier identifier,
            int x,
            int y,
            float u,
            float v,
            int width,
            int height,
            int regionWidth,
            int regionHeight,
            int textureWidth,
            int textureHeight,
            int color
        ) {}
    }

    private static void restoreProperty(String name, String value) {
        if (value == null) System.clearProperty(name);
        else System.setProperty(name, value);
    }
}
