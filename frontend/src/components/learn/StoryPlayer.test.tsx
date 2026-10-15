import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "@/providers";
import { TxFlow } from "@/store/txFlow";
import { useWallet } from "@/store/wallet";
import { session, startFakeController } from "@/test/fakes";
import { StoryPlayer } from "./StoryPlayer";

vi.mock("@/lib/story", async (orig) => {
  const real = await orig<typeof import("@/lib/story")>();
  return { ...real, playStory: vi.fn() };
});
import * as story from "@/lib/story";

async function mount(over: Record<string, unknown> = {}, mining = "auto") {
  const started = await startFakeController(over);
  started.api.lab.status.mockResolvedValue({ mining: { mode: mining as "auto", automine: mining === "auto", intervalMs: null }, clients: 1 });
  const flow = new TxFlow({ api: {} as never, market: () => null, who: () => null });
  render(<MemoryRouter><AppProviders controller={started.controller} flow={flow}><StoryPlayer /></AppProviders></MemoryRouter>);
  await waitFor(() => expect(started.controller.state.loaded).toBe(true));
  return started;
}

beforeEach(() => { vi.mocked(story.playStory).mockReset(); useWallet.getState().disconnect(); });

describe("StoryPlayer", () => {
  it("describes the story and lets the learner start it", async () => {
    await mount();
    expect(screen.getByRole("heading", { name: /laptop travel from manufacturer to customer/ })).toBeInTheDocument();
    expect(screen.getByText(/Plays 9 real transactions/)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Play the story" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled();
  });

  it("shows each step's caption while it plays, then the outcome", async () => {
    vi.mocked(story.playStory).mockImplementation(async (env) => {
      env.onStep(0, story.STORY[0]!);
      await Promise.resolve();
      env.onStep(2, story.STORY[2]!);
      return { productId: 7n };
    });
    await mount();
    await userEvent.click(await screen.findByRole("button", { name: "Play the story" }));
    expect(await screen.findByText(/The story is finished. Product #7/)).toBeInTheDocument();
    expect(screen.getByLabelText("Story progress")).toHaveTextContent("Step 3 of 9 · Distributor");
    expect(screen.getByText(/instant sale/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play again" })).toBeEnabled();
  });

  it("passes the chosen pace and can be stopped while it runs", async () => {
    let signal!: AbortSignal;
    vi.mocked(story.playStory).mockImplementation((env) => new Promise((_, reject) => {
      signal = env.signal!;
      expect(env.pauseMs).toBe(3500);
      signal.addEventListener("abort", () => reject(new story.StoryError("Stopped.")));
    }));
    await mount();
    await userEvent.selectOptions(await screen.findByLabelText("Pace"), "slow");
    await userEvent.click(screen.getByRole("button", { name: "Play the story" }));
    expect(screen.getByLabelText("Pace")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(await screen.findByText("Stopped.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play again" })).toBeEnabled();
  });

  it("reports why the story could not continue", async () => {
    vi.mocked(story.playStory).mockRejectedValue(new story.StoryError("Distributor's buy did not succeed (Not for sale). The story stops here."));
    await mount();
    await userEvent.click(await screen.findByRole("button", { name: "Play the story" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The story stops here");
  });

  it("is off where there is no lab, or while mining is paused", async () => {
    await mount({ session: vi.fn(async () => session({ lab: { available: false, reason: "off" } })) });
    expect(screen.getByRole("button", { name: "Play the story" })).toBeDisabled();
    expect(screen.getByText(/local development chain/)).toBeInTheDocument();
  });

  it("asks for automatic mining when the chain is paused", async () => {
    await mount({}, "manual");
    await waitFor(() => expect(screen.getByText("Switch mining to Auto first.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Play the story" })).toBeDisabled();
  });
});
