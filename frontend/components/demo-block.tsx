"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const THINKING_WORDS = [
  "Spelunking",
  "Pondering",
  "Noodling",
  "Percolating",
  "Ruminating",
  "Conjuring",
  "Finagling",
  "Marinating",
];

const GLYPH_FRAMES = ["✶", "✻", "✳", "✻"];

const ADS = [
  { brand: "Ramp", tagline: "save time and money", logo: { letter: "R", className: "bg-amber-400 text-black" } },
  { brand: "Linear", tagline: "ship faster, plan less", logo: { letter: "L", className: "bg-indigo-500 text-white" } },
  { brand: "Vercel", tagline: "deploy in seconds", logo: { letter: "▲", className: "bg-white text-black" } },
];

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-5 w-5 rotate-90 text-primary md:rotate-0"
    >
      <path d="m7 6 6 6-6 6" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function TerminalCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-14 items-center justify-between gap-3 overflow-hidden rounded-2xl border border-white/10 bg-[#16181c] px-4 font-mono text-sm shadow-sm sm:px-5">
      {children}
    </div>
  );
}

export function DemoBlock() {
  const [tick, setTick] = useState(0);
  const [frame, setFrame] = useState(0);
  const [ds, setDs] = useState(0); // elapsed deciseconds, 0 → 50 (= 5.0s)

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDs(26); // static 2.6s when motion is reduced
      return;
    }
    const fast = setInterval(() => setFrame((f) => (f + 1) % GLYPH_FRAMES.length), 180);
    const timer = setInterval(() => {
      setDs((d) => {
        if (d >= 50) {
          setTick((t) => t + 1); // reached 5.0s → change phrase
          return 0;
        }
        return d + 1;
      });
    }, 100);
    return () => {
      clearInterval(fast);
      clearInterval(timer);
    };
  }, []);

  const word = THINKING_WORDS[tick % THINKING_WORDS.length];
  const ad = ADS[tick % ADS.length];
  const seconds = (ds / 10).toFixed(1);
  const credits = ((tick + 1) * 0.05).toFixed(2); // +$0.05 each time an ad is shown

  return (
    <div className="mx-auto grid w-full max-w-3xl grid-cols-1 items-center gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-4">
      {/* Before */}
      <div>
        <p className="mb-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.15em] text-[#D97757]">
          Claude Code
        </p>
        <TerminalCard>
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="w-4 shrink-0 text-center text-[#D97757]">{GLYPH_FRAMES[frame]}</span>
            <span key={`w-${word}`} className="truncate text-[#D97757] motion-safe:animate-ad-in">
              {word}…
            </span>
          </span>
          <span className="shrink-0 text-xs tabular-nums text-zinc-500">Write · {seconds}s</span>
        </TerminalCard>
        <p className="mt-2.5 flex items-center justify-between font-mono text-[11px] text-zinc-500">
          <span className="uppercase tracking-[0.15em]">Credits</span>
          <span className="tabular-nums">$0.00</span>
        </p>
      </div>

      <Chevron />

      {/* After */}
      <div>
        <p className="mb-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.15em] text-primary">
          With Paidwaits
        </p>
        <TerminalCard>
          <span className="flex min-w-0 items-center gap-2.5">
            <span
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold",
                ad.logo.className
              )}
            >
              {ad.logo.letter}
            </span>
            <span key={`ad-${tick}`} className="truncate motion-safe:animate-ad-in">
              <span className="text-zinc-100">{ad.brand}</span>
              <span className="text-sky-300/90"> · {ad.tagline}.</span>
            </span>
          </span>
          <span className="shrink-0 text-xs tabular-nums text-zinc-500">Write · {seconds}s</span>
        </TerminalCard>
        <p className="mt-2.5 flex items-center justify-between font-mono text-[11px] text-zinc-500">
          <span className="uppercase tracking-[0.15em]">Credits</span>
          <span key={`c-${tick}`} className="tabular-nums text-primary motion-safe:animate-ad-in">
            +${credits}
          </span>
        </p>
      </div>
    </div>
  );
}
