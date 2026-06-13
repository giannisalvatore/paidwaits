"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AreaChart } from "@/components/area-chart";
import { api, usdFromMicros } from "@/lib/api";

type Campaign = {
  id: number;
  name: string;
  creative_text: string;
  target_url: string;
  bid_micros: number;
  funded_micros: number;
  remaining_micros: number;
  status: "live" | "paused";
  impressions: number;
  clicks: number;
  spent_micros: number;
};

type Summary = {
  campaigns: number;
  serving: number;
  impressions: number;
  clicks: number;
  spend_micros: number;
  ctr: number;
  series: { day: number; impressions: number; clicks: number; spend_micros: number }[];
};

const CLICK_MULT = 50;
const inputClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/20";

export default function AdvertiserDashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [form, setForm] = useState({ name: "", creative_text: "", target_url: "", bid_usd: "5", budget_usd: "50" });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [summaryData, mine] = await Promise.all([
      api<Summary>("/campaigns/summary"),
      api<{ campaigns: Campaign[] }>("/campaigns"),
    ]);
    setSummary(summaryData);
    setCampaigns(mine.campaigns);
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function launch(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      await api("/campaigns", {
        method: "POST",
        body: JSON.stringify({ ...form, bid_usd: Number(form.bid_usd), budget_usd: Number(form.budget_usd) }),
      });
      setForm({ name: "", creative_text: "", target_url: "", bid_usd: "5", budget_usd: "50" });
      await load();
      setMessage("Campagna lanciata.");
    } catch (error) {
      setMessage(`Lancio fallito: ${error instanceof Error ? error.message : "errore"}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function patchCampaign(id: number, body: Record<string, unknown>) {
    await api(`/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    await load();
  }

  async function fundCampaign(id: number) {
    const amount = window.prompt("Aggiungi budget ($, minimo 20):", "50");
    if (!amount) return;
    try {
      await api(`/campaigns/${id}/fund`, { method: "POST", body: JSON.stringify({ amount_usd: Number(amount) }) });
      await load();
    } catch {
      setMessage("Ricarica fallita (minimo $20).");
    }
  }

  if (!summary) return <main className="p-10 text-sm text-muted-foreground">Caricamento…</main>;

  const bid = Number(form.bid_usd) || 0;
  const budget = Number(form.budget_usd) || 0;
  const estViews = bid > 0 ? Math.floor((budget / bid) * 1000) : 0;

  const stats = [
    { label: "Campaigns", value: String(summary.campaigns), sub: "totali" },
    { label: "Serving", value: String(summary.serving), sub: "attive ora" },
    { label: "Views", value: summary.impressions.toLocaleString("en-US"), sub: "impression servite" },
    { label: "Spend", value: usdFromMicros(summary.spend_micros), sub: "spesa totale" },
    { label: "CTR", value: `${(summary.ctr * 100).toFixed(2)}%`, sub: `${summary.clicks} click` },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Advertiser</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Dashboard</h1>
        </div>
        <Link href="/" className="text-sm text-muted-foreground hover:underline">← Home</Link>
      </div>

      {/* Stat cards */}
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border bg-card p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{stat.label}</p>
            <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight">{stat.value}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <AreaChart
          label="Impressions"
          data={summary.series.map((point) => ({ day: point.day, value: point.impressions }))}
          format={(value) => value.toLocaleString("en-US")}
        />
        <AreaChart
          label="Clicks"
          data={summary.series.map((point) => ({ day: point.day, value: point.clicks }))}
          format={(value) => value.toLocaleString("en-US")}
        />
        <AreaChart
          label="Spend"
          data={summary.series.map((point) => ({ day: point.day, value: point.spend_micros }))}
          format={(value) => usdFromMicros(value)}
        />
      </div>

      {/* Create campaign block */}
      <div className="mt-8 overflow-hidden rounded-2xl border bg-card">
        <div className="border-b px-6 py-5">
          <h2 className="text-lg font-semibold tracking-tight">Lancia una campagna</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Asta continua: ogni impression va a una campagna live con probabilità proporzionale al bid. Paghi il
            bid ÷ 1.000 per impression, {usdFromMicros((bid * CLICK_MULT * 1_000_000) / 1000) || "$0.00"} per click.
            Il budget che fissi è il pagamento.
          </p>
        </div>
        <form onSubmit={launch} className="grid gap-5 p-6 lg:grid-cols-[1fr_300px]">
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">
                Nome
                <input required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ramp" className={`${inputClass} mt-1.5`} />
              </label>
              <label className="text-sm font-medium">
                URL destinazione (https)
                <input required type="url" value={form.target_url} onChange={(e) => setForm({ ...form, target_url: e.target.value })} placeholder="https://ramp.com" className={`${inputClass} mt-1.5 font-mono`} />
              </label>
            </div>
            <label className="text-sm font-medium">
              Ad line <span className="text-muted-foreground">· max 200 char</span>
              <input required maxLength={200} value={form.creative_text} onChange={(e) => setForm({ ...form, creative_text: e.target.value })} placeholder="The corporate card that closes your books 8 days faster." className={`${inputClass} mt-1.5`} />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">
                Bid (CPM) <span className="text-muted-foreground">· min $1</span>
                <input required type="number" min={1} step="0.5" value={form.bid_usd} onChange={(e) => setForm({ ...form, bid_usd: e.target.value })} className={`${inputClass} mt-1.5 tabular-nums`} />
              </label>
              <label className="text-sm font-medium">
                Budget <span className="text-muted-foreground">· min $20</span>
                <input required type="number" min={20} step="10" value={form.budget_usd} onChange={(e) => setForm({ ...form, budget_usd: e.target.value })} className={`${inputClass} mt-1.5 tabular-nums`} />
              </label>
            </div>
          </div>

          {/* Summary panel */}
          <div className="flex flex-col gap-4 rounded-xl border bg-background/50 p-5">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Pagamento</p>
              <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight">{usdFromMicros(budget * 1_000_000)}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="tabular-nums">{estViews.toLocaleString("en-US")}</p>
                <p className="text-[11px] text-muted-foreground">impression stimate</p>
              </div>
              <div>
                <p className="tabular-nums">{usdFromMicros(bid * 1_000_000)}</p>
                <p className="text-[11px] text-muted-foreground">bid CPM</p>
              </div>
            </div>
            <Button type="submit" size="lg" disabled={submitting} className="mt-auto w-full font-semibold">
              {submitting ? "Lancio…" : `Lancia — paga ${usdFromMicros(budget * 1_000_000)}`}
            </Button>
            {message && <p className="text-xs">{message}</p>}
          </div>
        </form>
      </div>

      {/* Campaigns table */}
      <h2 className="mt-10 text-lg font-semibold tracking-tight">Campagne</h2>
      <div className="mt-3 overflow-x-auto rounded-xl border bg-card">
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead>Campagna</TableHead>
              <TableHead>Bid (CPM)</TableHead>
              <TableHead>Stato</TableHead>
              <TableHead className="text-right">Impression</TableHead>
              <TableHead className="text-right">Click</TableHead>
              <TableHead className="text-right">Spesa</TableHead>
              <TableHead className="text-right">Residuo</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((campaign) => (
              <TableRow key={campaign.id}>
                <TableCell>
                  <div className="font-medium">{campaign.name}</div>
                  <div className="max-w-[220px] truncate text-xs text-muted-foreground">{campaign.creative_text}</div>
                </TableCell>
                <TableCell>
                  <input
                    type="number"
                    min={1}
                    step="0.1"
                    defaultValue={(campaign.bid_micros / 1_000_000).toFixed(2)}
                    onBlur={(e) => {
                      const value = Number(e.target.value);
                      if (value * 1_000_000 !== campaign.bid_micros) void patchCampaign(campaign.id, { bid_usd: value });
                    }}
                    className={`${inputClass} w-24 tabular-nums`}
                  />
                </TableCell>
                <TableCell>
                  <Badge variant={campaign.status === "live" && campaign.remaining_micros > 0 ? "default" : "secondary"}>
                    {campaign.remaining_micros <= 0 ? "esaurita" : campaign.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{campaign.impressions.toLocaleString("en-US")}</TableCell>
                <TableCell className="text-right tabular-nums">{campaign.clicks.toLocaleString("en-US")}</TableCell>
                <TableCell className="text-right tabular-nums">{usdFromMicros(campaign.spent_micros, 4)}</TableCell>
                <TableCell className="text-right tabular-nums">{usdFromMicros(campaign.remaining_micros)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => fundCampaign(campaign.id)}>+ Budget</Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => patchCampaign(campaign.id, { status: campaign.status === "live" ? "paused" : "live" })}
                    >
                      {campaign.status === "live" ? "Pausa" : "Avvia"}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {campaigns.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  Nessuna campagna. Lanciane una qui sopra.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </main>
  );
}
