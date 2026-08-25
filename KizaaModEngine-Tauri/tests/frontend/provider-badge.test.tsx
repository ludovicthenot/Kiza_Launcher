import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ProviderBadge,
  providerLabel,
  providerOf,
} from "../../src/components/common/ProviderBadge";

/**
 * The badge that says where a mod came from.
 *
 * What is worth pinning down here is not that it renders — it is that the two
 * services stay visually distinct, that each one keeps its own colour, and that
 * the mark survives being drawn. A badge whose CurseForge chip is violet is
 * technically working and useless in a list of twenty-five mods.
 */
describe("providerOf", () => {
  it("recognises the strings the backend actually stores", () => {
    expect(providerOf("modrinth")).toBe("modrinth");
    expect(providerOf("Modrinth")).toBe("modrinth");
    expect(providerOf("curseforge")).toBe("curseforge");
    expect(providerOf("CurseForge")).toBe("curseforge");
    // Written by an older version of the mod manager.
    expect(providerOf("curse_forge")).toBe("curseforge");
  });

  it("claims nothing about a source it does not know", () => {
    // A mod dropped in from a file has no catalogue behind it, and inventing
    // one would be a badge that lies about provenance.
    expect(providerOf("local file")).toBeNull();
    expect(providerOf(null)).toBeNull();
    expect(providerOf(undefined)).toBeNull();
    expect(providerOf("")).toBeNull();
  });

  it("names the services the way the services do", () => {
    expect(providerLabel("modrinth")).toBe("Modrinth");
    expect(providerLabel("curseforge")).toBe("CurseForge");
  });
});

describe("ProviderBadge", () => {
  it("draws the logo, not only the name", () => {
    const { container } = render(<ProviderBadge provider="curseforge" />);
    const path = container.querySelector("svg path");
    expect(path).not.toBeNull();
    expect(path?.getAttribute("d")?.length ?? 0).toBeGreaterThan(50);
  });

  it("gives each service its own colour", () => {
    const { container: forge } = render(<ProviderBadge provider="curseforge" />);
    const { container: modrinth } = render(<ProviderBadge provider="modrinth" />);

    const forgeClass = forge.firstElementChild?.className ?? "";
    const modrinthClass = modrinth.firstElementChild?.className ?? "";

    // Orange and green, and above all not each other's: the badges used to be
    // emerald and violet, which put CurseForge in Modrinth's colour family.
    expect(forgeClass).toContain("#e04e14");
    expect(modrinthClass).toContain("#0b7a44");
    expect(forgeClass).not.toBe(modrinthClass);
  });

  it("fills the chip so the mark reads on a dark list", () => {
    const { container } = render(<ProviderBadge provider="modrinth" />);
    const className = container.firstElementChild?.className ?? "";
    // A solid background rather than a 10%-opacity tint. At badge size a
    // tinted logo is a smudge, which defeats the point of using a logo.
    expect(className).toContain("bg-[#0b7a44]");
    expect(className).not.toContain("/10");
  });

  it("keeps the service reachable by name when the label is hidden", () => {
    render(<ProviderBadge provider="curseforge" showLabel={false} />);
    // A logo alone is invisible to a screen reader and to anyone who does not
    // recognise an anvil.
    expect(screen.getByText("CurseForge")).toBeTruthy();
  });

  it("offers a quieter variant for a panel already about one thing", () => {
    const { container } = render(<ProviderBadge provider="curseforge" variant="subtle" />);
    expect(container.firstElementChild?.className ?? "").toContain("#f16436]/10");
  });
});
