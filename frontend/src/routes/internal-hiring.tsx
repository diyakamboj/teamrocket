import { createFileRoute } from "@tanstack/react-router";
import { Briefcase } from "lucide-react";
import { HiringWorkspaceFlow } from "@/components/hiring-workspace-flow";

export const Route = createFileRoute("/internal-hiring")({
  head: () => ({
    meta: [
      { title: "Hiring from inside — ResumeIQ" },
      {
        name: "description",
        content: "Pick an internal role, then add people already at the company to it.",
      },
    ],
  }),
  component: InternalHiringPage,
});

function InternalHiringPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <header className="border-b border-border pb-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
          <Briefcase className="h-4 w-4" /> Hiring from inside
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          Fill a role with someone already here
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Choose the role you are filling, then add people to it.
        </p>
      </header>

      <HiringWorkspaceFlow
        source="internal"
        copy={{
          population: "employees",
          rolesTitle: "Which role are you filling?",
          rolesBlurb: "Pick one to see who you can put forward for it.",
          peopleTitle: "People you can add",
          peopleBlurb: "Employees not yet on this role, best fit first.",
          emptyRoles:
            "Create a role open to people already at the company, then add employees to it.",
          emptyPeople:
            "Everyone in your employee list is already on this role. Add more by uploading their résumé.",
        }}
      />
    </div>
  );
}
