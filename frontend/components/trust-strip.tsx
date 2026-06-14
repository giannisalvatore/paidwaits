import type { SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-primary"
      {...props}
    >
      {children}
    </svg>
  );
}

const PROPS = [
  {
    label: "Anti-bot first",
    icon: (
      <Icon>
        <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
        <path d="m9 12 2 2 4-4" />
      </Icon>
    ),
  },
  {
    label: "Verified human views",
    icon: (
      <Icon>
        <path d="M20 6 9 17l-5-5" />
      </Icon>
    ),
  },
  {
    label: "50% revenue share",
    icon: (
      <Icon>
        <path d="M19 5 5 19" />
        <circle cx="6.5" cy="6.5" r="2.5" />
        <circle cx="17.5" cy="17.5" r="2.5" />
      </Icon>
    ),
  },
];

export function TrustStrip() {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2.5">
      {PROPS.map(({ label, icon }) => (
        <li
          key={label}
          className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground"
        >
          {icon}
          {label}
        </li>
      ))}
    </ul>
  );
}
