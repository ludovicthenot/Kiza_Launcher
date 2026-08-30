package fr.kiza.basemod;

import java.util.concurrent.CopyOnWriteArrayList;

final class ClientEventBus {
    interface Listener {
        void onEvent(ClientEvent event);
    }

    private final CopyOnWriteArrayList<Listener> listeners = new CopyOnWriteArrayList<Listener>();

    void subscribe(Listener listener) {
        if (listener != null) listeners.addIfAbsent(listener);
    }

    void publish(ClientEvent event) {
        for (Listener listener : listeners) {
            try {
                listener.onEvent(event);
            } catch (VirtualMachineError fatal) {
                throw fatal;
            } catch (Throwable failed) {
                // Same reason the runtime catches Throwable: across four loader
                // generations a listener fails by not linking, not by throwing.
                System.err.println(
                    "[Kiza Launcher] A client event listener failed: "
                        + failed.getClass().getSimpleName()
                );
            }
        }
    }
}
