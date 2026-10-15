import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionBadge, Address, Eth, Hash, LifecyclePill, SlotValue, StatusPill } from "./Primitives";
import { RolesProvider } from "@/lib/roles";
import { Tooltip } from "./Tooltip";

const HASH = "0x" + "ab".repeat(32);
const ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const roles = [{ index: 1, name: "Distributor", description: "Buys from the manufacturer", address: ADDR }];

afterEach(() => vi.restoreAllMocks());

describe("Tooltip", () => {
  it("opens on keyboard focus, is described by the trigger, and closes on Escape", async () => {
    render(<Tooltip content="More detail"><button>Trigger</button></Tooltip>);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await userEvent.tab();
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("More detail");
    expect(screen.getByRole("button", { name: "Trigger" })).toHaveAttribute("aria-describedby", tip.id);

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("opens on hover and closes when the pointer leaves", async () => {
    render(<Tooltip content="Hover text" delay={0}><span>Target</span></Tooltip>);
    await userEvent.hover(screen.getByText("Target"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Hover text");
    await userEvent.unhover(screen.getByText("Target"));
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("stays closed when disabled", async () => {
    render(<Tooltip content="never" disabled><button>Trigger</button></Tooltip>);
    await userEvent.tab();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});

describe("Hash", () => {
  it("shows the short form and reveals the full hash on focus", async () => {
    render(<Hash value={HASH} label="Block hash" />);
    expect(screen.getByText("0xababab…abab")).toBeInTheDocument();
    await userEvent.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(HASH);
  });

  it("copies the full value and confirms it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Hash value={HASH} label="Block hash" />);
    await userEvent.click(screen.getByRole("button", { name: "Copy block hash" }));
    expect(writeText).toHaveBeenCalledWith(HASH);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("reports a failed copy instead of pretending", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }, configurable: true });
    render(<Hash value={HASH} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy hash" }));
    expect(await screen.findByText("Copy failed")).toBeInTheDocument();
  });

  it("can hide the copy button", () => {
    render(<Hash value={HASH} copy={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("Address", () => {
  it("shows the role name with the short address when the account has a role", () => {
    // the lookup ignores case: a lower-case address still finds its role
    render(<RolesProvider roles={roles}><Address value={ADDR.toLowerCase()} /></RolesProvider>);
    expect(screen.getByText("Distributor")).toBeInTheDocument();
    expect(screen.getByText("0x7099…79c8")).toBeInTheDocument();
  });

  it("shows only the short address for an unknown account", () => {
    render(<Address value={ADDR} />);
    expect(screen.getByText("0x7099…79C8")).toBeInTheDocument();
    expect(screen.queryByText("Distributor")).not.toBeInTheDocument();
  });

  it("puts the role description and full address in the tooltip", async () => {
    render(<RolesProvider roles={roles}><Address value={ADDR} /></RolesProvider>);
    await userEvent.tab();
    const tip = await screen.findByRole("tooltip");
    expect(within(tip).getByText("Buys from the manufacturer")).toBeInTheDocument();
    expect(tip).toHaveTextContent(ADDR);
  });

  it("renders the zero address as a dash", () => {
    render(<Address value={"0x" + "00".repeat(20)} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("Eth", () => {
  it("shows ETH and the exact wei", async () => {
    render(<Eth wei={1_500_000_000_000_000_000n} />);
    expect(screen.getByLabelText("1.5 ETH, 1,500,000,000,000,000,000 wei")).toBeInTheDocument();
    await userEvent.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("1,500,000,000,000,000,000 wei");
  });
});

describe("badges", () => {
  it("labels every action with text, not only colour", () => {
    const names = [0, 1, 2, 3, 4, 5].map((a) => {
      const { unmount, container } = render(<ActionBadge action={a as 0} />);
      const text = container.textContent ?? "";
      unmount();
      return text;
    });
    expect(names.map((n) => n.replace(/^\S\s?/, ""))).toEqual(["Registered", "Listed", "Delisted", "Sold", "Reserved", "Revoked"]);
  });

  it("explains an action on hover/focus", async () => {
    render(<ActionBadge action={5} />);
    await userEvent.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("reservation was cancelled");
  });

  it("can be compact but stays readable to screen readers", () => {
    render(<ActionBadge action={3} compact />);
    expect(screen.getByText("Sold")).toHaveClass("sr-only");
  });

  it("shows each verification status with its own label", () => {
    for (const [status, label] of [["intact", "Intact"], ["dataTampered", "Data tampered"], ["linkBroken", "Link broken"], ["anchorMismatch", "Log mismatch"]] as const) {
      const { unmount } = render(<StatusPill status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it("marks a link-broken pill as dashed and a pending transaction as pulsing", () => {
    const { container, unmount } = render(<StatusPill status="linkBroken" />);
    expect(container.firstElementChild).toHaveClass("border-dashed");
    unmount();
    const pending = render(<LifecyclePill state="pending" />);
    expect(pending.container.firstElementChild).toHaveClass("pulse-ring");
    pending.unmount();
    const dropped = render(<LifecyclePill state="dropped" />);
    expect(dropped.container.firstElementChild).toHaveClass("line-through");
  });
});

describe("SlotValue", () => {
  it("groups the word and dims runs of zeros", () => {
    const { container } = render(<SlotValue value={"0x" + "00".repeat(28) + "deadbeef"} />);
    const groups = container.querySelectorAll("code > span");
    expect(groups).toHaveLength(8);
    expect(groups[0]).toHaveClass("opacity-60");
    expect(groups[7]).toHaveTextContent("deadbeef");
    expect(groups[7]).not.toHaveClass("opacity-60");
  });
});
