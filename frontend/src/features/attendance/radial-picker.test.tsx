import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RadialPicker } from "./radial-picker";

describe("RadialPicker", () => {
  it("picks a status by click and by keyboard shortcut", async () => {
    const onPick = vi.fn();
    render(<RadialPicker current="P" allowed={() => true} onPick={onPick} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("menuitem", { name: /Absent/ }));
    expect(onPick).toHaveBeenLastCalledWith("A");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "d" });
    expect(onPick).toHaveBeenLastCalledWith("HD");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Delete" });
    expect(onPick).toHaveBeenLastCalledWith(null);
  });
  it("disables statuses that are not allowed (e.g. Present on a future day)", () => {
    const onPick = vi.fn();
    render(<RadialPicker current={null} allowed={(c) => c === "L"} onPick={onPick} onClose={() => {}} />);
    expect(screen.getByRole("menuitem", { name: /Present/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /Leave/ })).toBeEnabled();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "p" });
    expect(onPick).not.toHaveBeenCalled();
  });
});
