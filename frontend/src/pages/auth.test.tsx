import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth";
import { LoginPage } from "./auth";

function renderLogin() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><AuthProvider><LoginPage /></AuthProvider></MemoryRouter></QueryClientProvider>,
  );
}

describe("LoginPage", () => {
  beforeEach(() => localStorage.clear());

  it("validates inline and labels fields", async () => {
    renderLogin();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter a valid email")).toBeInTheDocument();
    expect(screen.getByText("Enter your password")).toBeInTheDocument();
    expect(screen.getByLabelText("Work email")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows a friendly server error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ error: { code: "invalid_credentials", message: "Incorrect email or password." } }),
      { status: 401, headers: { "Content-Type": "application/json" } }));
    renderLogin();
    await userEvent.type(screen.getByLabelText("Work email"), "shraddha@prosparity.in");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
  });
});
