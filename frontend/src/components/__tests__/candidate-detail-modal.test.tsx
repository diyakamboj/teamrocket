import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CandidateDetailModal } from "@/components/candidate-detail-modal";

// The modal fetches on open; nothing here depends on the response, only on
// the component surviving the closed -> open transition.
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/api");
  return {
    ...actual,
    getCandidate: vi.fn().mockResolvedValue(null),
    getCandidateScore: vi.fn().mockResolvedValue(null),
  };
});

describe("CandidateDetailModal", () => {
  /**
   * The regression this exists for.
   *
   * The tab state was declared *after* `if (!candidateId) return null`, so a
   * closed modal ran six hooks and an open one ran seven. React tore the
   * component down with "rendered more hooks than during the previous
   * render", and every View button in both hiring workspaces silently did
   * nothing. Rendering closed and then open is the exact transition that
   * broke.
   */
  it("survives going from closed to open without a hook-order change", () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args[0]);
    });

    const { rerender } = render(
      <CandidateDetailModal candidateId={null} isOpen={false} onClose={() => {}} />,
    );

    rerender(
      <CandidateDetailModal
        candidateId="11111111-1111-1111-1111-111111111111"
        isOpen
        onClose={() => {}}
      />,
    );

    const hookErrors = errors.filter((e) => /hook/i.test(String(e)));
    expect(hookErrors).toEqual([]);
    spy.mockRestore();
  });

  it("renders nothing at all when no candidate is selected", () => {
    const { container } = render(
      <CandidateDetailModal candidateId={null} isOpen={false} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers the three profile groups once a candidate is selected", async () => {
    render(
      <CandidateDetailModal
        candidateId="11111111-1111-1111-1111-111111111111"
        isOpen
        onClose={() => {}}
      />,
    );
    expect(await screen.findByRole("button", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hiring progress" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notes & links" })).toBeInTheDocument();
  });
});
