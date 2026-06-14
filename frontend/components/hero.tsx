import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DemoBlock } from "@/components/demo-block";
import { TrustStrip } from "@/components/trust-strip";

export function Hero() {
  return (
    <section className="px-3 pb-16 pt-10 sm:px-4 sm:pt-16">
      <div className="mx-auto max-w-6xl px-3 sm:px-6">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
          {/* Left: copy */}
          <div className="flex flex-col items-start text-left">
            <h1 className="text-balance text-5xl font-bold leading-[0.95] tracking-tighter sm:text-6xl lg:text-7xl">
              AI thinks.
              <br />
              Get paid for <span className="text-primary">waiting.</span>
            </h1>

            <p className="mt-6 max-w-md text-balance text-base text-muted-foreground sm:text-lg">
              We turned thinking into an ad marketplace. 50% of revenue goes to you.
            </p>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="h-12 rounded-none border border-foreground bg-foreground px-6 font-mono text-[13px] uppercase tracking-[0.04em] text-background shadow-none transition-colors duration-150 hover:border-primary hover:bg-primary hover:text-white"
              >
                <Link href="/login">
                  Install VS Code extension <span aria-hidden>↗</span>
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-12 rounded-none border border-foreground bg-transparent px-6 font-mono text-[13px] uppercase tracking-[0.04em] text-foreground shadow-none transition-colors duration-150 hover:bg-foreground hover:text-background"
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

      {/* Trust strip */}
      <div className="mx-auto mt-12 max-w-6xl px-3 sm:px-4">
        <TrustStrip />
      </div>
    </section>
  );
}
