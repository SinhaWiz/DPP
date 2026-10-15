import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";
import { ChainSkeleton } from "./Skeleton";

let broken = true;
function Fragile() {
  if (broken) throw new Error("kaboom");
  return <p>all good</p>;
}

beforeEach(() => {
  broken = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("ErrorBoundary", () => {
  it("shows what went wrong instead of a blank page, and the rest of the page stays", () => {
    render(<div><p>header</p><ErrorBoundary where="this page"><Fragile /></ErrorBoundary></div>);
    expect(screen.getByText("header")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong on this page");
    expect(screen.getByRole("alert")).toHaveTextContent("kaboom");
  });

  it("tries again on request", async () => {
    render(<ErrorBoundary><Fragile /></ErrorBoundary>);
    broken = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("all good")).toBeInTheDocument();
  });

  it("clears the error when the page changes", () => {
    const { rerender } = render(<ErrorBoundary resetKey="/a"><Fragile /></ErrorBoundary>);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    broken = false;
    rerender(<ErrorBoundary resetKey="/b"><Fragile /></ErrorBoundary>);
    expect(screen.getByText("all good")).toBeInTheDocument();
  });
});

describe("ChainSkeleton", () => {
  it("is announced as loading", () => {
    render(<ChainSkeleton />);
    expect(screen.getByRole("status", { name: "Loading the chain…" })).toBeInTheDocument();
  });
});
