import Link from "next/link";

const DEVELOPER_STEPS = [
  {
    step: "01",
    title: "Install & sign in",
    body: "Add the VS Code extension and connect with Google. One verified human, one earning session — no bots, no multi-account farming.",
  },
  {
    step: "02",
    title: "Code like always",
    body: "When Claude thinks, the native spinner becomes a sponsored line — same place, same style. Nothing interrupts your flow, and your prompts are never read.",
  },
  {
    step: "03",
    title: "Get paid to wait",
    body: "Every 5-second view credits your balance. 50% of the ad spend is yours. Cash out from your dashboard above $20.",
  },
];

const ADVERTISER_STEPS = [
  {
    step: "01",
    title: "Launch a campaign",
    body: "Set your ad line, bid (CPM) and budget. The budget is the payment — one click and you're live. No sales calls, no minimums beyond $20.",
  },
  {
    step: "02",
    title: "Win the continuous auction",
    body: "No 1,000-view blocks. Every impression is drawn with probability proportional to your bid. Raise it anytime; your traffic share updates instantly.",
  },
  {
    step: "03",
    title: "Reach verified developers",
    body: "Your ad shows only to authenticated humans, mid-build, fully attentive. Premium intent the display networks can't match.",
  },
];

function Track({
  label,
  steps,
  cta,
  href,
}: {
  label: string;
  steps: typeof DEVELOPER_STEPS;
  cta: string;
  href: string;
}) {
  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
      <ol className="mt-6 flex flex-col gap-6">
        {steps.map((item) => (
          <li key={item.step} className="flex gap-4">
            <span className="font-mono text-sm tabular-nums text-primary">{item.step}</span>
            <div>
              <h3 className="text-base font-semibold tracking-tight">{item.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <Link
        href={href}
        className="mt-6 inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline"
      >
        {cta} →
      </Link>
    </div>
  );
}

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <h2 className="max-w-2xl text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          A two-sided marketplace for the seconds you already spend waiting.
        </h2>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          Developers monetize their attention. Advertisers buy the highest-intent inventory in
          software. We keep 50% and align everyone around real, verified human views.
        </p>
        <div className="mt-14 grid gap-14 md:grid-cols-2">
          <Track
            label="For developers"
            steps={DEVELOPER_STEPS}
            cta="Start earning"
            href="/login"
          />
          <Track
            label="For advertisers"
            steps={ADVERTISER_STEPS}
            cta="Launch a campaign"
            href="/advertiser"
          />
        </div>
      </div>
    </section>
  );
}
