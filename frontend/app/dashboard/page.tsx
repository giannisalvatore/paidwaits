"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AreaChart } from "@/components/area-chart";
import { api, usdFromMicros } from "@/lib/api";

type Me = {
  email: string;
  balance_micros: number;
  withdrawable_micros: number;
  earned_hour_micros: number;
  earned_today_micros: number;
  earned_month_micros: number;
  earned_total_micros: number;
  earn_hour_cap_micros: number;
  earn_day_cap_micros: number;
  hour_reset_at: number;
  day_reset_at: number;
  earnings_series: { day: number; value: number }[];
  impressions: number;
  earning_device: string | null;
  min_payout_micros: number;
};

type Payout = { id: number; amount_micros: number; status: string; requested_at: number };
type Connect = { connected: boolean; payouts_enabled: boolean };

const PAYOUT_ERRORS: Record<string, string> = {
  below_minimum_payout: "Below the minimum payout.",
  no_mature_impressions: "Nothing has matured yet — impressions become withdrawable after 7 days.",
  payouts_not_enabled: "Connect a payout account first.",
  payout_transfer_failed: "Payout transfer failed — please try again.",
  account_under_review: "Your account is under review.",
  account_suspended: "Your account is suspended.",
  account_rejected: "Your account was rejected.",
};

function resetsIn(ts: number) {
  const ms = Math.max(0, ts - Date.now());
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

function LimitRow({
  label,
  used,
  cap,
  resetAt,
}: {
  label: string;
  used: number;
  cap: number;
  resetAt: number;
}) {
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-mono tabular-nums text-muted-foreground">
          {usdFromMicros(used)} / {usdFromMicros(cap)}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">resets in {resetsIn(resetAt)}</p>
    </div>
  );
}

export default function UserDashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [connect, setConnect] = useState<Connect | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [meData, payoutsData, connectData] = await Promise.all([
      api<Me>("/me"),
      api<{ payouts: Payout[] }>("/me/payouts"),
      api<Connect>("/me/connect/status"),
    ]);
    setMe(meData);
    setPayouts(payoutsData.payouts);
    setConnect(connectData);
  }, []);

  useEffect(() => {
    load().catch(() => {});
    const id = setInterval(() => {
      load().catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
  }, [load]);

  async function cashOut() {
    setMessage(null);
    try {
      const payout = await api<{ amount_micros: number }>("/me/payout", { method: "POST" });
      setMessage(`Payout of ${usdFromMicros(payout.amount_micros)} requested.`);
      await load();
    } catch (error) {
      const code = error instanceof Error ? error.message : "request_failed";
      setMessage(PAYOUT_ERRORS[code] ?? "Request failed.");
    }
  }

  async function setupPayouts() {
    setMessage(null);
    try {
      const res = await api<{ url: string }>("/me/connect/onboard", { method: "POST" });
      window.location.href = res.url;
    } catch {
      setMessage("Could not start payout setup.");
    }
  }

  if (!me) return <main className="p-10 text-sm text-muted-foreground">Loading…</main>;

  const stats = [
    { label: "Today", value: usdFromMicros(me.earned_today_micros, 4) },
    { label: "Last 30 days", value: usdFromMicros(me.earned_month_micros, 4) },
    { label: "Total earned", value: usdFromMicros(me.earned_total_micros, 4) },
    { label: "Available balance", value: usdFromMicros(me.balance_micros, 4) },
  ];

  const payoutsEnabled = connect?.payouts_enabled ?? false;
  const canCashOut = payoutsEnabled && me.withdrawable_micros >= me.min_payout_micros;

  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your earnings</h1>
          <p className="mt-1 text-sm text-muted-foreground">{me.email}</p>
        </div>
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          ← Home
        </Link>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border p-4">
            <div className="text-xs text-muted-foreground">{stat.label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Cash out */}
      <div className="mt-6 flex items-center gap-4 rounded-lg border p-4">
        <div className="flex-1 text-sm">
          <span className="font-medium">{me.impressions}</span> views watched ·{" "}
          {me.earning_device ? (
            <Badge variant="secondary">earning on {me.earning_device}</Badge>
          ) : (
            <span className="text-muted-foreground">no earning session active</span>
          )}
        </div>
        {payoutsEnabled ? (
          <Button onClick={cashOut} disabled={!canCashOut}>
            Cash out {usdFromMicros(me.withdrawable_micros)}
          </Button>
        ) : (
          <Button onClick={setupPayouts}>Set up payouts</Button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Minimum payout: {usdFromMicros(me.min_payout_micros)}
        {!payoutsEnabled && " · connect a payout account to cash out"}
      </p>
      {message && <p className="mt-3 text-sm">{message}</p>}

      {/* Earning activity + limits */}
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <AreaChart
          label="Earning activity"
          data={me.earnings_series}
          format={(value) => usdFromMicros(value)}
        />
        <div className="rounded-lg border p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Earning limits
          </p>
          <div className="mt-4 flex flex-col gap-5">
            <LimitRow
              label="Hourly"
              used={me.earned_hour_micros}
              cap={me.earn_hour_cap_micros}
              resetAt={me.hour_reset_at}
            />
            <LimitRow
              label="Daily"
              used={me.earned_today_micros}
              cap={me.earn_day_cap_micros}
              resetAt={me.day_reset_at}
            />
          </div>
        </div>
      </div>

      {payouts.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg font-semibold">Payout history</h2>
          <Table className="mt-3">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payouts.map((payout) => (
                <TableRow key={payout.id}>
                  <TableCell>{new Date(payout.requested_at).toLocaleDateString()}</TableCell>
                  <TableCell className="tabular-nums">{usdFromMicros(payout.amount_micros)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{payout.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </main>
  );
}
