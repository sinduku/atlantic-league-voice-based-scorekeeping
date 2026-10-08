import { useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Play } from "@/types/game";
import { BASES, FIELD, LEGEND, isBallInPlay, isHit, markerColor, sprayPoint, toXY } from "@/lib/sprayGeometry";
import { inningLabel, teamOf, type Team } from "@/lib/boxScore";

interface SprayChartProps {
  plays: Play[];
  teamNames: Record<Team, string>;
}

type Filter = "all" | Team;

const { home, fence, dirt } = FIELD;
const leftPole = toXY(-45, fence);
const rightPole = toXY(45, fence);
const leftDirt = toXY(-45, dirt);
const rightDirt = toXY(45, dirt);
const mound = toXY(0, 43);

export function SprayChart({ plays, teamNames }: SprayChartProps) {
  const [filter, setFilter] = useState<Filter>("all");

  // each ball keeps its place when the filter changes
  const inPlay = plays.filter(isBallInPlay).map((play, i) => ({ play, point: sprayPoint(play, i) }));
  const shown = inPlay.filter(({ play }) => filter === "all" || teamOf(play) === filter);
  const hits = shown.filter(({ play }) => isHit(play)).length;

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "away", label: teamNames.away },
    { key: "home", label: teamNames.home },
  ];

  return (
    <div className="bg-card border rounded-xl p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Spray Chart</h2>
        <div className="flex rounded-md border overflow-hidden text-xs" role="group" aria-label="Show batters from">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1 max-w-[7rem] truncate transition-colors ${
                filter === f.key ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
              aria-pressed={filter === f.key}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <TooltipProvider delayDuration={0}>
        <svg viewBox={`0 0 ${FIELD.width} ${FIELD.height}`} className="w-full max-w-md mx-auto" role="img" aria-label="Spray chart">
          {/* Fair territory */}
          <path
            d={`M${home.x},${home.y} L${leftPole.x},${leftPole.y} A${fence},${fence} 0 0,1 ${rightPole.x},${rightPole.y} Z`}
            fill="#dcefd5"
            stroke="#5f8f52"
            strokeWidth="1.5"
          />
          {/* Infield dirt */}
          <path
            d={`M${home.x},${home.y} L${leftDirt.x},${leftDirt.y} A${dirt},${dirt} 0 0,1 ${rightDirt.x},${rightDirt.y} Z`}
            fill="#ead9bf"
          />
          {/* Infield grass */}
          <polygon
            points={`${home.x},${home.y - 9} ${BASES.first.x - 9},${BASES.first.y} ${BASES.second.x},${BASES.second.y + 9} ${BASES.third.x + 9},${BASES.third.y}`}
            fill="#cfe6c6"
          />
          {/* Base paths and foul lines */}
          <polygon
            points={`${home.x},${home.y} ${BASES.first.x},${BASES.first.y} ${BASES.second.x},${BASES.second.y} ${BASES.third.x},${BASES.third.y}`}
            fill="none"
            stroke="#ffffff"
            strokeWidth="1.2"
          />
          <line x1={home.x} y1={home.y} x2={leftPole.x} y2={leftPole.y} stroke="#ffffff" strokeWidth="1.2" />
          <line x1={home.x} y1={home.y} x2={rightPole.x} y2={rightPole.y} stroke="#ffffff" strokeWidth="1.2" />
          <circle cx={mound.x} cy={mound.y} r="4" fill="#ead9bf" stroke="#c9b28e" />

          {/* Bases */}
          {[BASES.first, BASES.second, BASES.third].map((b, i) => (
            <rect key={i} x={b.x - 3.5} y={b.y - 3.5} width="7" height="7" fill="#ffffff" stroke="#9ca3af" transform={`rotate(45 ${b.x} ${b.y})`} />
          ))}
          <rect x={home.x - 4} y={home.y - 4} width="8" height="8" fill="#ffffff" stroke="#6b7280" transform={`rotate(45 ${home.x} ${home.y})`} />

          {/* Batted balls: filled for hits, hollow for outs */}
          {shown.map(({ play, point: { x, y } }, i) => {
            const color = markerColor(play);
            const hit = isHit(play);
            return (
              <Tooltip key={i}>
                <TooltipTrigger asChild>
                  <circle
                    cx={x}
                    cy={y}
                    r="5"
                    fill={hit ? color : "#ffffff"}
                    stroke={color}
                    strokeWidth={hit ? 1 : 2}
                    className="cursor-pointer"
                  />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p className="font-semibold">
                    {play.batter || "Unnamed batter"}
                    {play.inning ? (
                      <span className="text-muted-foreground font-normal">
                        {" "}· {inningLabel({ half: play.half === "bottom" ? "bottom" : "top", inning: play.inning })}
                      </span>
                    ) : null}
                  </p>
                  <p className="capitalize">{play.action}</p>
                  <p className="text-muted-foreground">
                    {[play.hit_type, play.hit_location && `to ${play.hit_location}`].filter(Boolean).join(" ")}
                  </p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </svg>
      </TooltipProvider>

      <p className="text-center text-xs text-muted-foreground mt-1">
        {shown.length === 0
          ? "Balls in play show up here once confirmed."
          : `${shown.length} ball${shown.length === 1 ? "" : "s"} in play · ${hits} hit${hits === 1 ? "" : "s"}`}
      </p>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2">
        {LEGEND.map((item) => (
          <div key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: item.color }} />
            {item.label}
          </div>
        ))}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="w-3 h-3 rounded-full inline-block border-2 border-muted-foreground bg-white" />
          Out (hollow)
        </div>
      </div>
    </div>
  );
}
