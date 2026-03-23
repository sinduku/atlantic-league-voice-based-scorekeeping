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
}

const confidenceColors: Record<string, string> = {
  high: "bg-success text-success-foreground",
  medium: "bg-warning text-warning-foreground",
  low: "bg-destructive text-destructive-foreground",
};

export function PlayCard({ play, onConfirm, onReject }: PlayCardProps) {
  return (
    <Card className="border-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold uppercase tracking-wide text-primary">
            {play.action}
          </h3>
          <Badge className={confidenceColors[play.confidence]}>
            {play.confidence === "low" && <AlertTriangle className="w-3 h-3 mr-1" />}
            {play.confidence} confidence
          </Badge>
        </div>
        {(play.inning || play.half) && (
          <p className="text-sm text-muted-foreground">
            {play.half && <span className="capitalize">{play.half}</span>}{" "}
            {play.inning && <span>Inning {play.inning}</span>}
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-foreground">{play.description}</p>

        <div className="grid grid-cols-2 gap-3 text-sm">
          {play.batter && (
            <div className="bg-muted rounded-md p-2">
              <span className="text-muted-foreground text-xs uppercase tracking-wider">Batter</span>
              <p className="font-semibold">{play.batter}</p>
            </div>
          )}
          {play.pitcher && (
            <div className="bg-muted rounded-md p-2">
              <span className="text-muted-foreground text-xs uppercase tracking-wider">Pitcher</span>
              <p className="font-semibold">{play.pitcher}</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-3 text-sm">
          <div className="bg-muted rounded-md px-3 py-1.5">
            <span className="text-muted-foreground">RBI:</span>{" "}
            <span className="font-bold">{play.rbi}</span>
          </div>
          <div className="bg-muted rounded-md px-3 py-1.5">
            <span className="text-muted-foreground">Outs:</span>{" "}
            <span className="font-bold">{play.outs_recorded}</span>
          </div>
          {play.fielders_involved.length > 0 && (
            <div className="bg-muted rounded-md px-3 py-1.5">
              <span className="text-muted-foreground">Fielders:</span>{" "}
              <span className="font-bold">{play.fielders_involved.join(" → ")}</span>
            </div>
          )}
        </div>

        {/* Hit Details */}
        {(play.hit_type || play.hit_location || play.hit_hardness) && (
          <div>
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Hit Details</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {play.hit_type && (
                <span className="bg-muted rounded-md px-3 py-1.5 text-sm font-semibold capitalize">{play.hit_type}</span>
              )}
              {play.hit_location && (
                <span className="bg-muted rounded-md px-3 py-1.5 text-sm">
                  <span className="text-muted-foreground">to </span>{play.hit_location}
                </span>
              )}
              {play.hit_hardness && (
                <Badge variant="secondary" className="capitalize">{play.hit_hardness} contact</Badge>
              )}
              {play.field_zone && (
                <span className="bg-muted rounded-md px-3 py-1.5 text-sm">
                  <span className="text-muted-foreground">Zone</span> {play.field_zone}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Pitch Info */}
        {(play.pitch_type || play.pitch_location || play.count) && (
          <div>
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Pitch Info</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {play.pitch_type && (
                <span className="bg-muted rounded-md px-3 py-1.5 text-sm font-semibold capitalize">{play.pitch_type}</span>
              )}
              {play.pitch_location && (
                <span className="bg-muted rounded-md px-3 py-1.5 text-sm capitalize">{play.pitch_location}</span>
              )}
              {play.count && (
                <span className="bg-muted rounded-md px-3 py-1.5 text-sm">
                  <span className="text-muted-foreground">Count:</span> {play.count}
                </span>
              )}
            </div>
          </div>
        )}

        {play.runners.length > 0 && (
          <div>
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Runners</span>
            <div className="mt-1 space-y-1">
              {play.runners.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-sm bg-muted rounded-md px-3 py-1.5">
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

      <CardFooter className="gap-3 pt-4">
        <Button onClick={onConfirm} className="flex-1 bg-success hover:bg-success/90 text-success-foreground">
          <Check className="w-4 h-4 mr-2" /> Confirm
        </Button>
        <Button onClick={onReject} variant="outline" className="flex-1 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground">
          <X className="w-4 h-4 mr-2" /> Reject
        </Button>
      </CardFooter>
    </Card>
  );
}
