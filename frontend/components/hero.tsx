import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DemoBlock } from "@/components/demo-block";
import { TrustStrip } from "@/components/trust-strip";

export function Hero() {
  return (
    <section className="px-3 pb-16 pt-0 sm:px-4">
      {/* Hero panel */}
      <div className="overflow-hidden rounded-[2rem] border border-black/[0.06] bg-gradient-to-b from-[#FAF9F5] to-[#F2E5DC] shadow-sm">
        <div className="mx-auto max-w-6xl px-6 py-12 sm:px-10 sm:py-16 lg:px-16 lg:py-20">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
            {/* Left: copy */}
            <div className="flex flex-col items-start text-left">
              <Link
                href="#advertisers"
                className="mb-6 inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white/60 px-3 py-1 font-mono text-xs text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                </span>
                The attention layer for AI dev tools
              </Link>

              <h1 className="text-balance text-5xl font-bold tracking-tighter sm:text-6xl lg:text-7xl">
                AI thinks.
                <br />
                Get paid for waiting.
              </h1>

              <p className="mt-6 max-w-md text-balance text-base text-muted-foreground sm:text-lg">
                We turned thinking into an ad marketplace. 50% of revenue goes to you.
              </p>

              <div className="mt-10 flex flex-col gap-3 sm:flex-row">
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
                  className="h-12 border-black/[0.12] bg-white/40 px-6 text-base font-semibold"
                >
                  <Link href="/advertiser">Advertise</Link>
                </Button>
              </div>
            </div>

            {/* Right: demo */}
            <div className="w-full">
              <DemoBlock />
            </div>
          </div>
        </div>
      </div>

      {/* Trust strip — outside the panel */}
      <div className="mx-auto mt-10 max-w-6xl px-3 sm:px-4">
        <TrustStrip />
      </div>
    </section>
  );
}
