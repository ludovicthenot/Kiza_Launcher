import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DismissibleNotice } from "../../src/components/ui/dismissible-notice";
import { I18nProvider } from "../../src/lib/i18n";

function renderNotice(signature: string, label = "Compatibility report") {
  return render(
    <I18nProvider>
      <DismissibleNotice signature={signature}>
        <span>{label}</span>
      </DismissibleNotice>
    </I18nProvider>,
  );
}

describe("DismissibleNotice", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows its content until the user closes it", () => {
    renderNotice("compat-ok:a1:1.8.9:4");
    expect(screen.getByText("Compatibility report")).toBeTruthy();

    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("Compatibility report")).toBeNull();
  });

  it("stays closed when the same notice is shown again", () => {
    const signature = "compat-ok:a1:1.8.9:4";
    const first = renderNotice(signature);
    fireEvent.click(screen.getByRole("button"));
    first.unmount();

    renderNotice(signature);
    expect(screen.queryByText("Compatibility report")).toBeNull();
  });

  it("comes back when the underlying situation changes", () => {
    // Dismissing "4 mods are compatible" must not hide a later, different
    // report — otherwise the user would silently miss new problems.
    const first = renderNotice("compat-ok:a1:1.8.9:4");
    fireEvent.click(screen.getByRole("button"));
    first.unmount();

    renderNotice("compat-issues:a1:1.8.9:optifine.jar#1", "New problem found");
    expect(screen.getByText("New problem found")).toBeTruthy();
  });

  it("keeps notices separate per instance", () => {
    const first = renderNotice("compat-ok:a1:1.8.9:4");
    fireEvent.click(screen.getByRole("button"));
    first.unmount();

    renderNotice("compat-ok:a2:1.8.9:4", "Other instance");
    expect(screen.getByText("Other instance")).toBeTruthy();
  });
});
