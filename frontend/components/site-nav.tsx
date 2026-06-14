import Link from "next/link";

const navLinkClass =
  "font-sans text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground";

const btnBase =
  "items-center justify-center whitespace-nowrap rounded-none px-5 py-3 font-mono text-[13px] font-medium uppercase tracking-[0.04em] transition-colors duration-150";

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-[14px]">
      <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="text-xl font-bold tracking-tight">
          Paidwaits
          <span className="ml-0.5 align-super text-[11px] font-normal text-muted-foreground">®</span>
        </Link>

        <div className="flex items-center gap-6">
          {/* Portal access */}
          <Link href="/advertiser/login" className={`hidden min-[900px]:inline ${navLinkClass}`}>
            Advertiser Console
          </Link>
          <Link href="/login" className={`hidden min-[900px]:inline ${navLinkClass}`}>
            Earner Portal
          </Link>

          {/* CTA */}
          <Link
            href="/login"
            className={`inline-flex ${btnBase} border border-foreground bg-foreground text-background hover:border-primary hover:bg-primary hover:text-white`}
          >
            Install extension
          </Link>
        </div>
      </div>
    </header>
  );
}
