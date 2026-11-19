import { Check, X, AlertTriangle, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";

interface Play {
  inning?: number | null;
  half?: string | null;
  batter?: string | null;
  pitcher?: string | null;
  action: string;
  description: string;
  runners: { from: string; to: string; runner?: string | null }[];
  rbi: number;
  outs_recorded: number;
  fielders_involved: string[];
  hit_location?: string | null;
  hit_type?: string | null;
  hit_hardness?: string | null;
  field_zone?: number | null;
  pitch_type?: string | null;
  pitch_location?: string | null;
  count?: string | null;
  confidence: "high" | "medium" | "low";
}

interface PlayCardProps {
  play: Play;
  onConfirm: () => void;
  onReject: () => void;
  // while the scorer still owes an answer about the play
  confirmDisabled?: boolean;
}

const confidenceColors: Record<string, string> = {
  high: "bg-success text-success-foreground",
  medium: "bg-warning text-warning-foreground",
  low: "bg-destructive text-destructive-foreground",
};

export function PlayCard({ play, onConfirm, onReject, confirmDisabled = false }: PlayCardProps) {
  return (
    <Card className="border-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-bold uppercase tracking-wide text-primary">
            {play.action}
          </h3>
          <Badge className={confidenceColors[play.confidence]}>
            {play.confidence === "low" && <AlertTriangle className="w-3 h-3 mr-1" />}
            {play.confidence} confidence
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-2.5 px-4 pb-2 text-sm">
        <p className="text-foreground text-[0.95rem]">{play.description}</p>

        <div className="flex flex-wrap gap-1.5 text-xs">
          {play.batter && (
            <div className="bg-muted rounded-md px-2.5 py-1">
              <span className="text-muted-foreground">Batter:</span> <span className="font-semibold">{play.batter}</span>
            </div>
          )}
          {play.pitcher && (
            <div className="bg-muted rounded-md px-2.5 py-1">
              <span className="text-muted-foreground">Pitcher:</span> <span className="font-semibold">{play.pitcher}</span>
            </div>
          )}
          <div className="bg-muted rounded-md px-2.5 py-1">
            <span className="text-muted-foreground">RBI:</span>{" "}
            <span className="font-bold">{play.rbi}</span>
          </div>
          <div className="bg-muted rounded-md px-2.5 py-1">
            <span className="text-muted-foreground">Outs:</span>{" "}
            <span className="font-bold">{play.outs_recorded}</span>
          </div>
          {play.fielders_involved.length > 0 && (
            <div className="bg-muted rounded-md px-2.5 py-1">
              <span className="text-muted-foreground">Fielders:</span>{" "}
              <span className="font-bold">{play.fielders_involved.join(" → ")}</span>
            </div>
          )}
        </div>

        {/* where the ball went and the pitch, as one row of chips */}
        {(play.hit_type || play.hit_location || play.hit_hardness || play.pitch_type || play.count) && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            {play.hit_type && <span className="bg-muted rounded-md px-2 py-1 font-semibold capitalize">{play.hit_type}</span>}
            {play.hit_location && (
              <span className="bg-muted rounded-md px-2 py-1">
                <span className="text-muted-foreground">to </span>
                {play.hit_location}
              </span>
            )}
            {play.hit_hardness && <span className="bg-muted rounded-md px-2 py-1 capitalize">{play.hit_hardness} contact</span>}
            {play.pitch_type && <span className="bg-muted rounded-md px-2 py-1 capitalize">{play.pitch_type}</span>}
            {play.pitch_location && <span className="bg-muted rounded-md px-2 py-1 capitalize">{play.pitch_location}</span>}
            {play.count && (
              <span className="bg-muted rounded-md px-2 py-1">
                <span className="text-muted-foreground">Count</span> {play.count}
              </span>
            )}
          </div>
        )}
        {play.runners.length > 0 && (
          <div>
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Runners</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {play.runners.map((r, i) => (
                <div key={i} className="flex items-center gap-1.5 text-sm bg-muted rounded-md px-2.5 py-1">
                  {r.runner && <span className="font-semibold">{r.runner}</span>}
                  <span>{r.from}</span>
                  <ChevronRight className="w-3 h-3 text-muted-foreground" />
                  <span>{r.to}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="gap-3 px-4 pb-3 pt-2 sticky bottom-0 z-10 bg-card rounded-b-xl border-t lg:shadow-[0_-4px_8px_-6px_rgba(0,0,0,0.15)]">
        <Button
          onClick={onConfirm}
          disabled={confirmDisabled}
          title={confirmDisabled ? "Answer the question above first" : undefined}
          className="flex-1 bg-success hover:bg-success/90 text-success-foreground"
        >
          <Check className="w-4 h-4 mr-2" /> Confirm
        </Button>
        <Button onClick={onReject} variant="outline" className="flex-1 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground">
          <X className="w-4 h-4 mr-2" /> Reject
        </Button>
      </CardFooter>
    </Card>
  );
}
