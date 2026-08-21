/**
 * Window events for opening shell-owned UI from anywhere in the tree.
 *
 * The create-job modal and the command palette both live in the shell, so a
 * card on the dashboard cannot reach their state directly. Rather than lift
 * that state into a context every screen would have to consume, these follow
 * the pattern the app already uses for "job-created": dispatch an event, let
 * the shell listen.
 */

export const OPEN_CREATE_JOB = "open-create-job";
export const OPEN_COMMAND_PALETTE = "open-command-palette";

/** Opens the create-job modal owned by the app shell. */
export function openCreateJob() {
  window.dispatchEvent(new CustomEvent(OPEN_CREATE_JOB));
}

/** Opens the ⌘K command palette. */
export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE));
}
