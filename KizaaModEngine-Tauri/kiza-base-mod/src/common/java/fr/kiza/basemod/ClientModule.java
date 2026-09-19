package fr.kiza.basemod;

import java.util.List;
import java.util.Set;

interface ClientModule {
    String id();

    String name();

    List<String> dependencies();

    Set<String> capabilities();

    boolean required();

    /**
     * The mod this module leaves its whole job to, or {@code null}. A module
     * that yields is not started and not failed: the job is being done, by
     * somebody the pack chose.
     */
    default String yieldedTo() {
        return null;
    }

    void start(ClientRuntimeContext context);
}
