import { useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Play {
  action: string;
  batter?: string | null;
  hit_type?: string | null;
  hit_location?: string | null;
  field_zone?: number | null;
  [key: string]: any;
}

interface SprayChartProps {
  plays: Play[];
}

const ZONE_COORDS: Record<number, { x: number; y: number }> = {
  1: { x: 75, y: 95 },   // Left field line
  2: { x: 110, y: 65 },  // Left-center
  3: { x: 150, y: 50 },  // Center field
  4: { x: 190, y: 65 },  // Right-center
  5: { x: 225, y: 95 },  // Right field line
  6: { x: 110, y: 155 }, // Shortstop/3B area
  7: { x: 150, y: 140 }, // Second base area
  8: { x: 190, y: 155 }, // First base/2B area
  9: { x: 150, y: 200 }, // Infield/catcher area
};

const HIT_COLORS: Record<string, string> = {
  "ground ball": "hsl(30, 60%, 45%)",
  "line drive": "hsl(0, 70%, 50%)",
  "fly ball": "hsl(210, 70%, 50%)",
  "pop up": "hsl(0, 0%, 60%)",
  bunt: "hsl(45, 70%, 50%)",
};

const LEGEND = [
  { label: "Ground ball", color: HIT_COLORS["ground ball"] },
  { label: "Line drive", color: HIT_COLORS["line drive"] },
  { label: "Fly ball", color: HIT_COLORS["fly ball"] },
  { label: "Pop up", color: HIT_COLORS["pop up"] },
];

function jitter(base: number, index: number, spread = 8): number {
  const seed = ((index * 7 + 13) % 17) - 8;
  return base + (seed / 17) * spread;
}

export function SprayChart({ plays }: SprayChartProps) {
  const hitsWithZone = plays.filter((p) => p.field_zone && ZONE_COORDS[p.field_zone]);

  return (
    <div className="bg-card border rounded-xl p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Spray Chart
      </h2>

      <TooltipProvider delayDuration={0}>
        <svg viewBox="0 0 300 260" className="w-full max-w-md mx-auto">
          {/* Grass */}
          <path
            d="M150,230 L30,100 A170,170 0 0,1 270,100 Z"
            className="fill-accent/30 stroke-accent"
            strokeWidth="1.5"
          />

          {/* Infield dirt */}
          <polygon
            points="150,230 105,180 150,140 195,180"
            className="fill-muted stroke-muted-foreground/30"
            strokeWidth="1"
          />

          {/* Base paths */}
          <polygon
            points="150,230 105,180 150,140 195,180"
            fill="none"
            className="stroke-foreground/40"
            strokeWidth="1"
          />

          {/* Outfield arc */}
          <path
            d="M30,100 A170,170 0 0,1 270,100"
            fill="none"
            className="stroke-muted-foreground/40"
            strokeWidth="1"
            strokeDasharray="4 3"
          />

          {/* Foul lines */}
          <line x1="150" y1="230" x2="30" y2="100" className="stroke-foreground/20" strokeWidth="0.8" />
          <line x1="150" y1="230" x2="270" y2="100" className="stroke-foreground/20" strokeWidth="0.8" />

          {/* Bases */}
          <rect x="146" y="226" width="8" height="8" className="fill-foreground" transform="rotate(45 150 230)" />
          <rect x="101" y="176" width="7" height="7" className="fill-foreground" transform="rotate(45 104.5 179.5)" />
          <rect x="146.5" y="136.5" width="7" height="7" className="fill-foreground" transform="rotate(45 150 140)" />
          <rect x="191.5" y="176" width="7" height="7" className="fill-foreground" transform="rotate(45 195 179.5)" />

          {/* Hit markers */}
          {hitsWithZone.map((play, i) => {
            const zone = ZONE_COORDS[play.field_zone!];
            const cx = jitter(zone.x, i);
            const cy = jitter(zone.y, i);
            const color =
              HIT_COLORS[(play.hit_type || "").toLowerCase()] ||
              "hsl(var(--primary))";

            return (
              <Tooltip key={i}>
                <TooltipTrigger asChild>
                  <circle
                    cx={cx}
                    cy={cy}
                    r="5"
                    fill={color}
                    stroke="hsl(var(--card))"
                    strokeWidth="1.5"
                    className="cursor-pointer opacity-85 hover:opacity-100 transition-opacity"
                  />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p className="font-semibold">{play.batter || "Unknown"}</p>
                  <p className="text-muted-foreground capitalize">
                    {play.hit_type || play.action}
                    {play.hit_location && ` to ${play.hit_location}`}
                  </p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </svg>
      </TooltipProvider>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-3 mt-3">
        {LEGEND.map((item) => (
          <div key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="w-3 h-3 rounded-full inline-block"
              style={{ backgroundColor: item.color }}
            />
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}
