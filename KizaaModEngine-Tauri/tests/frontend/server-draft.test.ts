import { describe, expect, it } from "vitest";
import { EMPTY_DRAFT, applyPreset, draftProperties, draftToRequest } from "../../src/lib/serverDraft";
import { presetById } from "../../src/lib/serverPresets";

describe("the creator's draft", () => {
  it("becomes the server.properties the first start will read", () => {
    const properties = draftProperties({ ...EMPTY_DRAFT, seed: " kiza ", description: "Bienvenue", difficulty: "hard", hardcore: true });
    expect(properties["level-seed"]).toBe("kiza");
    expect(properties.motd).toBe("Bienvenue");
    expect(properties.difficulty).toBe("hard");
    expect(properties.hardcore).toBe("true");
    // An empty seed is not a key: the server would read it as the literal "".
    expect(draftProperties(EMPTY_DRAFT)["level-seed"]).toBeUndefined();
  });

  it("carries no loader version for vanilla and splits the JVM arguments", () => {
    const request = draftToRequest({ ...EMPTY_DRAFT, name: " Survie ", version: "1.21.1", loaderVersion: "junk", jvmArgs: " -XX:+UseG1GC   -Dfoo=bar " });
    expect(request.name).toBe("Survie");
    expect(request.loader_version).toBeNull();
    expect(request.jvm_args).toEqual(["-XX:+UseG1GC", "-Dfoo=bar"]);
    const fabric = draftToRequest({ ...EMPTY_DRAFT, loader: "fabric", loaderVersion: "0.16.9" });
    expect(fabric.loader_version).toBe("0.16.9");
  });

  it("takes a preset's loader and memory and leaves the name alone", () => {
    const modded = presetById("modded")!;
    const draft = applyPreset({ ...EMPTY_DRAFT, name: "Mine" }, modded);
    expect(draft.loader).toBe("neoforge");
    expect(draft.maxMemoryMb).toBe(modded.maxMemoryMb);
    expect(draft.presetId).toBe("modded");
    expect(draft.name).toBe("Mine");
    expect(applyPreset(EMPTY_DRAFT, presetById("community")!).whitelist).toBe(true);
  });
});
