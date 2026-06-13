"use client";

// Grafico ad area minimale in SVG puro (niente dipendenze). Usato nella dashboard advertiser.
type Point = { day: number; value: number };

export function AreaChart({
  data,
  label,
  format,
  color = "hsl(var(--primary))",
}: {
  data: Point[];
  label: string;
  format: (value: number) => string;
  color?: string;
}) {
  const width = 100;
  const height = 36;
  const max = Math.max(1, ...data.map((point) => point.value));
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const coords = data.map((point, index) => ({
    x: index * step,
    y: height - (point.value / max) * (height - 4) - 2,
  }));
  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const total = data.reduce((sum, point) => sum + point.value, 0);
  const gradientId = `grad-${label.replace(/\s/g, "")}`;

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-sm font-semibold tabular-nums">{format(total)}</p>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="mt-3 h-24 w-full">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="mt-2 text-[11px] text-muted-foreground">Ultimi 14 giorni</p>
    </div>
  );
}
