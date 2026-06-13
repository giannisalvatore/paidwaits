"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api("/auth/dev", { method: "POST", body: JSON.stringify({ email }) });
      router.push(params.get("next") ?? "/dashboard");
    } catch {
      setError("Login fallito. Il backend è attivo?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight">Accedi a WaitingAds</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Dev mode: solo email. In produzione l&apos;accesso sarà esclusivamente con Google.
        </p>
        <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="tu@esempio.com"
            className="h-11 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <Button type="submit" disabled={loading} className="h-11">
            {loading ? "Accesso…" : "Accedi"}
          </Button>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
