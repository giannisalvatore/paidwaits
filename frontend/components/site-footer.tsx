import Link from "next/link";

const COLUMNS = [
  {
    heading: "Product",
    links: [
      { label: "How it works", href: "#how-it-works" },
      { label: "For advertisers", href: "/advertiser" },
      { label: "Earnings dashboard", href: "/dashboard" },
      { label: "Install extension", href: "/login" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "Sign in", href: "/login" },
      { label: "Privacy", href: "#" },
      { label: "Terms", href: "#" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-[1.5fr_1fr_1fr] sm:px-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-5 items-center rounded bg-primary px-1 font-mono text-[10px] font-bold text-primary-foreground">
              W$
            </span>
            <span className="text-sm font-semibold tracking-tight">Paidwaits</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            The attention layer for AI dev tools. Turning every spinner into a fair, verified
            marketplace.
          </p>
        </div>
        {COLUMNS.map((column) => (
          <nav key={column.heading} className="flex flex-col gap-3">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              {column.heading}
            </p>
            {column.links.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
          <p className="font-mono text-xs text-muted-foreground">© 2026 Paidwaits, Inc.</p>
          <p className="font-mono text-xs text-muted-foreground">
            Built for people who watch spinners professionally.
          </p>
        </div>
      </div>
    </footer>
  );
}
