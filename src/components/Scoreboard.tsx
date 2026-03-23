import type { GameState } from "@/types/game";

interface ScoreboardProps {
  state: GameState;
}

export function Scoreboard({ state }: ScoreboardProps) {
  const bases = [
    { key: "second" as const, cx: 40, cy: 12 },
    { key: "third" as const, cx: 18, cy: 34 },
    { key: "first" as const, cx: 62, cy: 34 },
  ];

  return (
    <div className="bg-card border rounded-xl p-4">
      <div className="flex items-center justify-between gap-4">
        {/* Inning */}
        <div className="text-center">
          <span className="text-xs uppercase tracking-wider text-muted-foreground block">Inning</span>
          <span className="text-2xl font-bold text-foreground">
            {state.half === "top" ? "▲" : "▼"} {state.inning}
          </span>
        </div>

        {/* Diamond */}
        <svg viewBox="0 0 80 56" className="w-20 h-14">
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
          <span className="text-xs uppercase tracking-wider text-muted-foreground block">Score</span>
          <span className="text-2xl font-bold text-foreground">
            {state.score.away} – {state.score.home}
          </span>
        </div>

        {/* Outs */}
        <div className="text-center">
          <span className="text-xs uppercase tracking-wider text-muted-foreground block">Outs</span>
          <div className="flex gap-1 mt-1 justify-center">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full border-2 ${
                  i < state.outs
                    ? "bg-destructive border-destructive"
                    : "bg-transparent border-muted-foreground/40"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
