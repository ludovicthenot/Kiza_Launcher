package fr.kiza.basemod;

import java.util.List;
import java.util.Set;

interface ClientModule {
    String id();

    String name();

    List<String> dependencies();

    Set<String> capabilities();

    boolean required();

    void start(ClientRuntimeContext context);
}
