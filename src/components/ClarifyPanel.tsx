import { useState } from "react";
import { HelpCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ClarifyOption, Question } from "@/lib/clarify";

interface ClarifyPanelProps {
  question: Question;
  // how many questions are still open, this one included
  remaining: number;
  answered: number;
  onPick: (option: ClarifyOption) => void;
  onText: (text: string) => void;
  onSkip: () => void;
  onStartOver: () => void;
}

// One question at a time: each answer can change what the next one should
// offer, so they are never shown all at once.
export function ClarifyPanel({ question, remaining, answered, onPick, onText, onSkip, onStartOver }: ClarifyPanelProps) {
  const [name, setName] = useState("");

  return (
    <section
      aria-label="A detail the play needs"
      aria-live="polite"
      className="rounded-xl border-2 border-primary/40 bg-primary/5 p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
          <HelpCircle className="w-4 h-4" />
          {question.required ? "Needs a detail" : "Optional detail"}
        </span>
        <span className="text-xs text-muted-foreground">
          {remaining === 1 ? "Last question" : `${remaining} questions left`}
        </span>
      </div>

      <div>
        <p className="font-semibold text-foreground">{question.prompt}</p>
        <p className="text-xs text-muted-foreground">{question.situation}</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {question.options.map((option, i) => (
          <Button
            key={option.id}
            variant="outline"
            onClick={() => onPick(option)}
            className={`h-auto min-h-10 justify-start whitespace-normal text-left py-2 ${option.likely ? "border-primary/60" : ""}`}
          >
            {i < 9 && (
              <kbd className="mr-2 shrink-0 rounded border bg-muted px-1.5 text-[11px] font-mono text-muted-foreground">
                {i + 1}
              </kbd>
            )}
            <span className="flex-1">{option.label}</span>
            {option.likely && <span className="ml-2 shrink-0 text-[10px] uppercase tracking-wider text-primary">usual</span>}
          </Button>
        ))}
      </div>

      {question.textEntry && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) {
              onText(name);
              setName("");
            }
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={question.textEntry.placeholder}
            aria-label={question.textEntry.placeholder}
          />
          <Button type="submit" variant="secondary" disabled={!name.trim()}>
            Save
          </Button>
        </form>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Tap an answer, press its number, or just say it.</span>
        <span className="flex gap-1">
          {!question.required && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onSkip}>
              Skip
            </Button>
          )}
          {answered > 0 && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onStartOver}>
              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Start over
            </Button>
          )}
        </span>
      </div>
    </section>
  );
}
