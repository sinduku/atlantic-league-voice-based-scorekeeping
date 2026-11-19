import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { GameState, Play } from "@/types/game";
import { BASES, FIELD, LEGEND, basePoint, isBallInPlay, isHit, markerColor, runnerPath, sprayPoint, toXY } from "@/lib/sprayGeometry";
import { inningLabel, teamOf, type Team } from "@/lib/boxScore";

interface SprayChartProps {
  // the confirmed plays in order, so each dot can name its play-by-play number
  plays: Play[];
  teamNames: Record<Team, string>;
  // the team at bat: the chart shows its balls in play, and switches when
  // the side changes
  batting: Team;
  // the play-by-play entry being pointed at, by its place in plays: its dot
  // is ringed and its runners' paths are drawn
  highlight?: number | null;
  // who is on base now, drawn on the diamond
  runners?: GameState["runners"];
  // a dot dragged to a new spot, or null to put it back where the words say
  onMove?: (index: number, point: { x: number; y: number } | null) => void;
  className?: string;
  // inside another card: no frame of its own, and no title
  bare?: boolean;
}

// last name only, so it fits beside a base
const short = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : parts[0];
};

const RUNNER_SPOTS = [
  { key: "first" as const, dx: 9, anchor: "start" as const },
  { key: "second" as const, dx: 0, dy: -10, anchor: "middle" as const },
  { key: "third" as const, dx: -9, anchor: "end" as const },
];

type Filter = "all" | Team;

const { home, fence, dirt } = FIELD;
const leftPole = toXY(-45, fence);
const rightPole = toXY(45, fence);
const leftDirt = toXY(-45, dirt);
const rightDirt = toXY(45, dirt);
const mound = toXY(0, 43);

export function SprayChart({ plays, teamNames, batting, highlight = null, runners, onMove, className = "", bare = false }: SprayChartProps) {
  const [filter, setFilter] = useState<Filter>(batting);
  // the dot being dragged and where it is now
  const [drag, setDrag] = useState<{ index: number; x: number; y: number; moved: boolean } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // follow the side at bat; the scorer can still pick another view until the
  // next change of sides
  useEffect(() => setFilter(batting), [batting]);

  // each ball keeps its place when the filter changes, and the same place as
  // in the PDF
  const inPlay = plays
    .map((play, index) => ({ play, index }))
    .filter(({ play }) => isBallInPlay(play))
    .map(({ play, index }, i) => ({ play, index, point: sprayPoint(play, i) }));
  const shown = inPlay.filter(({ play }) => filter === "all" || teamOf(play) === filter);
  const hits = shown.filter(({ play }) => isHit(play)).length;
  const lit = highlight != null ? plays[highlight] ?? null : null;

  // screen position to the chart's own units
  const toChart = (e: ReactPointerEvent) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: Math.max(4, Math.min(FIELD.width - 4, p.x)), y: Math.max(4, Math.min(FIELD.height - 4, p.y)) };
  };
  const startDrag = (e: ReactPointerEvent, index: number, x: number, y: number) => {
    if (!onMove || e.button !== 0) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ index, x, y, moved: false });
  };
  const moveDrag = (e: ReactPointerEvent) => {
    if (!drag) return;
    const p = toChart(e);
    if (p) setDrag({ ...drag, ...p, moved: drag.moved || Math.hypot(p.x - drag.x, p.y - drag.y) > 1.5 });
  };
  const endDrag = () => {
    if (drag?.moved && onMove) onMove(drag.index, { x: Math.round(drag.x * 10) / 10, y: Math.round(drag.y * 10) / 10 });
    setDrag(null);
  };

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "away", label: teamNames.away },
    { key: "home", label: teamNames.home },
  ];

  return (
    <div className={bare ? "" : "bg-card border rounded-xl p-4"}>
      <div className={`flex items-center gap-3 mb-2 ${bare ? "justify-end" : "justify-between"}`}>
        {!bare && <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Spray Chart</h2>}
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
        <svg
          ref={svgRef}
          viewBox={`0 0 ${FIELD.width} ${FIELD.height}`}
          className={`w-full mx-auto touch-none select-none ${className || "max-w-md"}`}
          role="img"
          aria-label="Spray chart"
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={() => setDrag(null)}
        >
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

          {/* the pointed-at play's runners, along the base paths */}
          {lit?.runners.map((r, i) => {
            const path = runnerPath(r.from, r.to);
            if (path.length < 2) return null;
            const end = path[path.length - 1];
            const out = r.to === "out";
            const color = out ? "#dc2626" : r.to === "home" ? "#16a34a" : "#1d4ed8";
            return (
              <g key={`run-${i}`} aria-hidden="true">
                <polyline points={path.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeDasharray={out ? "4 3" : undefined} opacity="0.85" />
                {out ? (
                  <text x={end.x} y={end.y + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill={color}>✕</text>
                ) : (
                  <circle cx={end.x} cy={end.y} r="3.5" fill={color} />
                )}
              </g>
            );
          })}

          {/* who is on base now */}
          {runners &&
            RUNNER_SPOTS.map(({ key, dx, dy = 0, anchor }) => {
              const name = runners[key];
              if (!name) return null;
              const b = basePoint(key);
              return (
                <g key={key} aria-label={`${name} on ${key}`}>
                  <circle cx={b.x} cy={b.y} r="5.5" fill="#f59e0b" stroke="#ffffff" strokeWidth="1.5" />
                  {name.toLowerCase() !== "runner" && (
                    <text x={b.x + dx} y={b.y + dy + (key === "second" ? 0 : 3)} textAnchor={anchor} fontSize="8.5" fontWeight="600" fill="#111827" stroke="#ffffff" strokeWidth="2.5" paintOrder="stroke">
                      {short(name)}
                    </text>
                  )}
                </g>
              );
            })}

          {/* Batted balls: filled for hits, hollow for outs */}
          {/* the pointed-at play last, so it draws on top */}
          {[...shown].sort((a, b) => Number(a.index === highlight) - Number(b.index === highlight)).map(({ play, index, point }) => {
            const color = markerColor(play);
            const hit = isHit(play);
            const on = index === highlight || drag?.index === index;
            const { x, y } = drag?.index === index ? drag : point;
            return (
              <Tooltip key={index}>
                <TooltipTrigger asChild>
                  <g
                    className={onMove ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}
                    onPointerDown={(e) => startDrag(e, index, x, y)}
                    onDoubleClick={() => play.spray && onMove?.(index, null)}
                  >
                    {on && <circle cx={x} cy={y} r="10" fill="none" stroke={color} strokeWidth="1.5" opacity="0.6" />}
                    {/* a bigger, invisible target, so a finger can grab it */}
                    <circle cx={x} cy={y} r="11" fill="transparent" />
                    <circle
                      cx={x}
                      cy={y}
                      r={on ? 6.5 : 5}
                      fill={hit ? color : "#ffffff"}
                      stroke={color}
                      strokeWidth={hit ? 1 : 2}
                    />
                  </g>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs max-w-[16rem]">
                  <p className="font-semibold">
                    <span className="text-muted-foreground font-normal">#{index + 1} </span>
                    {play.batter || "Unnamed batter"}
                    {play.inning ? (
                      <span className="text-muted-foreground font-normal">
                        {" "}· {inningLabel({ half: play.half === "bottom" ? "bottom" : "top", inning: play.inning })}
                      </span>
                    ) : null}
                  </p>
                  <p>{play.description}</p>
                  <p className="text-muted-foreground capitalize">
                    {[play.action, play.hit_type, play.hit_location && `to ${play.hit_location}`].filter(Boolean).join(" · ")}
                  </p>
                  {onMove && (
                    <p className="text-muted-foreground">
                      {play.spray ? "Moved by hand. Double-click to put it back." : "Drag to move it where the ball went."}
                    </p>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </svg>
      </TooltipProvider>

      <p className="text-center text-xs text-muted-foreground mt-1">
        {shown.length === 0
          ? "Balls in play show up here once confirmed."
          : `${shown.length} ball${shown.length === 1 ? "" : "s"} in play · ${hits} hit${hits === 1 ? "" : "s"}${onMove ? " · drag a dot to move it" : ""}`}
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
        {runners && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-3 h-3 rounded-full inline-block bg-amber-500" />
            On base
          </div>
        )}
      </div>
    </div>
  );
}
