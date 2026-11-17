import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/misc";
import { AttendanceGrid } from "./attendance-grid";
import type { Grid } from "@/lib/types";

function makeGrid(): Grid {
  // 20 Oct (Tue) .. 26 Oct (Mon); 25 Oct is a Sunday
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 20 + i));
    const iso = d.toISOString().slice(0, 10);
    return { date: iso, weekday: (d.getUTCDay() + 6) % 7, is_holiday: false, holiday_name: null,
      is_today: i === 2, is_future: i > 2 };
  });
  const cell = (s: string | null, auto = false) => ({ s, auto, src: auto ? null : "manual", late: false, note: null });
  const emp = (id: number, name: string, cells: ReturnType<typeof cell>[]) => ({
    id, code: `E${id}`, full_name: name, photo_url: null, department: "Eng", department_id: 1,
    employment_type: "permanent", status: "active", date_of_joining: "2024-01-01", exit_date: null, cells });
  const row = () => days.map((d) => (d.weekday === 6 ? cell("WO", true) : cell(null, true)));
  const r1 = row(); r1[0] = cell("P");
  const r2 = row(); r2[0] = cell("NJ", true);
  return {
    cycle: { id: 1, start_date: "2026-10-20", end_date: "2026-10-26", label: "20 Oct – 26 Oct 2026", status: "open",
      locked_at: null, locked_by_id: null, unlock_reason: null, report_due_date: null, days: 7 },
    days, employees: [emp(1, "Asha Rao", r1), emp(2, "Ben Ito", r2)],
  } as unknown as Grid;
}

function setup(editable = true) {
  const onSave = vi.fn();
  const onSelect = vi.fn();
  render(<TooltipProvider><AttendanceGrid grid={makeGrid()} editable={editable} onSave={onSave} onSelectEmployee={onSelect}
    selectedEmployeeId={null} /></TooltipProvider>);
  return { onSave, onSelect };
}

const cellAt = (name: string, day: string) => screen.getByRole("gridcell", { name: new RegExp(`^${name}, ${day}`) });

describe("AttendanceGrid", () => {
  it("renders an accessible grid with auto weekly offs and not-joined days", () => {
    setup();
    expect(screen.getByRole("grid", { name: /Attendance for/ })).toBeInTheDocument();
    expect(cellAt("Asha Rao", "Sun 25 Oct")).toHaveAccessibleName(/Weekly off \(auto\)/);
    expect(cellAt("Ben Ito", "Tue 20 Oct")).toHaveAttribute("aria-disabled", "true");
  });

  it("sets a status with a keyboard shortcut on the focused cell", () => {
    const { onSave, onSelect } = setup();
    const c = cellAt("Asha Rao", "Wed 21 Oct");
    fireEvent.click(c);
    expect(onSelect).toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("grid"), { key: "a" });
    expect(onSave).toHaveBeenCalledWith([{ employee_id: 1, date: "2026-10-21", status: "A" }]);
  });

  it("shift-click range apply skips Sundays and future-only rules", () => {
    const { onSave } = setup();
    fireEvent.click(cellAt("Asha Rao", "Wed 21 Oct"));
    fireEvent.click(cellAt("Ben Ito", "Mon 26 Oct"), { shiftKey: true });
    fireEvent.keyDown(screen.getByRole("grid"), { key: "l" }); // leave is allowed in the future
    const changes = onSave.mock.calls[0][0] as { date: string; employee_id: number }[];
    expect(changes.map((c) => c.date)).not.toContain("2026-10-25");
    expect(changes).toHaveLength(10); // 2 rows x (21,22,23,24,26)
    onSave.mockClear();
    fireEvent.keyDown(screen.getByRole("grid"), { key: "p" }); // present not allowed on future days
    const present = onSave.mock.calls[0][0] as { date: string }[];
    expect(present.every((c) => c.date <= "2026-10-22")).toBe(true);
  });

  it("is read-only when not editable", () => {
    const { onSave } = setup(false);
    fireEvent.click(cellAt("Asha Rao", "Wed 21 Oct"));
    fireEvent.keyDown(screen.getByRole("grid"), { key: "a" });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("grid")).toHaveAttribute("aria-readonly", "true");
  });
});
