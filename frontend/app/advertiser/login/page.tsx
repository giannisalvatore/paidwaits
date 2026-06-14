"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";

export default function AdvertiserLogin() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${API}/auth/magic/request`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      setSent(true);
      if (data.dev_link) setDevLink(data.dev_link);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Advertiser Console
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We&apos;ll email you a magic link — no password needed.
        </p>

        {sent ? (
          <div className="mt-6 rounded-lg border p-4 text-sm">
            <p>
              Check <span className="font-medium">{email}</span> for your sign-in link.
            </p>
            {devLink && (
              <p className="mt-3 break-all text-xs text-muted-foreground">
                Dev link:{" "}
                <a href={devLink} className="text-primary underline">
                  {devLink}
                </a>
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="h-11 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <Button type="submit" disabled={loading} className="h-11">
              {loading ? "Sending…" : "Send magic link"}
            </Button>
          </form>
        )}

        <Link href="/" className="mt-6 inline-block text-sm text-muted-foreground hover:underline">
          ← Home
        </Link>
      </div>
    </main>
  );
}
