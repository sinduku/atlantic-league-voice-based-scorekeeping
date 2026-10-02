import { useRef, useState } from "react";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { PlayCard } from "@/components/PlayCard";
import { SprayChart } from "@/components/SprayChart";
import { Scoreboard } from "@/components/Scoreboard";
import { toast } from "sonner";
import { createGame, savePlay, type SaveResult } from "@/lib/persistence";
import { normalizePlay } from "@/lib/normalizePlay";
import { type Play, type GameState, INITIAL_GAME_STATE, applyPlayToState } from "@/types/game";

// VITE_PARSE_URL points straight at a deployed endpoint - the GitHub Pages
// build uses the Supabase edge function, since a static site cannot hold the
// AI key. Without it, local dev talks to the Express server in server/.
const PARSE_PLAY_URL =
  import.meta.env.VITE_PARSE_URL ||
  `${import.meta.env.VITE_API_URL || "http://localhost:3001"}/api/parse-play`;

const Index = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentPlay, setCurrentPlay] = useState<Play | null>(null);
  const [lastTranscript, setLastTranscript] = useState("");
  const [confirmedPlays, setConfirmedPlays] = useState<Play[]>([]);
  const [gameState, setGameState] = useState<GameState>(INITIAL_GAME_STATE);
  const [savedCount, setSavedCount] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);

  // holds the in-flight (or finished) game insert so rapid confirmations share
  // one game row instead of each creating their own
  const gameRequest = useRef<Promise<SaveResult<string>> | null>(null);

  const ensureGame = async () => {
    if (!gameRequest.current) {
      gameRequest.current = createGame();
    }
    const result = await gameRequest.current;
    // a failed insert shouldn't poison the rest of the game, so let the next
    // confirmed play try again
    if (!result.ok) {
      gameRequest.current = null;
    }
    return result;
  };

  const handleTranscript = async (transcript: string) => {
    setLastTranscript(transcript);
    setIsProcessing(true);
    setCurrentPlay(null);

    try {
      const response = await fetch(PARSE_PLAY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, gameState }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || "Failed to process play");
      }

      const data = await response.json();
      const parsed = normalizePlay(data?.play);
      if (parsed.ok) {
        setCurrentPlay(parsed.play);
      } else {
        toast.error("Couldn't parse that into a play. Try again.");
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Failed to process play");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirm = async () => {
    if (!currentPlay) return;

    // the play is accepted locally first so the scoreboard never waits on the
    // network; persistence catches up behind it
    const play = currentPlay;
    const playIndex = confirmedPlays.length;

    setConfirmedPlays((prev) => [play, ...prev]);
    setGameState((prev) => applyPlayToState(prev, play));
    toast.success("Play confirmed!");
    setCurrentPlay(null);
    setLastTranscript("");

    const game = await ensureGame();
    if (!game.ok) {
      setSaveError(game.error);
      return;
    }

    const saved = await savePlay(game.data, playIndex, play);
    if (saved.ok) {
      setSavedCount((prev) => prev + 1);
      setSaveError(null);
    } else {
      setSaveError(saved.error);
    }
  };

  const handleReject = () => {
    setCurrentPlay(null);
    toast("Play rejected. Try recording again.");
  };

  const handleNewGame = () => {
    setGameState(INITIAL_GAME_STATE);
    setConfirmedPlays([]);
    setCurrentPlay(null);
    setLastTranscript("");
    // drop the old game row so the next play opens a fresh one
    gameRequest.current = null;
    setSavedCount(0);
    setSaveError(null);
    toast.success("New game started!");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-primary text-primary-foreground">
        <div className="max-w-7xl mx-auto px-4 py-4 lg:px-8 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-accent-foreground font-bold text-sm">
            ⚾
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-bold tracking-tight">Voice Scorekeeper</h1>
            <p className="text-xs opacity-75">Atlantic League Baseball</p>
          </div>
          <button
            onClick={handleNewGame}
            className="text-xs bg-destructive/10 text-destructive hover:bg-destructive/20 px-3 py-1.5 rounded-md transition-colors"
          >
            Reset Game
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 lg:px-8 space-y-6">
        {/* Scoreboard */}
        <Scoreboard state={gameState} />

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
            <div className="bg-card border rounded-xl p-6">
              <VoiceRecorder onTranscriptReady={handleTranscript} isProcessing={isProcessing} />
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
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Review This Play
                </h2>
                <PlayCard play={currentPlay} onConfirm={handleConfirm} onReject={handleReject} />
              </div>
            )}
          </section>

          <section className="space-y-6" aria-label="Game so far">
            {/* Confirmed plays log */}
            <div className="bg-card border rounded-xl p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Confirmed Plays ({confirmedPlays.length})
              </h2>
              {confirmedPlays.length === 0 ? (
                <p className="text-sm text-muted-foreground">No plays yet.</p>
              ) : (
                <div className="space-y-2 lg:max-h-[28rem] lg:overflow-y-auto lg:pr-1">
                  {confirmedPlays.map((play, i) => (
                    <div key={i} className="bg-muted rounded-lg p-3 text-sm flex items-center gap-3">
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
                      {play.rbi > 0 && (
                        <span className="shrink-0 text-xs text-accent font-bold">{play.rbi} RBI</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Spray Chart */}
            <SprayChart plays={confirmedPlays} />
          </section>
        </div>
      </main>
    </div>
  );
};

export default Index;