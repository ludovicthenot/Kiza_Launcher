import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, EmptyState, Input, Panel } from "../../src/components/ui/primitives";

describe("ui primitives", () => {
  it("renders accessible buttons without clipping labels", () => {
    render(<Button variant="primary">Play</Button>);

    const button = screen.getByRole("button", { name: "Play" });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass("h-10");
  });

  it("keeps form controls and panels composable", () => {
    render(
      <Panel>
        <label htmlFor="search">Search</label>
        <Input id="search" placeholder="Rechercher un mod" />
      </Panel>,
    );

    expect(screen.getByLabelText("Search")).toHaveAttribute("placeholder", "Rechercher un mod");
  });

  it("shows empty states with a useful title and description", () => {
    render(<EmptyState title="Aucun résultat" description="Essaie un autre terme." />);

    expect(screen.getByText("Aucun résultat")).toBeInTheDocument();
    expect(screen.getByText("Essaie un autre terme.")).toBeInTheDocument();
  });
});
