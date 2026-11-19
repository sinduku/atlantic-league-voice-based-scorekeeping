import { useState } from "react";
import { Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { Team } from "@/lib/boxScore";
import type { Challenge, Play } from "@/types/game";

interface ChallengeDialogProps {
  index: number;
  play: Play;
  teamNames: Record<Team, string>;
  // the team in the field, who usually challenges a call that went against them
  fielding: Team;
  disabled?: boolean;
  onSave: (index: number, challenge: Challenge | null) => void;
}

// Records a manager's challenge of the call on a play. An overturned call
// goes on to scoring the play again the way the review saw it.
export function ChallengeDialog({ index, play, teamNames, fielding, disabled, onSave }: ChallengeDialogProps) {
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState<Team>(play.challenge?.team ?? fielding);
  const [result, setResult] = useState<Challenge["result"]>(play.challenge?.result ?? "stands");
  const [note, setNote] = useState(play.challenge?.note ?? "");

  const reset = () => {
    setTeam(play.challenge?.team ?? fielding);
    setResult(play.challenge?.result ?? "stands");
    setNote(play.challenge?.note ?? "");
  };

  const choice = (selected: boolean) => (selected ? "default" : "outline");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className={`h-7 w-7 ${play.challenge ? "text-amber-600" : ""}`}
          disabled={disabled}
          title={play.challenge ? `Challenge on play #${index + 1}` : `Challenge play #${index + 1}`}
          aria-label={play.challenge ? `Challenge on play #${index + 1}` : `Challenge play #${index + 1}`}
        >
          <Flag className="w-3.5 h-3.5" fill={play.challenge ? "currentColor" : "none"} />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Challenge on play #{index + 1}</DialogTitle>
          <DialogDescription>"{play.description}"</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <fieldset className="space-y-2">
            <legend className="font-medium">Who challenged?</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["away", "home"] as Team[]).map((t) => (
                <Button key={t} type="button" variant={choice(team === t)} onClick={() => setTeam(t)} aria-pressed={team === t} className="truncate">
                  {teamNames[t]}
                </Button>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="font-medium">What did the review say?</legend>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant={choice(result === "stands")} onClick={() => setResult("stands")} aria-pressed={result === "stands"}>
                Call stands
              </Button>
              <Button type="button" variant={choice(result === "overturned")} onClick={() => setResult("overturned")} aria-pressed={result === "overturned"}>
                Overturned
              </Button>
            </div>
            {result === "overturned" && (
              <p className="text-xs text-muted-foreground">
                After saving, say or type the play the way the review saw it. Everything after it is worked out again.
              </p>
            )}
          </fieldset>

          <label className="block space-y-1">
            <span className="font-medium">Note (optional)</span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder='e.g. "tag beat the runner"' maxLength={120} />
          </label>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {play.challenge ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                onSave(index, null);
                setOpen(false);
              }}
            >
              Remove challenge
            </Button>
          ) : (
            <span />
          )}
          <Button
            type="button"
            onClick={() => {
              onSave(index, { team, result, note: note.trim() || null });
              setOpen(false);
            }}
          >
            Save challenge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
