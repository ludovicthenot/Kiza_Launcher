package fr.kiza.basemod;

import java.io.InputStream;

/**
 * The menu background measures itself.
 *
 * <p>Its size used to be two constants written next to the path, and the crop
 * that fits it to the window is arithmetic on them. Replacing the PNG with one
 * of a different size left the maths describing the old file: nothing threw,
 * nothing logged, the picture just came out cropped wrong. This is the check
 * that the reader and the file still agree, and it fails the moment somebody
 * drops in a new background the reader cannot make sense of.
 */
public final class MenuBackgroundTest {
    private MenuBackgroundTest() {}

    public static void main(String[] arguments) throws Exception {
        int[] measured = MenuLogoRenderer.measuredBackground();
        assert measured != null : "the background should be readable from the classpath";
        assert measured[0] > 0 && measured[1] > 0
            : "read " + measured[0] + "x" + measured[1];

        // Cross-checked against the bytes, read here a different way, so the
        // test is not simply the implementation agreeing with itself.
        try (InputStream input = MenuLogoRenderer.class.getResourceAsStream(
            "/assets/kiza_base_mod/textures/gui/kiza_menu_background.png"
        )) {
            assert input != null : "the background resource should ship in the jar";
            byte[] header = new byte[24];
            int read = 0;
            while (read < header.length) {
                int step = input.read(header, read, header.length - read);
                if (step < 0) break;
                read += step;
            }
            assert read == header.length : "a PNG has at least 24 bytes";
            // The signature, so a JPEG renamed to .png fails here rather than
            // being measured as nonsense.
            assert (header[0] & 0xFF) == 0x89 && header[1] == 'P'
                && header[2] == 'N' && header[3] == 'G'
                : "the background must actually be a PNG";

            int width = ((header[16] & 0xFF) << 24) | ((header[17] & 0xFF) << 16)
                | ((header[18] & 0xFF) << 8) | (header[19] & 0xFF);
            int height = ((header[20] & 0xFF) << 24) | ((header[21] & 0xFF) << 16)
                | ((header[22] & 0xFF) << 8) | (header[23] & 0xFF);
            assert measured[0] == width && measured[1] == height
                : "reader says " + measured[0] + "x" + measured[1]
                    + ", file says " + width + "x" + height;
        }

        System.out.println(
            "Kiza menu background tests passed (" + measured[0] + "x" + measured[1] + ")"
        );
    }
}
