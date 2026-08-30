package fr.kiza.basemod;

final class ClientEvent {
    enum Type {
        RUNTIME_STARTING,
        MODULE_READY,
        MODULE_DISABLED,
        MODULE_FAILED,
        RUNTIME_READY
    }

    private final Type type;
    private final String moduleId;
    private final String message;
    private final long createdAtMs;

    ClientEvent(Type type, String moduleId, String message) {
        this.type = type;
        this.moduleId = moduleId;
        this.message = message;
        this.createdAtMs = System.currentTimeMillis();
    }

    Type type() {
        return type;
    }

    String moduleId() {
        return moduleId;
    }

    String message() {
        return message;
    }

    long createdAtMs() {
        return createdAtMs;
    }
}
