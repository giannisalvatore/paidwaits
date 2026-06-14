"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";

function SuccessInner() {
  const params = useSearchParams();
  const [finalizing, setFinalizing] = useState(true);

  useEffect(() => {
    const sessionId = params.get("session_id");
    if (!sessionId) {
      // Dev/demo: la campagna è già stata finalizzata lato server.
      setFinalizing(false);
      return;
    }
    fetch(`${API}/campaigns/checkout/finalize`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    }).finally(() => setFinalizing(false));
  }, [params]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <h1 className="text-2xl font-bold tracking-tight">You&apos;re live 🎉</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Payment received — your campaign is in the queue. We&apos;ve emailed a sign-in link so you
          can manage it in your Advertiser Console.
        </p>
        {finalizing && <p className="mt-3 text-xs text-muted-foreground">Finalizing…</p>}
        <div className="mt-6 flex items-center justify-center gap-4 text-sm">
          <Link href="/advertiser/login" className="font-medium text-primary hover:underline">
            Sign in →
          </Link>
          <Link href="/" className="text-muted-foreground hover:underline">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function AdvertiserSuccessPage() {
  return (
    <Suspense>
      <SuccessInner />
    </Suspense>
  );
}
