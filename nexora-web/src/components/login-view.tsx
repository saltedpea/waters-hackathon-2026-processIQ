"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const Scene = dynamic(() => import("./login-scene"), { ssr: false });

export default function LoginView() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch("/nx/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: f.get("user"),
          password: f.get("password"),
          remember: f.get("remember") === "on",
        }),
      });
      const j = await r.json();
      if (j.ok) {
        window.location.assign("/");
        return;
      }
      setError(j.error ?? "Sign-in failed.");
    } catch {
      setError("Can't reach the server. Is the backend running?");
    }
    setBusy(false);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div className="absolute inset-0" aria-hidden>
        <Scene />
      </div>

      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.2fr_1fr]">
        <section className="hidden flex-col justify-between p-12 lg:flex">
          <span className="text-sm font-medium uppercase tracking-[0.35em]">Nexora</span>
          <div>
            <p className="max-w-sm text-3xl font-light leading-snug text-foreground/90">
              Process intelligence, <span className="text-primary">calmly</span> governed.
            </p>
            <p className="mt-4 font-mono text-xs tracking-wider text-muted-foreground">
              GOVERNANCE · MATURITY · RULES
            </p>
          </div>
        </section>

        <section className="flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card/60 p-8 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-3 duration-700">
            <span className="mb-6 block text-xs font-medium uppercase tracking-[0.35em] lg:hidden">Nexora</span>
            <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
            <p className="mb-6 mt-1 text-sm text-muted-foreground">Sign in to continue.</p>

            {error && (
              <p role="alert" className="mb-4 rounded-md border border-destructive/60 bg-destructive/30 px-3 py-2 text-sm">
                {error}
              </p>
            )}

            <form onSubmit={onSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="user">Work email</Label>
                <Input id="user" name="user" required autoFocus autoComplete="username" placeholder="name@company.com" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" name="password" type="password" required autoComplete="current-password" placeholder="••••••••••" />
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" name="remember" className="size-4 accent-primary" />
                Remember me
              </label>
              <Button type="submit" disabled={busy} className="mt-2 w-full">
                {busy && <Loader2 className="animate-spin" />}
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
