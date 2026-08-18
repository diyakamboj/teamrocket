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
    <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-4 relative overflow-hidden font-sans">
      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold mb-4">
            <Bot className="w-4 h-4 text-blue-600" />
            AI-Powered Recruiting Intelligence Platform
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center justify-center gap-2">
            <Sparkles className="w-6 h-6 text-blue-600" />
            ResumeIQ
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Seamless Recruiter Workflow & Contextual AI Governance
          </p>
        </div>

        <Card className="bg-white border-slate-200 shadow-sm rounded-xl">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-lg text-slate-900 font-bold">Recruiter Sign In</CardTitle>
            <CardDescription className="text-slate-500 text-xs">
              Enter your credentials to access your hiring workspace
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700">Recruiter Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 text-xs"
                  placeholder="recruiter@company.com"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700">Password</label>
                  <span className="text-xs text-blue-600 hover:underline cursor-pointer">
                    Forgot password?
                  </span>
                </div>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-500 text-xs"
                  required
                />
              </div>

              <Button
                type="submit"
                disabled={isLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 text-xs rounded-lg transition-all shadow-xs"
              >
                {isLoading ? "Authenticating..." : "Sign In to Recruiter Workspace"}
              </Button>
            </form>

            <div className="mt-6 pt-4 border-t border-slate-100 text-xs text-slate-500 space-y-2">
              <div className="flex items-center gap-2 text-slate-600">
                <Shield className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Enterprise RBAC & SSO Ready (Firebase / Okta Integration)</span>
              </div>
              <div className="flex items-center gap-2 text-slate-600">
                <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                <span>Default Demo Recruiter: Alex Smith (Senior Technical Recruiter)</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

