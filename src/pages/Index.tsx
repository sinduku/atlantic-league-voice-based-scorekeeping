import { useState } from "react";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { PlayCard } from "@/components/PlayCard";
import { SprayChart } from "@/components/SprayChart";
import { Scoreboard } from "@/components/Scoreboard";
import { toast } from "sonner";
import { type Play, type GameState, INITIAL_GAME_STATE, applyPlayToState } from "@/types/game";

const Index = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentPlay, setCurrentPlay] = useState<Play | null>(null);
  const [lastTranscript, setLastTranscript] = useState("");
  const [confirmedPlays, setConfirmedPlays] = useState<Play[]>([]);
  const [gameState, setGameState] = useState<GameState>(INITIAL_GAME_STATE);

  const handleTranscript = async (transcript: string) => {
    setLastTranscript(transcript);
    setIsProcessing(true);
    setCurrentPlay(null);

    try {
      const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:3001";
      const response = await fetch(`${apiUrl}/api/parse-play`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, gameState }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || "Failed to process play");
      }

      const data = await response.json();
      if (data?.play) {
        setCurrentPlay(data.play);
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

  const handleConfirm = () => {
    if (currentPlay) {
      setConfirmedPlays((prev) => [currentPlay, ...prev]);
      setGameState((prev) => applyPlayToState(prev, currentPlay));
      toast.success("Play confirmed!");
      setCurrentPlay(null);
      setLastTranscript("");
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
    toast.success("New game started!");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-primary text-primary-foreground">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
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

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-8">
        {/* Scoreboard */}
        <Scoreboard state={gameState} />

        {/* Voice recorder */}
        <VoiceRecorder onTranscriptReady={handleTranscript} isProcessing={isProcessing} />

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

        {/* Spray Chart */}
        <SprayChart plays={confirmedPlays} />

        {/* Confirmed plays log */}
        {confirmedPlays.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Confirmed Plays ({confirmedPlays.length})
            </h2>
            <div className="space-y-3">
              {confirmedPlays.map((play, i) => (
                <div key={i} className="bg-muted rounded-lg p-3 text-sm flex items-center gap-3">
                  <span className="text-xs bg-primary text-primary-foreground rounded px-2 py-0.5 uppercase font-bold">
                    {play.action}
                  </span>
                  <span className="text-foreground flex-1">
                    {play.description}
                    {play.hit_type && play.hit_location && (
                      <span className="text-muted-foreground text-xs ml-2">
                        — {play.hit_type} to {play.hit_location}
                      </span>
                    )}
                  </span>
                  {play.rbi > 0 && (
                    <span className="text-xs text-accent font-bold">{play.rbi} RBI</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Index;
