"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4100";

function AuthInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState(false);

  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      setError(true);
      return;
    }
    fetch(`${API}/auth/magic/verify`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        router.replace("/advertiser");
      })
      .catch(() => setError(true));
  }, [params, router]);

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        {error ? (
          <>
            <h1 className="text-xl font-bold tracking-tight">Link expired or invalid</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Magic links work once and expire after 30 minutes.
            </p>
            <Link
              href="/advertiser/login"
              className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
            >
              Request a new link →
            </Link>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Signing you in…</p>
        )}
      </div>
    </main>
  );
}

export default function AdvertiserAuthPage() {
  return (
    <Suspense>
      <AuthInner />
    </Suspense>
  );
}
