import { Armchair, Briefcase, Loader2, UserCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { AddInternalEmployee } from "@/components/add-internal-employee";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  assignFromBench,
  listInternalEmployees,
  placeOnBench,
  type InternalEmployee,
  type JobPipelineSummary,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The internal roster: everyone who works here, benched or not.
 *
 * The bench page used to list only people already on the bench, so there was
 * no way to put anyone on it — you could see the bench but not reach it.
 * Benching happens from here, against the person's current assignment.
 */
export function InternalRoster({
  jobs,
  onChanged,
}: {
  jobs?: JobPipelineSummary[];
  onChanged?: () => void;
}) {
  const [people, setPeople] = useState<InternalEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [assigningTo, setAssigningTo] = useState<string | null>(null);
  const [assignment, setAssignment] = useState("");

  const refresh = useCallback(async () => {
    try {
      setPeople(await listInternalEmployees());
    } catch {
      setPeople([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function bench(person: InternalEmployee) {
    setBusy(person.candidate_id);
    try {
      await placeOnBench(person.candidate_id, person.current_assignment ?? undefined);
      toast.success(`${person.name} is now on the bench`);
      await refresh();
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not bench them");
    } finally {
      setBusy(null);
    }
  }

  async function assign(person: InternalEmployee) {
    if (!assignment.trim()) {
      toast.error("Name the assignment they are moving to");
      return;
    }
    setBusy(person.candidate_id);
    try {
      await assignFromBench(person.candidate_id, assignment.trim());
      toast.success(`${person.name} assigned to ${assignment.trim()}`);
      setAssigningTo(null);
      setAssignment("");
      await refresh();
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not assign them");
    } finally {
      setBusy(null);
    }
  }

  const available = people.filter((p) => p.on_bench).length;

  return (
    <section className="rounded-2xl border bg-card shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold">Internal employees</h2>
          <p className="text-xs text-muted-foreground">
            {people.length} {people.length === 1 ? "person" : "people"} · {available} on the bench
          </p>
        </div>
        <AddInternalEmployee
          {...(jobs ? { jobs } : {})}
          onAdded={() => {
            void refresh();
            onChanged?.();
          }}
        />
      </header>

      <div className="p-5">
        {loading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the roster…
          </p>
        ) : people.length === 0 ? (
          <div className="rounded-xl border border-dashed px-4 py-10 text-center">
            <UserCheck className="mx-auto h-7 w-7 text-muted-foreground" />
            <p className="mt-2 text-sm font-semibold">No internal employees yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              Add the people who already work here. They do not need a résumé — once added you can
              put them on the bench and match them to internal roles.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {people.map((person) => (
              <li
                key={person.candidate_id}
                className={cn(
                  "flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5",
                  person.on_bench && "border-success/30 bg-success/50 dark:bg-success/5",
                )}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {person.name
                    .split(" ")
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{person.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {person.title || "No title"}
                  </p>
                </div>

                {/* Their current role in the company — the thing you need to
                    know before pulling someone onto something else. */}
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                    person.on_bench
                      ? "bg-success/10 text-success dark:bg-success/15 dark:text-success"
                      : "bg-secondary text-secondary-foreground",
                  )}
                  title={
                    person.on_bench
                      ? "Between assignments and available now"
                      : "Currently assigned — benching them frees them up"
                  }
                >
                  {person.on_bench ? (
                    <>
                      <Armchair className="h-3 w-3" />
                      On the bench
                      {typeof person.days_on_bench === "number" && ` · ${person.days_on_bench}d`}
                    </>
                  ) : (
                    <>
                      <Briefcase className="h-3 w-3" />
                      {person.current_assignment || "Assigned"}
                    </>
                  )}
                </span>

                {person.on_bench ? (
                  assigningTo === person.candidate_id ? (
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Input
                        autoFocus
                        value={assignment}
                        onChange={(e) => setAssignment(e.target.value)}
                        placeholder="New assignment"
                        className="h-7 w-40 rounded-lg text-xs"
                      />
                      <Button
                        size="sm"
                        className="h-7 rounded-lg text-xs"
                        disabled={busy === person.candidate_id}
                        onClick={() => void assign(person)}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 rounded-lg text-xs"
                        onClick={() => setAssigningTo(null)}
                      >
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 rounded-lg text-xs"
                      onClick={() => {
                        setAssigningTo(person.candidate_id);
                        setAssignment("");
                      }}
                    >
                      Assign to a project
                    </Button>
                  )
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 gap-1 rounded-lg text-xs"
                    disabled={busy === person.candidate_id}
                    onClick={() => void bench(person)}
                  >
                    {busy === person.candidate_id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Armchair className="h-3 w-3" />
                    )}
                    Move to bench
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
