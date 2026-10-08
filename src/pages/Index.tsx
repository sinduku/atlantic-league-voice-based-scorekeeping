import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, FileSpreadsheet, FileText, Keyboard, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { PlayCard } from "@/components/PlayCard";
import { SprayChart } from "@/components/SprayChart";
import { Scoreboard } from "@/components/Scoreboard";
import { LineScore } from "@/components/LineScore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { createGame, deletePlay, savePlay, type SaveResult } from "@/lib/persistence";
import { normalizePlay } from "@/lib/normalizePlay";
import { parseShorthand } from "@/lib/shorthand";
import { correctNames, loadNameIndex, type NameIndex } from "@/lib/correctNames";
import { checkPlay } from "@/lib/checkPlay";
import { inningLabel, type LoggedPlay, type Team } from "@/lib/boxScore";
import { battingCsv, downloadCsv, fileBaseName, playByPlayCsv, type GameInfo } from "@/lib/exportCsv";
import { type Play, type GameState, INITIAL_GAME_STATE, applyPlayToState } from "@/types/game";

// VITE_PARSE_URL points straight at a deployed endpoint - the GitHub Pages
// build uses the Supabase edge function, since a static site cannot hold the
// AI key. Without it, local dev talks to the Express server in server/.
const PARSE_PLAY_URL =
  import.meta.env.VITE_PARSE_URL ||
  `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/api/parse-play`;

// past this the scorer is better off trying again than waiting
const PARSE_TIMEOUT_MS = 10000;

const DEFAULT_TEAMS: Record<Team, string> = { away: "Away", home: "Home" };

interface ParseInfo {
  source: "shorthand" | "ai";
  ms: number;
  model?: string;
}

// The game in progress is kept in the browser, so a refresh or a closed tab
// mid-game doesn't lose it. Reset clears it.
const STORAGE_KEY = "voice-scorekeeper:game";

interface SavedGame {
  log: LoggedPlay[];
  gameState: GameState;
  teamNames: Record<Team, string>;
  gameId: string | null;
  startedAt: string;
}

function loadSavedGame(): SavedGame | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedGame;
    return Array.isArray(saved.log) && saved.gameState ? saved : null;
  } catch {
    return null;
  }
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const Index = () => {
  const [restored] = useState(loadSavedGame);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentPlay, setCurrentPlay] = useState<Play | null>(null);
  const [lastTranscript, setLastTranscript] = useState("");
  const [log, setLog] = useState<LoggedPlay[]>(restored?.log ?? []);
  const [gameState, setGameState] = useState<GameState>(restored?.gameState ?? INITIAL_GAME_STATE);
  const [teamNames, setTeamNames] = useState<Record<Team, string>>(restored?.teamNames ?? DEFAULT_TEAMS);
  const [startedAt, setStartedAt] = useState(restored?.startedAt ?? new Date().toISOString());
  const [savedCount, setSavedCount] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [parseInfo, setParseInfo] = useState<ParseInfo | null>(null);
  const [typed, setTyped] = useState("");

  const confirmedPlays = log.map((e) => e.play);

  // the player list loads once, after the page, and is ready long before the
  // first play is spoken
  const nameIndex = useRef<NameIndex | null>(null);
  useEffect(() => {
    loadNameIndex()
      .then((index) => {
        nameIndex.current = index;
      })
      .catch((e) => console.warn("Player names did not load; names won't be corrected", e));
  }, []);

  // holds the in-flight (or finished) game insert so rapid confirmations share
  // one game row instead of each creating their own
  const gameRequest = useRef<Promise<SaveResult<string>> | null>(
    restored?.gameId ? Promise.resolve({ ok: true, data: restored.gameId }) : null
  );
  const gameId = useRef<string | null>(restored?.gameId ?? null);

  useEffect(() => {
    if (restored?.log.length) toast(`Picked up your game where you left off (${restored.log.length} plays).`);
  }, [restored]);

  useEffect(() => {
    try {
      const saved: SavedGame = { log, gameState, teamNames, gameId: gameId.current, startedAt };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // private windows can refuse storage; the game still works, it just won't survive a refresh
    }
  }, [log, gameState, teamNames, startedAt, savedCount]);

  const ensureGame = async () => {
    if (!gameRequest.current) {
      gameRequest.current = createGame(teamNames.home, teamNames.away);
    }
    const result = await gameRequest.current;
    // a failed insert shouldn't poison the rest of the game, so let the next
    // confirmed play try again
    if ("error" in result) {
      gameRequest.current = null;
    } else {
      gameId.current = result.data;
    }
    return result;
  };

  const showPlay = (play: Play, info: ParseInfo) => {
    const checked = checkPlay(play, gameState);
    setCurrentPlay(checked.play);
    setWarnings(checked.warnings);
    setParseInfo(info);
    console.info(
      `[parse] ${info.source}${info.model ? ` (${info.model})` : ""} in ${info.ms}ms`,
      checked.warnings.length ? checked.warnings : ""
    );
  };

  const handleTranscript = async (rawTranscript: string) => {
    const started = performance.now();
    const transcript = correctNames(rawTranscript, nameIndex.current);
    setLastTranscript(transcript);
    setCurrentPlay(null);
    setWarnings([]);
    setParseInfo(null);

    // plain shorthand ("6-3", "K looking") is scored right here, no network
    const local = parseShorthand(transcript, gameState);
    if (local) {
      showPlay(local, { source: "shorthand", ms: Math.round(performance.now() - started) });
      return;
    }

    setIsProcessing(true);
    try {
      const response = await fetch(PARSE_PLAY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, gameState }),
        signal: AbortSignal.timeout(PARSE_TIMEOUT_MS),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || "Failed to process play");
      }

      const data = await response.json();
      const parsed = normalizePlay(data?.play);
      if (parsed.ok) {
        showPlay(parsed.play, {
          source: "ai",
          ms: Math.round(performance.now() - started),
          model: data?.timing?.model,
        });
      } else {
        toast.error("Couldn't parse that into a play. Try again.");
      }
    } catch (e) {
      console.error(e);
      const err = e as Error;
      if (err?.name === "TimeoutError") toast.error("Parsing took too long. Try again.");
      else if (err instanceof TypeError) toast.error("Can't reach the parsing server. Is `npm start` running in server/?");
      else toast.error(err?.message || "Failed to process play");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTyped = (e: FormEvent) => {
    e.preventDefault();
    const text = typed.trim();
    if (!text || isProcessing) return;
    setTyped("");
    handleTranscript(text);
  };

  const handleConfirm = async () => {
    if (!currentPlay) return;

    // the play is accepted locally first so the scoreboard never waits on the
    // network; persistence catches up behind it
    const play = currentPlay;
    const playIndex = log.length;
    const before = gameState;
    const after = applyPlayToState(before, play);

    setLog((prev) => [...prev, { play, before, after }]);
    setGameState(after);
    toast.success(after.inning !== before.inning || after.half !== before.half ? `Play confirmed. Side retired, ${inningLabel(after)}.` : "Play confirmed!");
    setCurrentPlay(null);
    setWarnings([]);
    setLastTranscript("");

    const game = await ensureGame();
    if ("error" in game) {
      setSaveError(game.error);
      return;
    }

    const saved = await savePlay(game.data, playIndex, play);
    if ("error" in saved) {
      setSaveError(saved.error);
    } else {
      setSavedCount((prev) => prev + 1);
      setSaveError(null);
    }
  };

  const handleReject = () => {
    setCurrentPlay(null);
    setWarnings([]);
    toast("Play rejected. Try recording again.");
  };

  const handleUndo = async () => {
    const last = log[log.length - 1];
    if (!last) return;
    const playIndex = log.length - 1;
    setLog((prev) => prev.slice(0, -1));
    setGameState(last.before);
    toast(`Undid: ${last.play.description}`);

    // take it out of the database too, so the next play can reuse its slot
    if (gameId.current) {
      const removed = await deletePlay(gameId.current, playIndex);
      if ("error" in removed) setSaveError(removed.error);
      else setSavedCount((prev) => Math.max(0, prev - 1));
    }
  };

  const handleNewGame = () => {
    setGameState(INITIAL_GAME_STATE);
    setLog([]);
    setCurrentPlay(null);
    setWarnings([]);
    setLastTranscript("");
    setStartedAt(new Date().toISOString());
    // drop the old game row so the next play opens a fresh one
    gameRequest.current = null;
    gameId.current = null;
    setSavedCount(0);
    setSaveError(null);
    toast.success("New game started!");
  };

  // Enter confirms the play under review, Escape rejects it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!currentPlay || isTyping(e.target)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        handleConfirm();
      } else if (e.key === "Escape") {
        handleReject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });


  const exportPdf = async () => {
    try {
      const { exportPdf } = await import("@/lib/exportPdf");
      exportPdf(log, gameState, info());
    } catch (e) {
      console.error(e);
      toast.error("Couldn't build the PDF.");
    }
  };

  const setTeam = (team: Team, name: string) => setTeamNames((prev) => ({ ...prev, [team]: name }));
  const teamLabel = (team: Team) => teamNames[team].trim() || DEFAULT_TEAMS[team];
  const shownTeams = { away: teamLabel("away"), home: teamLabel("home") };
  const info = (): GameInfo => ({ teamNames: shownTeams, date: new Date(startedAt) });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-primary text-primary-foreground">
        <div className="max-w-7xl mx-auto px-4 py-4 lg:px-8 flex flex-wrap items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-accent-foreground font-bold text-sm">
            ⚾
          </div>
          <div className="flex-1 min-w-[10rem]">
            <h1 className="text-lg font-bold tracking-tight">Voice Scorekeeper</h1>
            <p className="text-xs opacity-75">Atlantic League Baseball</p>
          </div>

          <Button
            size="sm"
            variant="secondary"
            onClick={handleUndo}
            disabled={log.length === 0}
            title="Take back the last confirmed play"
          >
            <Undo2 className="w-4 h-4 mr-1" /> Undo
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary" disabled={log.length === 0}>
                <Download className="w-4 h-4 mr-1" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Export this game</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={exportPdf}>
                <FileText className="w-4 h-4 mr-2" /> Game report (PDF)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => downloadCsv(`${fileBaseName(info())}-plays.csv`, playByPlayCsv(log, info()))}>
                <FileSpreadsheet className="w-4 h-4 mr-2" /> Play-by-play (CSV)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => downloadCsv(`${fileBaseName(info())}-batting.csv`, battingCsv(log, info()))}>
                <FileSpreadsheet className="w-4 h-4 mr-2" /> Batting stats (CSV)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive">
                <RotateCcw className="w-4 h-4 mr-1" /> Reset
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Start a new game?</AlertDialogTitle>
                <AlertDialogDescription>
                  This clears the scoreboard and all {log.length} confirmed plays from this screen. Export the game
                  first if you want to keep it.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep scoring</AlertDialogCancel>
                <AlertDialogAction onClick={handleNewGame}>Start new game</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 lg:px-8 space-y-6">
        {/* Teams */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Input
            aria-label="Away team"
            value={teamNames.away}
            onChange={(e) => setTeam("away", e.target.value)}
            placeholder="Away team"
            className="w-44 font-semibold"
          />
          <span className="text-muted-foreground">at</span>
          <Input
            aria-label="Home team"
            value={teamNames.home}
            onChange={(e) => setTeam("home", e.target.value)}
            placeholder="Home team"
            className="w-44 font-semibold"
          />
        </div>

        {/* Scoreboard */}
        <Scoreboard state={gameState} teamNames={shownTeams} />
        <LineScore log={log} state={gameState} teamNames={shownTeams} />

        {/* Whether confirmed plays are actually reaching the database */}
        {(savedCount > 0 || saveError) && (
          <div
            className={`rounded-lg px-3 py-2 text-xs ${
              saveError ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
            }`}
          >
            {saveError
              ? `Not saving to database: ${saveError}`
              : `${savedCount} ${savedCount === 1 ? "play" : "plays"} saved to database`}
          </div>
        )}

        {/* two columns on wide screens: scoring on the left, the game so far on
            the right. phones stack them in the same order */}
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <section className="space-y-6" aria-label="Score a play">
            {/* Voice recorder */}
            <div className="bg-card border rounded-xl p-6 space-y-5">
              <VoiceRecorder onTranscriptReady={handleTranscript} isProcessing={isProcessing} />

              {/* typing is the fallback when the mic or the room won't cooperate */}
              <form onSubmit={handleTyped} className="flex gap-2 max-w-md mx-auto">
                <div className="relative flex-1">
                  <Keyboard className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder='Or type a play: "6-3", "Judge doubles to left"'
                    className="pl-9"
                    aria-label="Type a play"
                    disabled={isProcessing}
                  />
                </div>
                <Button type="submit" variant="outline" disabled={!typed.trim() || isProcessing}>
                  Score
                </Button>
              </form>
            </div>

            {/* Transcript shown while processing */}
            {isProcessing && lastTranscript && (
              <div className="bg-muted rounded-lg p-4 text-sm animate-pulse">
                <span className="text-xs uppercase tracking-wider text-muted-foreground block mb-1">
                  Processing
                </span>
                <p>"{lastTranscript}"</p>
              </div>
            )}

            {/* Current play for review */}
            {currentPlay && (
              <div>
                <div className="flex items-baseline justify-between gap-3 mb-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    Review This Play
                  </h2>
                  {parseInfo && (
                    <span className="text-xs text-muted-foreground">
                      {parseInfo.source === "shorthand" ? "Shorthand" : "AI"} · {(parseInfo.ms / 1000).toFixed(1)}s
                    </span>
                  )}
                </div>
                {lastTranscript && (
                  <p className="text-xs text-muted-foreground mb-3">Heard: "{lastTranscript}"</p>
                )}
                {warnings.length > 0 && (
                  <ul className="mb-3 rounded-lg bg-warning/15 text-foreground text-sm px-4 py-3 space-y-1 list-disc list-inside">
                    {warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
                <PlayCard play={currentPlay} onConfirm={handleConfirm} onReject={handleReject} />
                <p className="text-xs text-muted-foreground mt-2 text-center">Enter to confirm · Esc to reject</p>
              </div>
            )}
          </section>

          <section className="space-y-6" aria-label="Game so far">
            {/* Confirmed plays log */}
            <div className="bg-card border rounded-xl p-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Confirmed Plays ({log.length})
                </h2>
                {log.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={handleUndo} className="h-7 text-xs">
                    <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove last
                  </Button>
                )}
              </div>
              {log.length === 0 ? (
                <p className="text-sm text-muted-foreground">No plays yet.</p>
              ) : (
                <div className="space-y-2 lg:max-h-[28rem] lg:overflow-y-auto lg:pr-1">
                  {[...log].reverse().map(({ play, before, after }, i) => {
                    const team = before.half === "top" ? "away" : "home";
                    const runs = after.score[team] - before.score[team];
                    return (
                      <div key={log.length - i} className="bg-muted rounded-lg p-3 text-sm flex items-center gap-3">
                        <span className="shrink-0 w-8 text-xs text-muted-foreground tabular-nums">{inningLabel(before)}</span>
                        <span className="shrink-0 text-xs bg-primary text-primary-foreground rounded px-2 py-0.5 uppercase font-bold">
                          {play.action}
                        </span>
                        <span className="text-foreground flex-1 min-w-0">
                          {play.description}
                          {play.hit_type && play.hit_location && (
                            <span className="text-muted-foreground text-xs ml-2">
                              — {play.hit_type} to {play.hit_location}
                            </span>
                          )}
                        </span>
                        {runs > 0 && (
                          <span className="shrink-0 text-xs text-accent font-bold">
                            +{runs} {runs === 1 ? "run" : "runs"}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Spray Chart */}
            <SprayChart plays={confirmedPlays} teamNames={shownTeams} />
          </section>
        </div>
      </main>
    </div>
  );
};

export default Index;
