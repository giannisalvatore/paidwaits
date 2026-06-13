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
import { BIDS, usd } from "@/lib/marketplace";

const IMPRESSIONS_BASE = 14_203_118;

export function BidMarket() {
  const [impressions, setImpressions] = useState(IMPRESSIONS_BASE);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      setImpressions((n) => n + 3 + Math.floor(Math.random() * 14));
    }, 800);
    return () => clearInterval(id);
  }, []);

  return (
    <section id="advertisers" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 motion-safe:animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          <p className="font-mono text-sm tabular-nums text-primary">
            {impressions.toLocaleString("en-US")}
          </p>
          <p className="font-mono text-sm text-muted-foreground">5-second views served today</p>
        </div>

        <p className="mt-10 font-mono text-xs uppercase tracking-widest text-muted-foreground">
          For advertisers · 1 block = 1,000 views
        </p>
        <h2 className="mt-3 max-w-2xl text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          Buy blocks of the most-watched loading state on the internet.
        </h2>

        <div className="mt-12">
          <BidPanel />
        </div>

        <p className="mt-16 font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Live leaderboard
        </p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
          <Table className="min-w-[560px]">
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="w-12 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  #
                </TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Campaign
                </TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Price / block
                </TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Views
                </TableHead>
                <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {BIDS.map((bid) => (
                <TableRow
                  key={bid.rank}
                  className="border-border transition-colors duration-150 hover:bg-black/[0.02]"
                >
                  <TableCell className="font-mono text-sm tabular-nums text-muted-foreground">
                    {bid.rank}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold",
                          bid.logo.className
                        )}
                      >
                        {bid.logo.letter}
                      </span>
                      <span className="text-sm font-medium">{bid.campaign}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm tabular-nums">{usd(bid.bid)}</TableCell>
                  <TableCell className="font-mono text-sm tabular-nums text-muted-foreground">
                    {bid.views}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 font-mono text-xs",
                        bid.status === "live" ? "text-primary" : "text-muted-foreground"
                      )}
                    >
                      {bid.status === "live" && (
                        <span className="h-1.5 w-1.5 rounded-full bg-primary motion-safe:animate-pulse" />
                      )}
                      {bid.status}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  );
}
