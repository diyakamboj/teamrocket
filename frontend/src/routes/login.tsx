import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { setSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, Shield, Bot, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("alex.recruiter@example.com");
  const [password, setPassword] = useState("••••••••••••");
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    setTimeout(() => {
      setSession({
        email,
        name: email.split("@")[0].replace(".", " ").toUpperCase(),
        role: "Senior Technical Recruiter",
        department: "Talent Acquisition",
        isAuthenticated: true,
      });
      setIsLoading(false);
      navigate({ to: "/" });
    }, 400);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Dynamic Background Gradients */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-sky-500/10 border border-sky-500/20 text-sky-400 text-xs font-semibold mb-4">
            <Bot className="w-4 h-4 text-sky-400" />
            AI-Powered Recruiting Intelligence Platform
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center justify-center gap-2">
            <Sparkles className="w-8 h-8 text-sky-400" />
            ResumeIQ
          </h1>
          <p className="text-sm text-slate-400 mt-2">
            Seamless Recruiter Workflow & Contextual AI Governance
          </p>
        </div>

        <Card className="bg-slate-900/90 border-slate-800 shadow-2xl backdrop-blur-xl">
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl text-white">Recruiter Sign In</CardTitle>
            <CardDescription className="text-slate-400 text-xs">
              Enter your credentials to access your hiring workspace
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-300">Recruiter Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-slate-950/70 border-slate-800 text-slate-100 placeholder:text-slate-500 focus:border-sky-500"
                  placeholder="recruiter@company.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-300">Password</label>
                  <span className="text-xs text-sky-400 hover:underline cursor-pointer">
                    Forgot password?
                  </span>
                </div>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-slate-950/70 border-slate-800 text-slate-100 placeholder:text-slate-500 focus:border-sky-500"
                  required
                />
              </div>

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-medium py-2 rounded-lg transition-all shadow-lg shadow-sky-500/20"
              >
                {isLoading ? "Authenticating..." : "Sign In to Recruiter Workspace"}
              </Button>
            </form>

            <div className="mt-6 pt-4 border-t border-slate-800/80 text-xs text-slate-400 space-y-2">
              <div className="flex items-center gap-2 text-slate-400">
                <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Enterprise RBAC & SSO Ready (Firebase / Okta Integration)</span>
              </div>
              <div className="flex items-center gap-2 text-slate-400">
                <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
                <span>Default Demo Recruiter: Alex Smith (Senior Technical Recruiter)</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
