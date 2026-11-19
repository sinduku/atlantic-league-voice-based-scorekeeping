import { useMemo } from "react";
import type { GameState } from "@/types/game";
import { lineScore, type LoggedPlay, type Team } from "@/lib/boxScore";
import { cellAt, isNow, scorecard, type ScorecardCell } from "@/lib/scorecard";

interface ScorecardProps {
  log: LoggedPlay[];
  state: GameState;
  team: Team;
  innings?: number;
  // the play-by-play entry pointed at, lit here too
  highlight?: number | null;
  onHighlight?: (index: number | null) => void;
  // the spot due up, marked on its row
  dueUp?: number | null;
}

// one scorebook box: a diamond with the bases the batter reached drawn in,
// filled when he scored, the result in the middle, the out he made in a
// circle, and how he moved later along the top
function Box({ cell, lit }: { cell: ScorecardCell; lit: boolean }) {
  const pts = { home: [24, 40], first: [40, 24], second: [24, 8], third: [8, 24] } as const;
  const path = [pts.home, pts.first, pts.second, pts.third, pts.home].slice(0, Math.min(cell.reached, 4) + 1);
  const ink = cell.scored ? "#15803d" : "#1e293b";
  return (
    <svg viewBox="0 0 48 48" className="w-full h-full" aria-hidden="true">
      {lit && <rect x="1" y="1" width="46" height="46" rx="4" fill="#fde68a" opacity="0.6" />}
      <polygon points="24,40 40,24 24,8 8,24" fill={cell.scored ? "#bbf7d0" : "none"} stroke="#cbd5e1" strokeWidth="1" />
      {path.length > 1 && <polyline points={path.map((p) => p.join(",")).join(" ")} fill="none" stroke={ink} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />}
      <text x="24" y="27.5" textAnchor="middle" fontSize={cell.notation.length > 5 ? 7 : 9.5} fontWeight="700" fill="#0f172a">
        {cell.notation}
      </text>
      {cell.out != null && (
        <g>
          <circle cx="7.5" cy="7.5" r="5.5" fill="#fee2e2" stroke="#dc2626" strokeWidth="1" />
          <text x="7.5" y="10.5" textAnchor="middle" fontSize="8" fontWeight="700" fill="#b91c1c">
            {cell.out}
          </text>
        </g>
      )}
      {cell.notes.length > 0 && (
        <text x="46" y="8" textAnchor="end" fontSize="6" fill="#475569">
          {cell.notes.join(" ").slice(0, 10)}
        </text>
      )}
      {cell.rbi > 0 && (
        <text x="2" y="46" fontSize="6" fill="#15803d" fontWeight="700">
          {cell.rbi} RBI
        </text>
      )}
      {cell.pitches > 0 && (
        <text x="46" y="46" textAnchor="end" fontSize="6" fill="#64748b">
          {cell.count ? `${cell.count} · ` : ""}
          {cell.pitches}p
        </text>
      )}
    </svg>
  );
}

export function Scorecard({ log, state, team, innings = 9, highlight = null, onHighlight, dueUp = null }: ScorecardProps) {
  const card = useMemo(() => scorecard(log, team, innings), [log, team, innings]);
  const line = useMemo(() => lineScore(log, state, innings), [log, state, innings]);
  const hitsByInning = useMemo(() => {
    const hits: Record<number, number> = {};
    for (const c of card.cells) if (["1B", "2B", "3B", "HR"].includes(c.notation)) hits[c.inning] = (hits[c.inning] ?? 0) + 1;
    return hits;
  }, [card]);

  return (
    <div className="overflow-auto">
      <table className="border-collapse text-xs" aria-label={`Scorecard`}>
        <thead className="sticky top-0 z-10 bg-card">
          <tr>
            <th className="sticky left-0 z-20 bg-card text-left font-medium text-muted-foreground px-2 py-1 min-w-[7.5rem]">Batter</th>
            {card.columns.map((col) => (
              <th
                key={`${col.inning}-${col.around}`}
                scope="col"
                className={`font-semibold px-0.5 py-1 w-14 ${isNow(state, team, col.inning) && col.around === 0 ? "text-accent" : "text-muted-foreground"}`}
              >
                {col.inning}
                {col.around > 0 && <span className="text-[9px] font-normal">·{col.around + 1}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {card.rows.map((row) => (
            <tr key={row.slot} className={dueUp === row.slot && !state.final ? "bg-accent/10" : ""}>
              <th scope="row" className="sticky left-0 z-10 bg-card text-left font-normal px-2 py-0.5 border-t align-middle">
                <span className="text-muted-foreground tabular-nums mr-1">{row.slot + 1}</span>
                <span className="font-semibold">{row.names[row.names.length - 1] ?? "—"}</span>
                {row.names.length > 1 && (
                  <span className="block text-[10px] text-muted-foreground truncate max-w-[7rem]">for {row.names.slice(0, -1).join(", ")}</span>
                )}
              </th>
              {card.columns.map((col) => {
                const cell = cellAt(card, row.slot, col);
                return (
                  <td
                    key={`${col.inning}-${col.around}`}
                    className={`border border-border p-0 w-14 h-14 ${isNow(state, team, col.inning) && col.around === 0 ? "bg-accent/5" : ""}`}
                    onMouseEnter={() => cell && onHighlight?.(cell.index)}
                    onMouseLeave={() => cell && onHighlight?.(null)}
                    title={cell ? `#${cell.index + 1} ${cell.batter ?? "Unnamed batter"}: ${cell.notation}${cell.notes.length ? `, then ${cell.notes.join(", ")}` : ""}${cell.scored ? ", scored" : ""}` : undefined}
                  >
                    {cell && <Box cell={cell} lit={cell.index === highlight} />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          {(["R", "H"] as const).map((stat) => (
            <tr key={stat} className="border-t-2">
              <th scope="row" className="sticky left-0 bg-card text-left px-2 py-0.5 font-semibold text-muted-foreground">
                {stat === "R" ? "Runs" : "Hits"}
              </th>
              {card.columns.map((col) => (
                <td key={`${col.inning}-${col.around}`} className="text-center tabular-nums py-0.5">
                  {col.around === 0
                    ? stat === "R"
                      ? line[team].runsByInning[col.inning - 1] ?? ""
                      : line[team].runsByInning[col.inning - 1] == null
                        ? ""
                        : hitsByInning[col.inning] ?? 0
                    : ""}
                </td>
              ))}
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  );
}
