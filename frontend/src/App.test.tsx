import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "./App";
import { AppProviders } from "./providers";
import { useUi } from "./store/uiStore";
import { startFakeController } from "./test/fakes";

const renderAt = async (path = "/") => {
  const { controller } = await startFakeController();
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders controller={controller}>
        <AppRoutes />
      </AppProviders>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  window.localStorage.clear();
  useUi.getState().reset();
  document.documentElement.removeAttribute("data-theme");
});
afterEach(() => vi.restoreAllMocks());

describe("shell", () => {
  it("has the landmarks a screen reader needs", async () => {
    await renderAt();
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
  ])("shows the %s page and marks its link current", async (path, title) => {
    await renderAt(path);
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: title })).toHaveAttribute("aria-current", "page");
  });

  it("navigates between pages", async () => {
    await renderAt();
    await userEvent.click(screen.getByRole("link", { name: "Learn" }));
    expect(screen.getByRole("heading", { level: 1, name: "Learn" })).toBeInTheDocument();
  });

  it("shows a friendly page for an unknown address", async () => {
    await renderAt("/nowhere");
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });
});

describe("panels", () => {
  it("hides and shows the drawers and remembers the choice", async () => {
    const { unmount } = await renderAt();
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
    await renderAt();
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Mempool" }));
    expect(screen.getByRole("tab", { name: "Mempool" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toBeInTheDocument();
  });

  it("shows an empty state in each dock tab", async () => {
    await renderAt();
    for (const [name, message] of [["Transaction pipeline", "No transaction yet"], ["Mempool", "Nothing is waiting"], ["Activity", "No transactions yet"]] as const) {
      await userEvent.click(screen.getByRole("tab", { name }));
      expect(within(screen.getByRole("tabpanel")).getByText(message)).toBeInTheDocument();
    }
  });
});

describe("theme", () => {
  it("sets and clears data-theme and remembers the choice", async () => {
    await renderAt();
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
    await renderAt();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Theme" }), "dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    await userEvent.click(screen.getByRole("button", { name: "Actions" })); // must not throw
    expect(screen.queryByRole("complementary", { name: "Actions" })).not.toBeInTheDocument();
  });

  it("leaves the dock out of the Playground, which already shows the same views, but keeps it elsewhere", async () => {
    const { unmount } = await renderAt("/playground");
    expect(screen.getAllByRole("tab", { name: "Transaction pipeline" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Hide" })).not.toBeInTheDocument();
    unmount();
    await renderAt("/");
    expect(screen.getAllByRole("tab", { name: "Transaction pipeline" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Hide" })).toBeInTheDocument();
  });
});
