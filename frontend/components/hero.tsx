import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DemoBlock } from "@/components/demo-block";
import { TrustStrip } from "@/components/trust-strip";

export function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-24 pt-16 sm:px-6 sm:pt-20">
      <div className="flex flex-col items-center text-center">
        <Link
          href="#advertisers"
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 motion-safe:animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          The attention layer for AI dev tools
        </Link>

        <h1 className="text-balance text-5xl font-bold tracking-tighter sm:text-7xl">
          AI thinks.
          <br />
          Get paid for waiting.
        </h1>

        <p className="mt-6 max-w-xl text-balance text-base text-muted-foreground sm:text-lg">
          We turned thinking into an ad marketplace. 50% of revenue goes to you.
        </p>

        <div className="mt-12 w-full">
          <DemoBlock />
        </div>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Button
            asChild
            size="lg"
            className="h-12 bg-primary px-6 text-base font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90"
          >
            <Link href="/login">Install VS Code extension</Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="h-12 px-6 text-base font-semibold"
          >
            <Link href="/advertiser">Advertise</Link>
          </Button>
        </div>

        <div className="mt-8 w-full">
          <TrustStrip />
        </div>
      </div>
    </section>
  );
}
