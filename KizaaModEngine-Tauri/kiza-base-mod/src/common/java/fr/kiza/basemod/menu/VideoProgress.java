package fr.kiza.basemod.menu;

/** How far preparing a video has gone, and whether it should go on. */
public interface VideoProgress {
    boolean running();

    /** From 0 to 1. */
    void progress(float done);
}
