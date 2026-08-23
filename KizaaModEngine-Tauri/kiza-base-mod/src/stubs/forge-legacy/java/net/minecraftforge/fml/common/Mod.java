package net.minecraftforge.fml.common;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Compile-only stub for the pre-1.13 annotation, which takes named elements
 * instead of the single value() the modern one uses. Forge supplies the real
 * annotation at runtime; build.mjs strips this from the jar.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface Mod {
    String modid();

    String name() default "";

    String version() default "";

    boolean clientSideOnly() default false;

    String acceptedMinecraftVersions() default "";
}
