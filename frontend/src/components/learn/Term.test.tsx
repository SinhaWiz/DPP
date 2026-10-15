import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Rich, Term } from "./Term";

describe("Term", () => {
  it("shows the definition on focus and names it for screen readers", async () => {
    render(<Term id="nonce" />);
    const term = screen.getByLabelText(/^nonce: A counter/);
    expect(term).toHaveClass("underline");
    await userEvent.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("A counter of how many transactions an account has sent");
  });

  it("can show different words for the same term", () => {
    render(<Term id="gas">the fee</Term>);
    expect(screen.getByText("the fee")).toBeInTheDocument();
  });

  it("falls back to plain text for an unknown term", () => {
    render(<Term id="nope">fallback</Term>);
    expect(screen.getByText("fallback")).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});

describe("Rich", () => {
  it("turns markers into terms and keeps the rest as text", () => {
    render(<p><Rich text="A [[hash]] of the [[prevhash]]." /></p>);
    expect(screen.getByLabelText(/^hash:/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^prevHash:/)).toBeInTheDocument();
    expect(screen.getByText("A").parentElement).toHaveTextContent("A hash of the prevHash.");
  });
});

describe("Rich: bold and italic", () => {
  it("renders **bold** and *italic* next to glossary terms", () => {
    render(<p><Rich text="Press **Send**, then see *Would fail* and the [[gas]]." /></p>);
    expect(screen.getByText("Send").tagName).toBe("STRONG");
    expect(screen.getByText("Would fail").tagName).toBe("EM");
    expect(screen.getByLabelText(/^gas:/)).toBeInTheDocument();
  });

  it("leaves a lone asterisk alone", () => {
    render(<p><Rich text="2 * 3 is six" /></p>);
    expect(screen.getByText("2 * 3 is six")).toBeInTheDocument();
  });
});
