import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Loader2,
  MessageSquare,
  Network,
  NotebookPen,
  Search,
  Send,
  Share2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  listConnections,
  listMessageThreads,
  listRecruiterDirectory,
  listSharedByMe,
  listSharedWithMe,
  readMessageThread,
  removeConnection,
  requestConnection,
  respondToConnection,
  revokeShare,
  sendMessage,
  updateSharePermission,
  type DirectMessage,
  type DirectoryRecruiter,
  type MessageThread,
  type RecruiterConnection,
  type SharedCandidate,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CandidateNotes } from "@/components/candidate-notes";
import { SharedCandidatePipeline } from "@/components/shared-candidate-pipeline";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/network")({
  head: () => ({
    meta: [
      { title: "Recruiter Network — ResumeIQ" },
      {
        name: "description",
        content: "Connect with other technical recruiters to share screening context.",
      },
    ],
  }),
  component: NetworkPage,
});

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function StateBadge({ state }: { state: DirectoryRecruiter["connection_state"] }) {
  if (state === "none") return null;
  const label =
    state === "connected"
      ? "Connected"
      : state === "pending_outgoing"
        ? "Request sent"
        : "Wants to connect";
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        state === "connected"
          ? "bg-success/15 text-success dark:text-success"
          : "bg-secondary text-secondary-foreground",
      )}
    >
      {label}
    </span>
  );
}


/** What a share lets its recipient do — the difference between being shown a
 * candidate and being able to work them. */
function PermissionBadge({ permission }: { permission: SharedCandidate["permission"] }) {
  const collaborate = permission === "collaborate";
  return (
    <span
      className={cn(
        "mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        collaborate
          ? "bg-success/15 text-success dark:text-success"
          : "bg-secondary text-secondary-foreground",
      )}
    >
      {collaborate ? "Can collaborate" : "View only"}
    </span>
  );
}

/**
 * A conversation with one connection. Messages are polled while open, so a
 * reply arrives without a manual refresh — the volume here is a handful of
 * messages, not a live chat firehose.
 */
function Conversation({
  email,
  name,
  onClose,
}: {
  email: string;
  name: string;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setMessages(await readMessageThread(email));
    } catch {
      // A failed poll should not empty a conversation the user is reading.
    }
  }, [email]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await sendMessage({ email, body });
      setDraft("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Message not sent");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="animate-rise rounded-2xl border bg-card shadow-sm">
      <header className="flex items-center justify-between border-b px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
            {initials(name)}
          </span>
          <div>
            <p className="text-sm font-semibold">{name}</p>
            <p className="text-xs text-muted-foreground">{email}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" aria-label="Close conversation" className="h-8 w-8" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </header>

      <div className="flow-tight max-h-72 overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No messages yet — say hello.
          </p>
        ) : (
          messages.map((message) => {
            const mine = message.sender_email !== email;
            return (
              <div
                key={message.id}
                className={cn("flex", mine ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "animate-pop max-w-[75%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed",
                    mine
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground",
                  )}
                >
                  {message.body}
                </div>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 border-t px-4 py-3">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Message ${name.split(" ")[0]}…`}
          className="h-9 rounded-xl text-xs"
        />
        <Button type="submit" size="icon" disabled={sending || !draft.trim()} className="h-9 w-9 shrink-0 rounded-xl">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </section>
  );
}

function NetworkPage() {
  const [directory, setDirectory] = useState<DirectoryRecruiter[]>([]);
  const [connections, setConnections] = useState<RecruiterConnection[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [shared, setShared] = useState<SharedCandidate[]>([]);
  const [sharedByMe, setSharedByMe] = useState<SharedCandidate[]>([]);
  const [openChat, setOpenChat] = useState<{ email: string; name: string } | null>(null);
  //: Which shared candidate has its note thread expanded.
  const [openNotes, setOpenNotes] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [people, links, inbox, sharedWithMe, mine] = await Promise.all([
        listRecruiterDirectory(),
        listConnections(),
        listMessageThreads(),
        listSharedWithMe(),
        listSharedByMe(),
      ]);
      setDirectory(people);
      setConnections(links);
      setThreads(inbox);
      setShared(sharedWithMe);
      setSharedByMe(mine);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the recruiter network");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(key: string, action: () => Promise<unknown>, success: string) {
    setBusy(key);
    try {
      await action();
      await refresh();
      toast.success(success);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That didn't work");
    } finally {
      setBusy(null);
    }
  }

  const incoming = connections.filter((c) => c.direction === "incoming" && c.status === "pending");
  const accepted = connections.filter((c) => c.status === "accepted");
  const visible = directory.filter((person) =>
    `${person.name} ${person.role} ${person.email}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="mx-auto flow max-w-5xl pb-12">
      <header className="animate-rise">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
          <Network className="h-4 w-4" /> Recruiter network
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
          Connect with other technical recruiters
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Connections are for sharing screening context on candidates you are both working.
          Connecting does not expose your candidates, jobs or documents — those stay in your
          account.
        </p>
      </header>

      {incoming.length > 0 && (
        <section className="animate-rise rounded-2xl border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold">
            Requests waiting on you
            <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
              {incoming.length}
            </span>
          </h2>
          <ul className="stagger mt-4 space-y-2.5">
            {incoming.map((request) => (
              <li
                key={request.id}
                className="lift flex flex-wrap items-center gap-3 rounded-xl border p-3.5"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {initials(request.counterpart_name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{request.counterpart_name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {request.counterpart_role}
                    {request.message ? ` — “${request.message}”` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="rounded-lg"
                    disabled={busy === request.id}
                    onClick={() =>
                      void act(
                        request.id,
                        () => respondToConnection(request.id, true),
                        `Connected with ${request.counterpart_name}`,
                      )
                    }
                  >
                    <Check className="mr-1.5 h-3.5 w-3.5" /> Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg"
                    disabled={busy === request.id}
                    onClick={() =>
                      void act(
                        request.id,
                        () => respondToConnection(request.id, false),
                        "Request declined",
                      )
                    }
                  >
                    <X className="mr-1.5 h-3.5 w-3.5" /> Decline
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {openChat && (
        <Conversation
          email={openChat.email}
          name={openChat.name}
          onClose={() => {
            setOpenChat(null);
            void refresh();
          }}
        />
      )}

      {shared.length > 0 && (
        <section className="animate-rise rounded-2xl border bg-card shadow-sm">
          <header className="border-b px-5 py-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
              <Share2 className="h-4 w-4" /> Shared with you
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Candidates a connection sent you. They stay in that recruiter's pool — where you can
              collaborate, you can add notes and move them in that recruiter's pipeline.
            </p>
          </header>
          <ul className="stagger grid gap-2.5 p-5 sm:grid-cols-2">
            {shared.map((candidate) => (
              <li key={candidate.share_id} className="lift rounded-xl border p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{candidate.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {candidate.title || "—"}
                      {candidate.job_title ? ` · for ${candidate.job_title}` : ""}
                    </p>
                  </div>
                  {candidate.screening_score != null && (
                    <span className="metric shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                      {Math.round(candidate.screening_score)}
                    </span>
                  )}
                </div>
                <PermissionBadge permission={candidate.permission} />
                {candidate.note && (
                  <p className="mt-2 text-xs italic text-muted-foreground">“{candidate.note}”</p>
                )}
                <SharedCandidatePipeline candidate={candidate} onMoved={() => void refresh()} />
                {candidate.screening_summary && (
                  <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                    {candidate.screening_summary}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    from {candidate.shared_by_name}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 rounded-lg text-xs"
                      onClick={() =>
                        setOpenNotes((id) =>
                          id === candidate.share_id ? null : candidate.share_id,
                        )
                      }
                    >
                      <NotebookPen className="mr-1.5 h-3 w-3" />
                      {openNotes === candidate.share_id ? "Hide notes" : "Notes"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 rounded-lg text-xs"
                      onClick={() =>
                        setOpenChat({
                          email: candidate.shared_by_email,
                          name: candidate.shared_by_name,
                        })
                      }
                    >
                      <MessageSquare className="mr-1.5 h-3 w-3" /> Discuss
                    </Button>
                  </div>
                </div>
                {openNotes === candidate.share_id && (
                  <CandidateNotes
                    className="mt-3"
                    candidateId={candidate.candidate_id}
                    jobId={candidate.job_id}
                    canWrite={candidate.permission === "collaborate"}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {sharedByMe.length > 0 && (
        <section className="animate-rise rounded-2xl border bg-card shadow-sm">
          <header className="border-b px-5 py-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
              <Share2 className="h-4 w-4" /> Shared by you
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Candidates you sent to a connection. Change what they can do, or revoke access —
              the candidate stays yours either way.
            </p>
          </header>
          <ul className="stagger grid gap-2.5 p-5 sm:grid-cols-2">
            {sharedByMe.map((candidate) => (
              <li key={candidate.share_id} className="lift rounded-xl border p-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{candidate.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    shared with {candidate.shared_with_name}
                    {candidate.job_title ? ` · for ${candidate.job_title}` : ""}
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { id: "view", label: "Can view" },
                      { id: "collaborate", label: "Can collaborate" },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.id}
                      disabled={busy === candidate.share_id}
                      onClick={() =>
                        void act(
                          candidate.share_id,
                          () => updateSharePermission(candidate.share_id, option.id),
                          `${candidate.name}: ${option.label.toLowerCase()}`,
                        )
                      }
                      className={cn(
                        "rounded-lg border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                        candidate.permission === option.id
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "text-muted-foreground hover:border-primary/40 hover:text-foreground",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === candidate.share_id}
                    className="ml-auto h-7 rounded-lg text-xs text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      void act(
                        candidate.share_id,
                        () => revokeShare(candidate.share_id),
                        `Stopped sharing ${candidate.name}`,
                      )
                    }
                  >
                    Revoke
                  </Button>
                </div>

                <CandidateNotes
                  className="mt-3"
                  candidateId={candidate.candidate_id}
                  jobId={candidate.job_id}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {threads.length > 0 && !openChat && (
        <section className="animate-rise rounded-2xl border bg-card shadow-sm">
          <header className="border-b px-5 py-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
              <MessageSquare className="h-4 w-4" /> Messages
            </div>
          </header>
          <ul className="divide-y">
            {threads.map((thread) => (
              <li key={thread.counterpart_email}>
                <button
                  onClick={() =>
                    setOpenChat({
                      email: thread.counterpart_email,
                      name: thread.counterpart_name,
                    })
                  }
                  className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-secondary/50"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {initials(thread.counterpart_name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{thread.counterpart_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{thread.last_message}</p>
                  </div>
                  {thread.unread_count > 0 && (
                    <span className="metric shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
                      {thread.unread_count}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="animate-rise rounded-2xl border bg-card shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Directory</h2>
            <p className="text-xs text-muted-foreground">
              {accepted.length} connection{accepted.length === 1 ? "" : "s"} · {directory.length}{" "}
              recruiter{directory.length === 1 ? "" : "s"} on this workspace
            </p>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or role"
              className="h-9 w-56 rounded-lg pl-8 text-xs"
            />
          </div>
        </header>

        <div className="p-5">
          {loading ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading recruiters…
            </p>
          ) : error ? (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
          ) : visible.length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-10 text-center">
              <Users className="mx-auto h-7 w-7 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">
                {directory.length === 0 ? "No other recruiters yet" : "No matches"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {directory.length === 0
                  ? "When a colleague creates an account, they'll appear here."
                  : "Try a different name or role."}
              </p>
            </div>
          ) : (
            <ul className="stagger grid gap-2.5 sm:grid-cols-2">
              {visible.map((person) => {
                const connection = connections.find(
                  (c) => c.counterpart_email === person.email && c.status !== "declined",
                );
                return (
                  <li key={person.email} className="lift flex items-center gap-3 rounded-xl border p-4">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {initials(person.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold">{person.name}</p>
                        <StateBadge state={person.connection_state} />
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{person.role}</p>
                    </div>

                    {person.connection_state === "none" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 rounded-lg"
                        disabled={busy === person.email}
                        onClick={() =>
                          void act(
                            person.email,
                            () => requestConnection(person.email),
                            `Request sent to ${person.name}`,
                          )
                        }
                      >
                        <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Connect
                      </Button>
                    )}

                    {person.connection_state === "connected" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 rounded-lg"
                        onClick={() => setOpenChat({ email: person.email, name: person.name })}
                      >
                        <MessageSquare className="mr-1.5 h-3.5 w-3.5" /> Message
                      </Button>
                    )}

                    {connection && person.connection_state !== "none" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0 rounded-lg text-muted-foreground hover:text-destructive"
                        disabled={busy === connection.id}
                        onClick={() =>
                          void act(
                            connection.id,
                            () => removeConnection(connection.id),
                            person.connection_state === "connected"
                              ? "Disconnected"
                              : "Request withdrawn",
                          )
                        }
                      >
                        {person.connection_state === "connected" ? "Disconnect" : "Withdraw"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
