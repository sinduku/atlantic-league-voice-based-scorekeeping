import type { GameState } from "@/types/game";
import { lineScore, type LoggedPlay, type Team } from "@/lib/boxScore";

interface LineScoreProps {
  log: LoggedPlay[];
  state: GameState;
  teamNames: Record<Team, string>;
  // scheduled innings, so a seven-inning game shows seven columns
  innings?: number;
}

export function LineScore({ log, state, teamNames, innings: scheduled }: LineScoreProps) {
  const score = lineScore(log, state, scheduled);
  const innings = Array.from({ length: score.innings }, (_, i) => i + 1);
  const batting: Team = state.half === "top" ? "away" : "home";
  // the home half of the last inning, when the home team was already ahead
  const skipped = (team: Team, i: number) => !!state.final && team === "home" && i + 1 === state.inning && state.half === "top";

  const row = (team: Team) => {
    const line = score[team];
    return (
      <tr key={team} className="border-t">
        <th scope="row" className="text-left font-semibold py-1.5 pr-3 max-w-[9rem] truncate">
          {batting === team && !state.final && <span className="text-accent mr-1" aria-label="batting">●</span>}
          {teamNames[team]}
        </th>
        {line.runsByInning.map((runs, i) => (
          <td
            key={i}
            className={`text-center tabular-nums px-1.5 ${
              i + 1 === state.inning && batting === team && !state.final ? "bg-accent/15 font-semibold" : ""
            } ${runs === null ? "text-muted-foreground/40" : ""}`}
          >
            {runs ?? (skipped(team, i) ? "X" : "–")}
          </td>
        ))}
        <td className="text-center tabular-nums px-2 font-bold border-l">{line.runs}</td>
        <td className="text-center tabular-nums px-2">{line.hits}</td>
        <td className="text-center tabular-nums px-2">{line.errors}</td>
        <td className="text-center tabular-nums px-2 text-muted-foreground">{line.lob}</td>
      </tr>
    );
  };

  return (
    <div className="bg-card border rounded-xl p-4 overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Line score</caption>
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="text-left font-medium pb-1"></th>
            {innings.map((i) => (
              <th key={i} scope="col" className="font-medium px-1.5 pb-1">
                {i}
              </th>
            ))}
            <th scope="col" className="font-semibold px-2 pb-1 border-l">R</th>
            <th scope="col" className="font-medium px-2 pb-1">H</th>
            <th scope="col" className="font-medium px-2 pb-1">E</th>
            <th scope="col" className="font-medium px-2 pb-1" title="Left on base">LOB</th>
          </tr>
        </thead>
        <tbody>
          {row("away")}
          {row("home")}
        </tbody>
      </table>
    </div>
  );
}
