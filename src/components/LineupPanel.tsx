import { useState, type FormEvent } from "react";
import { ArrowRightLeft, Minus, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Team } from "@/lib/boxScore";
import {
  SLOTS,
  changePitcher,
  cleanName,
  currentBatter,
  currentPitcher,
  hasBattingOrder,
  ordinal,
  otherTeam,
  parseBattingOrder,
  substitute,
  type Lineups,
  type TeamLineup,
} from "@/lib/lineup";
import { inningsPitched, pitcherKey, type PitchingLine } from "@/lib/pitching";

interface LineupPanelProps {
  lineups: Lineups;
  teamNames: Record<Team, string>;
  batting: Team;
  dueUp: Record<Team, number>;
  pitching: PitchingLine[];
  pitchCounts: Record<string, number>;
  onChange: (team: Team, lineup: TeamLineup) => void;
  onMarkDueUp: (team: Team, slot: number) => void;
  onPitch: (team: Team, pitcher: string, delta: number) => void;
}

export function LineupPanel(props: LineupPanelProps) {
  const { lineups, teamNames, batting, dueUp, pitching, pitchCounts, onPitch } = props;
  const [tab, setTab] = useState<Team>(batting);

  const fielding = otherTeam(batting);
  const pitcher = currentPitcher(lineups[fielding]);
  const line = pitcher ? pitching.find((p) => p.team === fielding && p.name.toLowerCase() === pitcher.toLowerCase()) : null;
  const pitches = pitcher ? pitchCounts[pitcherKey(fielding, pitcher)] ?? 0 : 0;
  const order = lineups[batting];

  return (
    <div className="bg-card border rounded-xl p-6 space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Lineups</h2>

      {/* the matchup now, with the pitch counter where a thumb can reach it */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-muted px-4 py-3 text-sm">
          <span className="text-xs uppercase tracking-wider text-muted-foreground block">At bat · {teamNames[batting]}</span>
          {hasBattingOrder(order) ? (
            <>
              <p className="font-semibold">
                {currentBatter(order, dueUp[batting])}{" "}
                <span className="font-normal text-muted-foreground">({ordinal(dueUp[batting] + 1)})</span>
              </p>
              <p className="text-xs text-muted-foreground">On deck: {currentBatter(order, (dueUp[batting] + 1) % SLOTS)}</p>
            </>
          ) : (
            <p className="text-muted-foreground">Enter a batting order to fill in batters</p>
          )}
        </div>

        <div className="rounded-lg bg-muted px-4 py-3 text-sm">
          <span className="text-xs uppercase tracking-wider text-muted-foreground block">Pitching · {teamNames[fielding]}</span>
          {pitcher ? (
            // stacked rather than side by side: in the two-column layout this
            // box is narrow, and the counter would squeeze the name out
            <div className="space-y-2">
              <div className="min-w-0">
                <p className="font-semibold truncate">{pitcher}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {line
                    ? `${inningsPitched(line.outs)} IP · ${line.h} H · ${line.r} R · ${line.bb} BB · ${line.k} K`
                    : "No batters faced yet"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  onClick={() => onPitch(fielding, pitcher, -1)}
                  disabled={pitches === 0}
                  aria-label="Take back one pitch"
                >
                  <Minus className="w-4 h-4" />
                </Button>
                <span className="w-10 text-center text-lg font-bold tabular-nums" aria-live="polite" title="Pitches thrown">
                  {pitches}
                </span>
                <Button size="sm" className="h-8" onClick={() => onPitch(fielding, pitcher, 1)} aria-label="Count a pitch">
                  <Plus className="w-4 h-4 mr-1" /> Pitch
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">Enter {teamNames[fielding]}'s pitcher to track pitching</p>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Team)}>
        <TabsList className="grid w-full grid-cols-2">
          {(["away", "home"] as Team[]).map((team) => (
            <TabsTrigger key={team} value={team} className="truncate">
              {teamNames[team]}
            </TabsTrigger>
          ))}
        </TabsList>
        {(["away", "home"] as Team[]).map((team) => (
          <TabsContent key={team} value={team} className="mt-4">
            <TeamCard team={team} {...props} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function TeamCard({ team, lineups, teamNames, dueUp, onChange, onMarkDueUp }: LineupPanelProps & { team: Team }) {
  const lineup = lineups[team];
  const empty = lineup.slots.length === 0 && lineup.pitchers.length === 0;
  const [editing, setEditing] = useState(empty);
  const [subbing, setSubbing] = useState<number | "pitcher" | null>(null);

  if (editing) {
    return (
      <LineupForm
        team={team}
        lineup={lineup}
        teamName={teamNames[team]}
        canCancel={!empty}
        onCancel={() => setEditing(false)}
        onSave={(next) => {
          onChange(team, next);
          setEditing(false);
        }}
      />
    );
  }

  const pitcher = currentPitcher(lineup);

  return (
    <div className="space-y-4">
      {hasBattingOrder(lineup) ? (
        <ol className="space-y-1">
          {lineup.slots.map((slot, i) => {
            const name = slot[slot.length - 1];
            const replaced = slot.slice(0, -1);
            const isUp = dueUp[team] === i;
            return (
              <li
                key={i}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${isUp ? "bg-accent/15" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => onMarkDueUp(team, i)}
                  className="w-6 shrink-0 text-xs text-muted-foreground tabular-nums hover:text-foreground"
                  title={`Make ${name} the batter due up`}
                  aria-label={`Make ${name} the batter due up`}
                >
                  {i + 1}
                </button>
                {subbing === i ? (
                  <NameEntry
                    label={`Substitute for ${name}`}
                    placeholder={`Replaces ${name}`}
                    onCancel={() => setSubbing(null)}
                    onSave={(sub) => {
                      onChange(team, substitute(lineup, i, sub));
                      setSubbing(null);
                    }}
                  />
                ) : (
                  <>
                    <span className="flex-1 min-w-0 truncate">
                      <span className="font-medium">{name}</span>
                      {replaced.length > 0 && (
                        <span className="text-xs text-muted-foreground"> for {replaced[replaced.length - 1]}</span>
                      )}
                    </span>
                    {isUp && (
                      <span className="shrink-0 text-[10px] uppercase tracking-wider font-semibold text-accent">Due up</span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs shrink-0"
                      onClick={() => setSubbing(i)}
                      title="Pinch hitter, pinch runner or defensive substitution"
                    >
                      <ArrowRightLeft className="w-3.5 h-3.5 mr-1" /> Sub
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">No batting order entered.</p>
      )}

      <div className="flex items-center gap-2 border-t pt-3 text-sm">
        <span className="text-muted-foreground shrink-0">Pitcher</span>
        {subbing === "pitcher" ? (
          <NameEntry
            label="New pitcher"
            placeholder={pitcher ? `Relieves ${pitcher}` : "Pitcher's name"}
            onCancel={() => setSubbing(null)}
            onSave={(name) => {
              onChange(team, changePitcher(lineup, name));
              setSubbing(null);
            }}
          />
        ) : (
          <>
            <span className="flex-1 min-w-0 truncate">
              <span className="font-medium">{pitcher ?? "Not entered"}</span>
              {lineup.pitchers.length > 1 && (
                <span className="text-xs text-muted-foreground"> · relieved {lineup.pitchers[lineup.pitchers.length - 2]}</span>
              )}
            </span>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs shrink-0" onClick={() => setSubbing("pitcher")}>
              <ArrowRightLeft className="w-3.5 h-3.5 mr-1" /> {pitcher ? "Change" : "Add"}
            </Button>
          </>
        )}
      </div>

      <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
        <Pencil className="w-3.5 h-3.5 mr-1" /> Edit lineup
      </Button>
    </div>
  );
}

// Editing corrects the card; it doesn't make substitutions. The batting order
// is replaced outright, and a changed pitcher name replaces the current
// pitcher rather than bringing in a reliever (that's what Change is for).
function LineupForm({
  team,
  lineup,
  teamName,
  canCancel,
  onCancel,
  onSave,
}: {
  team: Team;
  lineup: TeamLineup;
  teamName: string;
  canCancel: boolean;
  onCancel: () => void;
  onSave: (lineup: TeamLineup) => void;
}) {
  const [order, setOrder] = useState(lineup.slots.map((s) => s[s.length - 1]).join("\n"));
  const [pitcher, setPitcher] = useState(currentPitcher(lineup) ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseBattingOrder(order);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    const name = cleanName(pitcher);
    const earlier = lineup.pitchers.slice(0, -1);
    onSave({ slots: parsed.batters.map((b) => [b]), pitchers: name ? [...earlier, name] : earlier });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-sm">
        <span className="font-medium">{teamName} batting order</span>
        <span className="block text-xs text-muted-foreground">
          {SLOTS} players, one per line, leadoff first. Numbers and positions like "1. Juan Soto RF" are fine. Leave it
          empty to track pitching only.
        </span>
        <Textarea
          value={order}
          onChange={(e) => {
            setOrder(e.target.value);
            setError(null);
          }}
          rows={SLOTS}
          className="mt-1.5 font-mono text-sm"
          aria-label={`${teamName} batting order`}
          id={`${team}-batting-order`}
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium">Pitcher</span>
        <Input value={pitcher} onChange={(e) => setPitcher(e.target.value)} className="mt-1.5" aria-label={`${teamName} pitcher`} />
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm">
          Save lineup
        </Button>
        {canCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function NameEntry({
  label,
  placeholder,
  onSave,
  onCancel,
}: {
  label: string;
  placeholder: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <form
      className="flex flex-1 items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave(name);
      }}
    >
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
        placeholder={placeholder}
        aria-label={label}
        className="h-8 text-sm"
      />
      <Button type="submit" size="sm" className="h-8" disabled={!name.trim()}>
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" className="h-8" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}
