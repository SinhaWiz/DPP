import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lesson } from "@/lib/lessons/types";
import { LearnPage } from "@/pages/Learn";
import { AppProviders } from "@/providers";
import { useLessons } from "@/store/lessonStore";
import { useTally } from "@/store/eventTally";
import { msg, session, startFakeController, validChain } from "@/test/fakes";
import { LessonOverlay } from "./LessonOverlay";

const lesson = (over: Partial<Lesson> = {}): Lesson => ({
  id: "demo", title: "Demo lesson", summary: "Learn what a [[hash]] is.", minutes: 3,
  steps: [
    { id: "a", title: "Look at the chain", instruction: "Find the [[prevhash]] of a block.", readOnly: true, done: () => false, target: '[data-testid="target"]', hint: "It is at the bottom of each block." },
    { id: "b", title: "Open a record", instruction: "Click a record.", done: (n) => n.route === "/elsewhere" || (n.events["tx.mined"] ?? 0) > 0, hint: "Any transaction will do." },
  ],
  quiz: [
    { id: "q1", question: "What links two records?", choices: ["A name", "prevHash", "A price"], answer: 1, explanation: "Each record stores the [[hash]] of the one before." },
    { id: "q2", question: "Can a revert leave a record?", choices: ["Yes", "No"], answer: 1, explanation: "A revert undoes everything." },
  ],
  ...over,
});

async function mount(ui: React.ReactNode, over: Record<string, unknown> = {}) {
  const started = await startFakeController(over);
  started.api.setRecords(validChain(3));
  render(
    <MemoryRouter initialEntries={["/learn"]}>
      <AppProviders controller={started.controller}>{ui}</AppProviders>
    </MemoryRouter>,
  );
  await waitFor(() => expect(started.controller.state.loaded).toBe(true));
  return started;
}

beforeEach(() => { window.localStorage.clear(); useLessons.setState({ run: null, progress: {}, status: null }); useTally.getState().clear(); });

describe("Learn page", () => {
  it("lists lessons with their length and what they are about, and the glossary", async () => {
    await mount(<LearnPage lessons={[lesson(), lesson({ id: "two", title: "Second", needsLab: true })]} />);
    const cards = within(screen.getByRole("list", { name: "Lessons" })).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Demo lesson");
    expect(cards[0]).toHaveTextContent("3 min");
    expect(cards[0]).toHaveTextContent("Learn what a hash is.");
    expect(screen.getByRole("region", { name: "Glossary" })).toHaveTextContent("A counter of how many transactions");
    expect(screen.getByLabelText("Your progress")).toHaveTextContent("0 of 2 lessons completed");
  });

  it("warns that a lesson needs the lab, and disables it where the lab is off", async () => {
    await mount(<LearnPage lessons={[lesson({ needsLab: true })]} />, { session: vi.fn(async () => session({ lab: { available: false, reason: "Only on the local chain" } })) });
    expect(screen.getByText("needs the local lab")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start the lesson" })).toBeDisabled();
    expect(screen.getByText("Only on the local chain")).toBeInTheDocument();
  });

  it("highlights the lesson named in the address", async () => {
    const started = await startFakeController();
    render(
      <MemoryRouter initialEntries={["/learn?lesson=two"]}>
        <AppProviders controller={started.controller}><LearnPage lessons={[lesson(), lesson({ id: "two", title: "Second" })]} /></AppProviders>
      </MemoryRouter>,
    );
    expect(document.getElementById("lesson-two")).toHaveClass("border-accent");
    expect(document.getElementById("lesson-demo")).not.toHaveClass("border-accent");
  });

  it("starts a lesson and shows saved progress afterwards", async () => {
    useLessons.setState({ progress: { demo: { completedAt: 1, correct: 2, total: 2 } } });
    await mount(<LearnPage lessons={[lesson()]} />);
    expect(screen.getByLabelText("Completed, 2 of 2 correct")).toBeInTheDocument();
    expect(screen.getByLabelText("Your progress")).toHaveTextContent("1 of 1 lessons completed");
    await userEvent.click(screen.getByRole("button", { name: "Do it again" }));
    expect(useLessons.getState().run?.lessonId).toBe("demo");
    expect(screen.getByRole("button", { name: "In progress" })).toBeDisabled();
  });

  it("resets progress on request", async () => {
    useLessons.setState({ progress: { demo: { completedAt: 1, correct: 1, total: 2 } } });
    await mount(<LearnPage lessons={[lesson()]} />);
    await userEvent.click(screen.getByRole("button", { name: "Reset my progress" }));
    expect(useLessons.getState().progress).toEqual({});
  });
});

describe("LessonOverlay", () => {
  async function running(l: Lesson = lesson()) {
    const started = await mount(<><div data-testid="target">a highlighted thing</div><LessonOverlay lessons={[l]} /></>);
    await act(async () => { await useLessons.getState().start(l, { api: started.controller.api, say: () => {} }, { route: "/learn" } as never); });
    return started;
  }

  it("shows the first step, its progress and the part of the page it is about", async () => {
    await running();
    const overlay = await screen.findByRole("complementary", { name: "Lesson" });
    expect(overlay).toHaveTextContent("Look at the chain");
    expect(overlay).toHaveTextContent("Step 1 of 2");
    expect(within(overlay).getByLabelText(/prevHash:/)).toBeInTheDocument();
    expect(screen.getByTestId("target")).toHaveClass("tour-highlight");
  });

  it("removes the highlight when the step changes or the lesson closes", async () => {
    await running();
    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    expect(screen.getByTestId("target")).not.toHaveClass("tour-highlight");
  });

  it("a reading step can always be passed; a doing step waits for the learner", async () => {
    const started = await running();
    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Open a record" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "To the quiz" })).toBeDisabled();
    expect(screen.getByText("Waiting for you to do this…")).toBeInTheDocument();

    act(() => started.controller.apply(msg("tx.mined", {}, 3)));
    await waitFor(() => expect(screen.getByText("✔ Done")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "To the quiz" })).toBeEnabled();
  });

  it("offers a hint and a way to skip a step that is stuck", async () => {
    await running();
    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Hint" }));
    expect(screen.getByText(/Any transaction will do/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Hide hint" }));
    expect(screen.queryByText(/Any transaction will do/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    expect(screen.getByRole("heading", { name: "Check what you learned" })).toBeInTheDocument();
  });

  it("goes back a step", async () => {
    await running();
    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Look at the chain" })).toBeInTheDocument();
  });

  it("runs the quiz: explains each answer, keeps the first answer, and scores the result", async () => {
    await running();
    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Skip this step" }));

    const quiz = screen.getByRole("heading", { name: "Check what you learned" }).parentElement!;
    const q1 = within(quiz).getByRole("group", { name: "What links two records?" });
    await userEvent.click(within(q1).getByLabelText("A name"));
    expect(within(q1).getByRole("status")).toHaveTextContent("Not quite");
    expect(within(q1).getByLabelText("prevHash")).toBeDisabled();     // the first answer counts
    const q2 = within(quiz).getByRole("group", { name: "Can a revert leave a record?" });
    expect(screen.getByRole("button", { name: "See my result" })).toBeDisabled();
    await userEvent.click(within(q2).getByLabelText("No"));
    expect(within(q2).getByRole("status")).toHaveTextContent("Correct");

    await userEvent.click(screen.getByRole("button", { name: "See my result" }));
    expect(screen.getByText(/1 of 2/)).toBeInTheDocument();
    expect(useLessons.getState().progress.demo).toMatchObject({ correct: 1, total: 2 });
  });

  it("closes, and returns to the lessons after finishing", async () => {
    await running(lesson({ quiz: [] }));
    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    expect(screen.getByRole("heading", { name: "Lesson complete 🎉" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back to the lessons" }));
    expect(screen.queryByRole("complementary", { name: "Lesson" })).not.toBeInTheDocument();
  });

  it("can be closed at any time", async () => {
    await running();
    await userEvent.click(await screen.findByRole("button", { name: "Close lesson" }));
    expect(useLessons.getState().run).toBeNull();
  });

  it("shows the setup being prepared, and a retry if it fails", async () => {
    const failing = lesson({ setup: vi.fn().mockRejectedValueOnce(new Error("the lab is off")).mockResolvedValue(undefined) });
    await running(failing);
    expect(await screen.findByText("The lesson could not be set up.")).toBeInTheDocument();
    expect(screen.getByText("the lab is off")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Look at the chain" })).toBeInTheDocument();
  });

  it("renders nothing when no lesson is running", async () => {
    await mount(<LessonOverlay lessons={[lesson()]} />);
    expect(screen.queryByRole("complementary", { name: "Lesson" })).not.toBeInTheDocument();
  });
});
