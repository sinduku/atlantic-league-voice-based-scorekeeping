import { useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";

interface VoiceRecorderProps {
  onTranscriptReady: (transcript: string) => void;
  isProcessing: boolean;
}

// how long a pause ends a play when auto-send is on. long enough for a breath
// mid-sentence, short enough not to feel like waiting
const AUTO_SEND_SILENCE_MS = 1000;
const AUTO_SEND_KEY = "voice-scorekeeper:auto-send";

function readAutoSend(): boolean {
  try {
    return localStorage.getItem(AUTO_SEND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function VoiceRecorder({ onTranscriptReady, isProcessing }: VoiceRecorderProps) {
  const [autoSend, setAutoSend] = useState(readAutoSend);
  const { isRecording, transcript, startRecording, finish, error } = useVoiceRecorder({
    onFinished: onTranscriptReady,
    silenceMs: autoSend ? AUTO_SEND_SILENCE_MS : 0,
  });

  const toggleAutoSend = (on: boolean) => {
    setAutoSend(on);
    try {
      localStorage.setItem(AUTO_SEND_KEY, on ? "on" : "off");
    } catch {
      // private windows can refuse storage; the switch still works this visit
    }
  };

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Record button */}
      <div className="relative">
        {isRecording && (
          <div className="absolute inset-0 rounded-full bg-accent/30 animate-pulse-ring" />
        )}
        <Button
          size="lg"
          onClick={isRecording ? finish : startRecording}
          disabled={isProcessing}
          className={`w-24 h-24 rounded-full transition-all duration-300 ${
            isRecording
              ? "bg-accent hover:bg-accent/90 text-accent-foreground scale-110"
              : "bg-primary hover:bg-primary/90 text-primary-foreground"
          }`}
        >
          {isProcessing ? (
            <Loader2 className="w-8 h-8 animate-spin" />
          ) : isRecording ? (
            <Square className="w-8 h-8" />
          ) : (
            <Mic className="w-8 h-8" />
          )}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        {isProcessing
          ? "Parsing play..."
          : isRecording
          ? autoSend
            ? "Listening... sends when you pause"
            : "Listening... tap to stop"
          : "Tap to record a play"}
      </p>

      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
        <Switch checked={autoSend} onCheckedChange={toggleAutoSend} disabled={isRecording} />
        Send automatically when I stop talking
      </label>

      {/* Live transcript */}
      {transcript && (
        <div className="w-full max-w-md bg-muted rounded-lg p-4 text-sm">
          <span className="text-xs uppercase tracking-wider text-muted-foreground block mb-1">
            Transcript
          </span>
          <p className="text-foreground">{transcript}</p>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
