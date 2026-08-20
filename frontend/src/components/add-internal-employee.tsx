import { Loader2, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createInternalEmployee, type JobPipelineSummary } from "@/lib/api";

/**
 * Add an existing employee without a résumé.
 *
 * Uploading a résumé was the only way into the system, which is an odd
 * requirement for someone who already works here — and it is why the bench
 * stayed empty: there was no way to say "this person is between projects".
 */
export function AddInternalEmployee({
  jobs,
  onAdded,
}: {
  jobs?: JobPipelineSummary[];
  onAdded?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    title: "",
    current_assignment: "",
    skills: "",
    on_bench: false,
    job_id: "",
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      toast.error("Name and email are required");
      return;
    }
    setSaving(true);
    try {
      await createInternalEmployee({
        name: form.name.trim(),
        email: form.email.trim(),
        title: form.title.trim() || null,
        // Someone on the bench is between assignments by definition, so the
        // current assignment is not theirs to keep.
        current_assignment: form.on_bench ? null : form.current_assignment.trim() || null,
        skills: form.skills
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        on_bench: form.on_bench,
        job_id: form.job_id || null,
      });
      toast.success(
        form.on_bench
          ? `${form.name.trim()} added and placed on the bench`
          : `${form.name.trim()} added as an internal employee`,
      );
      setForm({
        name: "",
        email: "",
        title: "",
        current_assignment: "",
        skills: "",
        on_bench: false,
        job_id: "",
      });
      setOpen(false);
      onAdded?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add that employee");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5 rounded-xl text-xs"
      >
        <UserPlus className="h-3.5 w-3.5" /> Add internal employee
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border bg-card p-5 shadow-sm">
      <h3 className="text-sm font-bold">Add an internal employee</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        No résumé needed — they already work here.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Name" required>
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Priya Raman"
            className="rounded-lg text-xs"
          />
        </Field>
        <Field label="Work email" required>
          <Input
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="priya.raman@company.com"
            className="rounded-lg text-xs"
          />
        </Field>
        <Field label="Job title">
          <Input
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Senior Backend Engineer"
            className="rounded-lg text-xs"
          />
        </Field>
        <Field label="Current role / project">
          <Input
            value={form.current_assignment}
            onChange={(e) => set("current_assignment", e.target.value)}
            placeholder="Payments platform"
            disabled={form.on_bench}
            className="rounded-lg text-xs disabled:opacity-50"
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Skills (comma separated)">
            <Input
              value={form.skills}
              onChange={(e) => set("skills", e.target.value)}
              placeholder="Python, Kubernetes, PostgreSQL"
              className="rounded-lg text-xs"
            />
          </Field>
        </div>
        {jobs && jobs.length > 0 && (
          <div className="sm:col-span-2">
            <Field label="Consider for a role (optional)">
              <select
                value={form.job_id}
                onChange={(e) => set("job_id", e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs"
              >
                <option value="">No role yet</option>
                {jobs.map((job) => (
                  <option key={job.job_id} value={job.job_id}>
                    {job.title}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </div>

      <label className="mt-4 flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={form.on_bench}
          onChange={(e) => set("on_bench", e.target.checked)}
          className="h-3.5 w-3.5"
        />
        <span>
          They are between assignments — put them on the bench
          <span className="ml-1 text-muted-foreground">(starts the bench clock today)</span>
        </span>
      </label>

      <div className="mt-5 flex items-center gap-2">
        <Button type="submit" size="sm" disabled={saving} className="gap-1.5 rounded-xl text-xs">
          {saving && <Loader2 className="h-3 w-3 animate-spin" />} Add employee
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
          className="rounded-xl text-xs"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {children}
    </label>
  );
}
