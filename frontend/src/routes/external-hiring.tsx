import { createFileRoute } from "@tanstack/react-router";
import { Globe } from "lucide-react";
import { HiringWorkspaceFlow } from "@/components/hiring-workspace-flow";

export const Route = createFileRoute("/external-hiring")({
  head: () => ({
    meta: [
      { title: "Hiring from outside — ResumeIQ" },
      {
        name: "description",
        content: "Pick a role, then add outside applicants to it.",
      },
    ],
  }),
  component: ExternalHiringPage,
});

function ExternalHiringPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <header className="border-b border-border pb-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
          <Globe className="h-4 w-4" /> Hiring from outside
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Fill a role from outside</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Choose the role you are filling, then add applicants to it.
        </p>
      </header>

      <HiringWorkspaceFlow
        source="external"
        copy={{
          population: "applicants",
          rolesTitle: "Which role are you filling?",
          rolesBlurb: "Pick one to see who you can put forward for it.",
          peopleTitle: "Applicants you can add",
          peopleBlurb: "People in your pool who are not yet on this role.",
          emptyRoles: "Create a role open to outside applicants, then add people to it.",
          emptyPeople:
            "Everyone in your pool is already on this role. Add more by uploading their résumés.",
        }}
      />
    </div>
  );
}
