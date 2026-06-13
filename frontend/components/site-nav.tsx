import Link from "next/link";
import { Button } from "@/components/ui/button";

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md">
      <div className="relative mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center">
          <span className="text-xl font-semibold tracking-tight">Paidwaits</span>
        </Link>

        {/* Centered nav */}
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 sm:flex">
          <Link
            href="#how-it-works"
            className="rounded-md px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors duration-150 hover:bg-primary/10 hover:text-primary"
          >
            How it works
          </Link>
          <Link
            href="/advertiser"
            className="rounded-md px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors duration-150 hover:bg-primary/10 hover:text-primary"
          >
            Advertisers
          </Link>
        </nav>

        <div className="flex items-center gap-1">
          <Link
            href="/login"
            className="rounded-md px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors duration-150 hover:bg-primary/10 hover:text-primary"
          >
            Sign in
          </Link>
          <Button
            asChild
            size="sm"
            className="ml-2 h-9 bg-primary text-sm font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90"
          >
            <Link href="/login">Install</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
