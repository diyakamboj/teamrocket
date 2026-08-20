import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CurrentRoleButton, SourceBadge } from "@/components/source-badge";

describe("SourceBadge", () => {
  it("distinguishes an employee from an outside applicant", () => {
    const { rerender } = render(<SourceBadge source="internal" />);
    expect(screen.getByText("Internal")).toBeInTheDocument();

    rerender(<SourceBadge source="external" />);
    expect(screen.getByText("External")).toBeInTheDocument();
  });

  it("treats an unknown source as external rather than blank", () => {
    render(<SourceBadge source={null} />);
    expect(screen.getByText("External")).toBeInTheDocument();
  });

  it("says an internal person is on the bench, not just their assignment", () => {
    render(<SourceBadge source="internal" onBench currentAssignment="Payments" />);
    expect(screen.getByTitle(/On the bench/i)).toBeInTheDocument();
  });
});

describe("CurrentRoleButton", () => {
  it("shows the assignment an employee currently holds", () => {
    render(<CurrentRoleButton currentAssignment="Payments platform" />);
    expect(screen.getByRole("button", { name: /Payments platform/ })).toBeInTheDocument();
  });

  it("does not imply an assignment when none is recorded", () => {
    render(<CurrentRoleButton currentAssignment={null} />);
    expect(screen.getByRole("button", { name: /role not recorded/i })).toBeInTheDocument();
  });

  it("takes precedence over an assignment when they are on the bench", () => {
    // Someone between assignments is available now; the stale assignment
    // would read as them being busy.
    render(<CurrentRoleButton currentAssignment="Payments platform" onBench />);
    expect(screen.getByRole("button", { name: /On the bench/i })).toBeInTheDocument();
  });
});
