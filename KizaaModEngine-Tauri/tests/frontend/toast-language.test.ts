import { afterEach, describe, expect, it } from "vitest";
import { translateMessage } from "../../src/lib/toast";

describe("toasts in the launcher's language", () => {
  afterEach(() => localStorage.removeItem("kiza.language"));

  it("leaves English alone", () => {
    expect(translateMessage("Modpack instance created")).toBe("Modpack instance created");
  });

  it("translates a whole message", () => {
    localStorage.setItem("kiza.language", "fr");
    expect(translateMessage("Modpack instance created")).toBe("Instance du modpack créée");
  });

  it("keeps the value a template carries", () => {
    localStorage.setItem("kiza.language", "fr");
    expect(translateMessage("Installed sodium-0.6.jar")).toBe("sodium-0.6.jar installé");
    expect(translateMessage("Minecraft launched (PID 4242)")).toBe("Minecraft lancé (PID 4242)");
  });

  it("translates the label and keeps the error after it", () => {
    localStorage.setItem("kiza.language", "fr");
    expect(translateMessage("Install failed: the file is locked")).toBe("Échec de l’installation : the file is locked");
  });

  it("says what it cannot translate as it came", () => {
    localStorage.setItem("kiza.language", "fr");
    expect(translateMessage("Something nobody wrote down")).toBe("Something nobody wrote down");
  });
});
