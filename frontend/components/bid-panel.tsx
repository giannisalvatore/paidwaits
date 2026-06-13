"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CLICK_MULT, DEFAULT_BID, MIN_BID, TOP_BID, VIEWS_PER_BLOCK, rankFor, usd } from "@/lib/marketplace";

const MAX_ICON_BYTES = 64 * 1024;
const ICON_TYPES = ["image/png", "image/jpeg", "image/webp"];

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition-colors duration-150 placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/20";

export function BidPanel() {
  const [email, setEmail] = useState("");
  const [adLine, setAdLine] = useState("");
  const [url, setUrl] = useState("");
  const [brandName, setBrandName] = useState("");
  const [icon, setIcon] = useState<{ name: string; src: string } | null>(null);
  const [iconError, setIconError] = useState<string | null>(null);
  const [onLeaderboard, setOnLeaderboard] = useState(true);
  const [bidInput, setBidInput] = useState(DEFAULT_BID.toFixed(2));
  const [blocksInput, setBlocksInput] = useState("10");
  const [isDragging, setIsDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const price = Math.max(0, parseFloat(bidInput) || 0); // price per block
  const blocks = Math.max(0, Math.floor(parseFloat(blocksInput) || 0));
  const views = blocks * VIEWS_PER_BLOCK;
  const payment = blocks * price;
  const rank = rankFor(price);
  const clickCost = (price * CLICK_MULT) / 1000;

  function handleIconFile(file: File | undefined) {
    if (!file) return;
    if (!ICON_TYPES.includes(file.type)) {
      setIconError("PNG, JPG or WebP only.");
      return;
    }
    if (file.size > MAX_ICON_BYTES) {
      setIconError("Image is over 64 KB.");
      return;
    }
    if (icon) URL.revokeObjectURL(icon.src);
    setIconError(null);
    setIcon({ name: file.name, src: URL.createObjectURL(file) });
  }

  function removeIcon() {
    if (icon) URL.revokeObjectURL(icon.src);
    setIcon(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: string[] = [];
    if (!/.+@.+\..+/.test(email)) errs.push("Enter a valid email.");
    if (adLine.trim().length < 3 || adLine.trim().length > 60)
      errs.push("Ad line must be 3–60 characters.");
    if (!/^https:\/\/.+\..+/.test(url)) errs.push("Destination URL must start with https://");
    if (price < MIN_BID) errs.push(`Minimum price is ${usd(MIN_BID)} per block.`);
    if (blocks < 1) errs.push("Buy at least 1 block.");
    setErrors(errs);
    setSubmitted(errs.length === 0);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4 sm:px-6">
        <h3 className="font-semibold">Buy blocks</h3>
        <p className="font-mono text-xs text-muted-foreground">
          1 block = 1,000 views (5s each)
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="grid divide-y divide-border lg:grid-cols-[1fr_340px] lg:divide-x lg:divide-y-0"
        noValidate
      >
        {/* Fields */}
        <div className="flex flex-col gap-5 p-5 sm:p-6">
          <div>
            <label htmlFor="bid-email" className="text-sm font-medium">
              Email <span className="text-muted-foreground">(required)</span>
            </label>
            <input
              id="bid-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className={cn(inputClass, "mt-1.5")}
            />
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="bid-adline" className="text-sm font-medium">
                Ad line <span className="text-muted-foreground">· 3–60 char</span>
              </label>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {adLine.length} / 60
              </span>
            </div>
            <input
              id="bid-adline"
              type="text"
              maxLength={60}
              value={adLine}
              onChange={(e) => setAdLine(e.target.value)}
              placeholder="The corporate card that closes your books 8 days faster."
              className={cn(inputClass, "mt-1.5")}
            />
          </div>

          <div>
            <label htmlFor="bid-url" className="text-sm font-medium">
              Destination URL <span className="text-muted-foreground">(https://)</span>
            </label>
            <input
              id="bid-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://yourproduct.com"
              className={cn(inputClass, "mt-1.5 font-mono")}
            />
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="bid-brand" className="text-sm font-medium">
                Brand name{" "}
                <span className="text-muted-foreground">(optional, shown on leaderboard)</span>
              </label>
              <input
                id="bid-brand"
                type="text"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                placeholder="Acme"
                className={cn(inputClass, "mt-1.5")}
              />
            </div>
            <div>
              <p className="text-sm font-medium">
                Brand icon{" "}
                <span className="text-muted-foreground">(optional, PNG/JPG/WebP ≤ 64 KB)</span>
              </p>
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileRef.current?.click()}
                onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  handleIconFile(e.dataTransfer.files[0]);
                }}
                className={cn(
                  "mt-1.5 flex min-h-[38px] cursor-pointer items-center gap-2 rounded-md border border-dashed border-input px-3 py-2 transition-colors duration-150 hover:border-primary/50",
                  isDragging && "border-primary bg-primary/5"
                )}
              >
                {icon ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={icon.src} alt="" className="h-5 w-5 rounded object-cover" />
                    <span className="truncate text-xs">{icon.name}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeIcon();
                      }}
                      className="ml-auto text-muted-foreground transition-colors duration-150 hover:text-foreground"
                      aria-label="Remove icon"
                    >
                      ×
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Drop an image here or click to browse
                  </span>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept={ICON_TYPES.join(",")}
                className="hidden"
                onChange={(e) => handleIconFile(e.target.files?.[0])}
              />
              {iconError && <p className="mt-1 text-xs text-destructive">{iconError}</p>}
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={onLeaderboard}
              onChange={(e) => setOnLeaderboard(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Show me on the public leaderboard
          </label>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="bid-blocks" className="text-sm font-medium">
                Blocks <span className="text-muted-foreground">(1 block = 1,000 views)</span>
              </label>
              <input
                id="bid-blocks"
                type="number"
                min={1}
                step={1}
                value={blocksInput}
                onChange={(e) => setBlocksInput(e.target.value)}
                className={cn(inputClass, "mt-1.5 font-mono tabular-nums")}
              />
            </div>
            <div>
              <label htmlFor="bid-amount" className="text-sm font-medium">
                Price per block{" "}
                <span className="text-muted-foreground">(min {usd(MIN_BID)} — sets your rank)</span>
              </label>
              <div className="relative mt-1.5">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                  $
                </span>
                <input
                  id="bid-amount"
                  type="number"
                  min={MIN_BID}
                  step={0.5}
                  value={bidInput}
                  onChange={(e) => setBidInput(e.target.value)}
                  className={cn(inputClass, "pl-7 font-mono tabular-nums")}
                />
              </div>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            Each block buys 1,000 views — one view is a 5-second show while Claude is thinking.
            More blocks = more views. A higher price per block moves you up the queue so your views
            deliver sooner — it doesn&apos;t add views. You also pay {usd(clickCost)} per click.
          </p>
        </div>

        {/* Summary */}
        <div className="flex flex-col gap-5 bg-background/50 p-5 sm:p-6">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              Your queue position
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {usd(price)} per block in today&apos;s market
            </p>
            <p className="mt-3 text-4xl font-bold tabular-nums tracking-tight">#{rank}</p>
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-card p-3">
            <div>
              <p className="font-mono text-sm tabular-nums">{blocks.toLocaleString("en-US")}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">blocks</p>
            </div>
            <div>
              <p className="font-mono text-sm tabular-nums">{views.toLocaleString("en-US")}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">total views</p>
            </div>
            <div>
              <p className="font-mono text-sm tabular-nums">{usd(payment)}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">you pay</p>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            Top price right now is {usd(TOP_BID)} per block — pay above it to take #1 and deliver
            first, or any amount from {usd(MIN_BID)} to join the queue. Your price sets where you
            rank, not how many views you get.
          </p>

          {price > TOP_BID && (
            <p className="font-mono text-xs text-primary">This price takes #1 in the queue</p>
          )}

          <div className="mt-auto flex flex-col gap-3">
            {errors.length > 0 && (
              <ul className="flex flex-col gap-1">
                {errors.map((err) => (
                  <li key={err} className="text-xs text-destructive">
                    {err}
                  </li>
                ))}
              </ul>
            )}
            {submitted && (
              <p className="font-mono text-xs text-primary">
                Order received — demo only, payments coming soon.
              </p>
            )}
            <Button
              type="submit"
              size="lg"
              className="w-full bg-primary font-semibold tabular-nums text-primary-foreground transition-colors duration-150 hover:bg-primary/90"
            >
              Fund {usd(payment)} — go live
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
