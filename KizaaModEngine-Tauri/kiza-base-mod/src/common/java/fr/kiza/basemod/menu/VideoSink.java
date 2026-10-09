package fr.kiza.basemod.menu;

import java.awt.image.BufferedImage;

/** Where a decoded video's frames go, and whether it should keep going. */
public interface VideoSink {
    boolean running();

    void show(BufferedImage frame) throws Exception;
}
