import type { GameState } from "@/types/game";

interface ScoreboardProps {
  state: GameState;
  teamNames?: { away: string; home: string };
  // from the lineups, when entered
  atBat?: string | null;
  pitcher?: string | null;
  pitches?: number | null;
  // balls and strikes on the batter now
  count?: { balls: number; strikes: number };
}

const Dots = ({ n, of, color, label }: { n: number; of: number; color: string; label: string }) => (
  <div className="flex gap-1 justify-center" aria-label={`${n} ${label}`}>
    {Array.from({ length: of }, (_, i) => (
      <div key={i} className={`w-3 h-3 rounded-full border-2 ${i < n ? color : "bg-transparent border-muted-foreground/40"}`} />
    ))}
  </div>
);

export function Scoreboard({ state, teamNames = { away: "Away", home: "Home" }, atBat, pitcher, pitches, count = { balls: 0, strikes: 0 } }: ScoreboardProps) {
  const bases = [
    { key: "second" as const, cx: 40, cy: 12 },
    { key: "third" as const, cx: 18, cy: 34 },
    { key: "first" as const, cx: 62, cy: 34 },
  ];

  return (
    <div className="bg-card border rounded-xl px-3 py-2.5">
      {/* five readings in one row, narrow enough for the scoring column */}
      <div className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] items-center gap-x-3">
        {/* Inning */}
        <div className="text-center">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Inning</span>
          {state.final ? (
            <span className="text-xl font-bold text-foreground whitespace-nowrap">
              Final{state.inning !== 9 ? <span className="text-base font-semibold">/{state.inning}</span> : null}
            </span>
          ) : (
            <span className="text-xl font-bold text-foreground whitespace-nowrap">
              {state.half === "top" ? "▲" : "▼"} {state.inning}
            </span>
          )}
        </div>

        {/* Diamond */}
        <svg viewBox="0 0 80 56" className="w-14 h-10">
          {/* Base paths */}
          <polygon
            points="40,48 18,34 40,12 62,34"
            fill="none"
            className="stroke-muted-foreground/40"
            strokeWidth="1.5"
          />
          {/* Bases */}
          {bases.map((b) => (
            <rect
              key={b.key}
              x={b.cx - 5}
              y={b.cy - 5}
              width={10}
              height={10}
              transform={`rotate(45 ${b.cx} ${b.cy})`}
              className={
                state.runners[b.key]
                  ? "fill-accent stroke-accent"
                  : "fill-muted stroke-muted-foreground/40"
              }
              strokeWidth="1"
            />
          ))}
          {/* Home plate */}
          <rect
            x={35}
            y={43}
            width={10}
            height={10}
            transform="rotate(45 40 48)"
            className="fill-foreground"
          />
        </svg>

        {/* Score */}
        <div className="text-center">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Score</span>
          <span className="text-xl font-bold text-foreground whitespace-nowrap tabular-nums">
            {state.score.away} – {state.score.home}
          </span>
          <span className="block text-[10px] text-muted-foreground truncate">
            {teamNames.away} – {teamNames.home}
          </span>
        </div>

        {/* Count: three balls and two strikes are the most a batter can stand on */}
        {!state.final && (
          <div className="text-center">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">
              Count <span className="tabular-nums font-semibold text-foreground">{count.balls}-{count.strikes}</span>
            </span>
            <div className="mt-1 space-y-1">
              <Dots n={Math.min(count.balls, 3)} of={3} color="bg-success border-success" label="balls" />
              <Dots n={Math.min(count.strikes, 2)} of={2} color="bg-warning border-warning" label="strikes" />
            </div>
          </div>
        )}

        {/* Outs */}
        <div className="text-center">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">Outs</span>
          <div className="flex gap-1 mt-1 justify-center">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`w-3.5 h-3.5 rounded-full border-2 ${
                  i < state.outs
                    ? "bg-destructive border-destructive"
                    : "bg-transparent border-muted-foreground/40"
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {(atBat || pitcher) && (
        <div className="mt-2 pt-2 border-t flex flex-wrap justify-center gap-x-4 gap-y-0.5 text-xs">
          {atBat && (
            <span>
              <span className="text-muted-foreground">At bat </span>
              <span className="font-semibold">{atBat}</span>
            </span>
          )}
          {pitcher && (
            <span>
              <span className="text-muted-foreground">Pitching </span>
              <span className="font-semibold">{pitcher}</span>
              {pitches != null && <span className="text-muted-foreground tabular-nums"> · {pitches} pitches</span>}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
