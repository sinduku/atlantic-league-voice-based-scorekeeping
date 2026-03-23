import { Mic, Square, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";

interface VoiceRecorderProps {
  onTranscriptReady: (transcript: string) => void;
  isProcessing: boolean;
}

export function VoiceRecorder({ onTranscriptReady, isProcessing }: VoiceRecorderProps) {
  const { isRecording, transcript, startRecording, stopRecording, error } = useVoiceRecorder();

  const handleStop = () => {
    stopRecording();
    if (transcript.trim()) {
      onTranscriptReady(transcript.trim());
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
          onClick={isRecording ? handleStop : startRecording}
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
          ? "Listening... tap to stop"
          : "Tap to record a play"}
      </p>

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
