import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "./App";
import { useUi } from "./store/uiStore";

const renderAt = (path = "/") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );

beforeEach(() => {
  window.localStorage.clear();
  useUi.getState().reset();
  document.documentElement.removeAttribute("data-theme");
});
afterEach(() => vi.restoreAllMocks());

describe("shell", () => {
  it("has the landmarks a screen reader needs", () => {
    renderAt();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Actions" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "What's happening" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Transactions" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
  });

  it.each([
    ["/", "Explorer"],
    ["/playground", "Playground"],
    ["/storage", "Storage"],
    ["/tamper", "Tamper Lab"],
    ["/learn", "Learn"],
  ])("shows the %s page and marks its link current", (path, title) => {
    renderAt(path);
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: title })).toHaveAttribute("aria-current", "page");
  });

  it("navigates between pages", async () => {
    renderAt();
    await userEvent.click(screen.getByRole("link", { name: "Learn" }));
    expect(screen.getByRole("heading", { level: 1, name: "Learn" })).toBeInTheDocument();
  });

  it("shows a friendly page for an unknown address", () => {
    renderAt("/nowhere");
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});

describe("panels", () => {
  it("hides and shows the drawers and remembers the choice", async () => {
    const { unmount } = renderAt();
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.queryByRole("complementary", { name: "Actions" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Explain" }));
    expect(screen.queryByRole("complementary", { name: "What's happening" })).not.toBeInTheDocument();
    unmount();

    // a fresh load reads the saved state
    const saved = JSON.parse(window.localStorage.getItem("ledger-lab.ui.v1")!);
    expect(saved).toMatchObject({ actionsOpen: false, explainOpen: false });
  });

  it("switches dock tabs, opening a collapsed dock", async () => {
    renderAt();
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Mempool" }));
    expect(screen.getByRole("tab", { name: "Mempool" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toBeInTheDocument();
  });

  it("shows an empty state in each dock tab", async () => {
    renderAt();
    for (const name of ["Transaction pipeline", "Mempool", "Activity"]) {
      await userEvent.click(screen.getByRole("tab", { name }));
      expect(within(screen.getByRole("tabpanel")).getByText("No transactions yet")).toBeInTheDocument();
    }
  });
});

describe("theme", () => {
  it("sets and clears data-theme and remembers the choice", async () => {
    renderAt();
    const select = screen.getByRole("combobox", { name: "Theme" });
    await userEvent.selectOptions(select, "dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    await userEvent.selectOptions(select, "light");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    await userEvent.selectOptions(select, "system");
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(JSON.parse(window.localStorage.getItem("ledger-lab.ui.v1")!).theme).toBe("system");
  });

  it("keeps working when storage is unavailable", async () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    renderAt();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Theme" }), "dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    await userEvent.click(screen.getByRole("button", { name: "Actions" })); // must not throw
    expect(screen.queryByRole("complementary", { name: "Actions" })).not.toBeInTheDocument();
  });
});
