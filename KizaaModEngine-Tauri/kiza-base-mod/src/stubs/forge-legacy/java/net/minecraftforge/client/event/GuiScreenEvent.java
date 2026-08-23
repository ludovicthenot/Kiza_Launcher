package net.minecraftforge.client.event;

/**
 * Compile-only stub. Only the class names matter: the listener parameter type
 * has to have the exact runtime descriptor, so the annotation-driven event bus
 * matches it. Everything read off the event is pulled reflectively, so no
 * method signature here is relied upon.
 */
public class GuiScreenEvent {
    public static class DrawScreenEvent extends GuiScreenEvent {
        public static class Post extends DrawScreenEvent {}
    }

    public static class BackgroundDrawnEvent extends GuiScreenEvent {}
}
