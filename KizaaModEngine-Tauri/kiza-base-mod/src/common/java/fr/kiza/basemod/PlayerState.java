package fr.kiza.basemod;

enum PlayerState {
    MENU("menu"),
    SURVIVAL("survival"),
    CREATIVE("creative"),
    MULTIPLAYER("multiplayer"),
    UNSUPPORTED("unsupported");

    private final String wireName;

    PlayerState(String wireName) {
        this.wireName = wireName;
    }

    String wireName() {
        return wireName;
    }
}

