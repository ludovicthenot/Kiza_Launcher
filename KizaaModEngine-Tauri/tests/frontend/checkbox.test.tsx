import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Checkbox } from "../../src/components/ui/checkbox";

describe("Checkbox", () => {
  it("keeps native checkbox semantics so labels and keyboards still work", () => {
    const onChange = vi.fn();
    render(
      <label>
        Show the Minecraft version
        <Checkbox checked={false} onChange={onChange} />
      </label>,
    );

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    // Clicking the label must toggle it: that only holds if the styled box is
    // still driven by a real <input type="checkbox">.
    fireEvent.click(screen.getByText("Show the Minecraft version"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("does not paint itself with the system accent colour", () => {
    render(<Checkbox checked readOnly />);

    const checkbox = screen.getByRole("checkbox");
    // The native control is transparent; the visible box is ours to style.
    expect(checkbox.className).toContain("opacity-0");
    expect(checkbox.className).not.toContain("accent-");
  });

  it("stays usable when disabled", () => {
    render(<Checkbox checked disabled readOnly />);

    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  });
});
