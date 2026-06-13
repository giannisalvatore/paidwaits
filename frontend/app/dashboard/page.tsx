"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, usdFromMicros } from "@/lib/api";

type Me = {
  email: string;
  balance_micros: number;
  earned_today_micros: number;
  earned_month_micros: number;
  earned_total_micros: number;
  impressions: number;
  earning_device: string | null;
  min_payout_micros: number;
};

type Payout = { id: number; amount_micros: number; status: string; requested_at: number };

export default function UserDashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMe(await api<Me>("/me"));
    setPayouts((await api<{ payouts: Payout[] }>("/me/payouts")).payouts);
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function cashOut() {
    setMessage(null);
    try {
      const payout = await api<{ amount_micros: number }>("/me/payout", { method: "POST" });
      setMessage(`Payout di ${usdFromMicros(payout.amount_micros)} richiesto.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error && error.message === "below_minimum_payout" ? "Sotto la soglia minima di payout." : "Richiesta fallita.");
    }
  }

  if (!me) return <main className="p-10 text-sm text-muted-foreground">Caricamento…</main>;

  const stats = [
    { label: "Oggi", value: usdFromMicros(me.earned_today_micros, 4) },
    { label: "Ultimi 30 giorni", value: usdFromMicros(me.earned_month_micros, 4) },
    { label: "Totale guadagnato", value: usdFromMicros(me.earned_total_micros, 4) },
    { label: "Saldo prelevabile", value: usdFromMicros(me.balance_micros, 4) },
  ];

  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">I tuoi guadagni</h1>
          <p className="mt-1 text-sm text-muted-foreground">{me.email}</p>
        </div>
        <Link href="/" className="text-sm text-muted-foreground hover:underline">← Home</Link>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border p-4">
            <div className="text-xs text-muted-foreground">{stat.label}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-4 rounded-lg border p-4">
        <div className="flex-1 text-sm">
          <span className="font-medium">{me.impressions}</span> impression viste ·{" "}
          {me.earning_device ? (
            <Badge variant="secondary">earning su {me.earning_device}</Badge>
          ) : (
            <span className="text-muted-foreground">nessuna sessione earning attiva</span>
          )}
        </div>
        <Button onClick={cashOut} disabled={me.balance_micros < me.min_payout_micros}>
          Cash out {usdFromMicros(me.balance_micros)}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Soglia minima di payout: {usdFromMicros(me.min_payout_micros)}. I click non generano guadagno.
      </p>
      {message && <p className="mt-3 text-sm">{message}</p>}

      {payouts.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg font-semibold">Storico payout</h2>
          <Table className="mt-3">
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Importo</TableHead>
                <TableHead>Stato</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payouts.map((payout) => (
                <TableRow key={payout.id}>
                  <TableCell>{new Date(payout.requested_at).toLocaleDateString()}</TableCell>
                  <TableCell className="tabular-nums">{usdFromMicros(payout.amount_micros)}</TableCell>
                  <TableCell><Badge variant="outline">{payout.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </main>
  );
}
