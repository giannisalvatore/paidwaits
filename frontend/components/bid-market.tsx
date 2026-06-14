"use client";

import { useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { BidPanel } from "@/components/bid-panel";
import { compactViews, fetchMarket, logoFor, usd, type Market } from "@/lib/marketplace";

export function BidMarket() {
  const [market, setMarket] = useState<Market | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      fetchMarket()
        .then((m) => {
          if (active) setMarket(m);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 8000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const campaigns = market?.campaigns ?? [];

  return (
    <section id="advertisers" className="border-t border-foreground/15">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 motion-safe:animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          <p className="font-mono text-sm tabular-nums text-primary">
            {(market?.servedToday ?? 0).toLocaleString("en-US")}
          </p>
          <p className="font-mono text-sm text-muted-foreground">5-second views served today</p>
        </div>

        <p className="mt-10 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
          <span className="text-primary">( 02 )</span>
          Advertisers
        </p>
        <h2 className="mt-4 max-w-3xl text-balance text-3xl font-bold leading-[1.02] tracking-tight sm:text-4xl lg:text-5xl">
          Buy ads on the most-watched loading state on the internet.
        </h2>

        <div className="mt-12">
          <BidPanel market={market} />
        </div>

        <p className="mt-16 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
          <span className="text-primary">●</span>
          Live leaderboard
        </p>
        <div className="mt-4 overflow-x-auto border border-foreground bg-card">
          <Table className="min-w-[560px]">
            <TableHeader>
              <TableRow className="border-foreground bg-foreground hover:bg-foreground">
                <TableHead className="w-12 font-mono text-xs uppercase tracking-wider text-background">
                  #
                </TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-background">
                  Campaign
                </TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-background">
                  Price / block
                </TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-background">
                  Views
                </TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-background">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.length === 0 ? (
                <TableRow className="border-border hover:bg-transparent">
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center font-mono text-sm text-muted-foreground"
                  >
                    {market ? "No live campaigns yet — be the first to bid." : "Loading market…"}
                  </TableCell>
                </TableRow>
              ) : (
                campaigns.map((c) => {
                  const logo = logoFor(c.name);
                  return (
                    <TableRow
                      key={c.rank}
                      className="border-border transition-colors duration-150 hover:bg-secondary"
                    >
                      <TableCell className="font-mono text-sm tabular-nums text-muted-foreground">
                        {c.rank}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <span
                            className={cn(
                              "flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold",
                              logo.className
                            )}
                          >
                            {logo.letter}
                          </span>
                          <span className="text-sm font-medium">{c.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm tabular-nums">
                        {usd(c.bidMicros / 1_000_000)}
                      </TableCell>
                      <TableCell className="font-mono text-sm tabular-nums text-muted-foreground">
                        {compactViews(c.viewsDelivered)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider",
                            c.status === "live" ? "text-primary" : "text-muted-foreground"
                          )}
                        >
                          {c.status === "live" && (
                            <span className="h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-pulse" />
                          )}
                          {c.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  );
}
