import { render, screen } from "@testing-library/react";
import { StatusBadge, StatusLegend } from "./status-badge";

describe("StatusBadge", () => {
  it("never relies on colour alone: renders the code and an accessible label", () => {
    render(<StatusBadge code="HD" />);
    expect(screen.getByText("HD")).toBeInTheDocument();
    expect(screen.getByText("Half-day")).toHaveClass("sr-only");
  });
  it("can show the full label", () => {
    render(<StatusBadge code="WFH" showLabel />);
    expect(screen.getByText("Work from home")).toBeVisible();
  });
  it("renders a dash for unknown codes", () => {
    render(<StatusBadge code={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
  it("legend lists every code with its meaning", () => {
    render(<StatusLegend codes={["P", "A", "L"]} />);
    expect(screen.getByRole("list", { name: "Status legend" }).children).toHaveLength(3);
    expect(screen.getByText("Leave")).toBeInTheDocument();
  });
});
