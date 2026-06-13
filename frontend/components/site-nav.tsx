import Link from "next/link";
import { Button } from "@/components/ui/button";

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center">
          <span className="text-lg font-semibold tracking-tight">Paidwaits</span>
        </Link>
        <nav className="flex items-center gap-1">
          <Link
            href="#how-it-works"
            className="hidden rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground sm:block"
          >
            How it works
          </Link>
          <Link
            href="/advertiser"
            className="hidden rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground sm:block"
          >
            For advertisers
          </Link>
          <Link
            href="/dashboard"
            className="hidden rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground sm:block"
          >
            Earnings
          </Link>
          <Link
            href="/login"
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            Sign in
          </Link>
          <Button
            asChild
            size="sm"
            className="ml-2 h-8 bg-foreground text-background transition-colors duration-150 hover:bg-foreground/90"
          >
            <Link href="/login">Install</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
