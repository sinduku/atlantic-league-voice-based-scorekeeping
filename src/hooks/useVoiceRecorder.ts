import { useState, useCallback, useRef, useEffect } from "react";

interface UseVoiceRecorderOptions {
  // called once per recording with what was said
  onFinished: (transcript: string) => void;
  // send on its own after this long without new speech. 0 waits for a tap
  silenceMs?: number;
}

interface UseVoiceRecorderReturn {
  isRecording: boolean;
  transcript: string;
  startRecording: () => void;
  // stops listening and sends what was heard so far
  finish: () => void;
  error: string | null;
}

// Chrome usually marks a phrase final within half a second of a pause. If a
// result is still interim after this long the speaker has almost certainly
// stopped, so send it rather than wait on the recognizer.
const INTERIM_GRACE_MS = 1800;

export function useVoiceRecorder({ onFinished, silenceMs = 0 }: UseVoiceRecorderOptions): UseVoiceRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef("");
  const sentRef = useRef(true);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // the latest callback, so a recognizer started earlier never calls a stale one
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const clearTimer = () => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = null;
  };

  const finish = useCallback(() => {
    clearTimer();
    if (recognitionRef.current) {
      recognitionRef.current.onresult = null;
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
    if (sentRef.current) return;
    sentRef.current = true;
    const said = transcriptRef.current.trim();
    if (said) onFinishedRef.current(said);
  }, []);

  const startRecording = useCallback(() => {
    setError(null);
    setTranscript("");
    transcriptRef.current = "";

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError("Speech recognition is not supported in this browser. Try Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      setIsRecording(true);
    };

    recognition.onresult = (event: any) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
      }
      transcriptRef.current = text;
      setTranscript(text);

      if (silenceMs > 0) {
        clearTimer();
        const lastIsFinal = event.results[event.results.length - 1]?.isFinal;
        silenceTimer.current = setTimeout(finish, lastIsFinal ? silenceMs : Math.max(silenceMs, INTERIM_GRACE_MS));
      }
    };

    recognition.onerror = (event: any) => {
      // "no-speech" and "aborted" are just a quiet mic or a tap, not failures
      if (event.error !== "no-speech" && event.error !== "aborted") {
        setError(`Speech recognition error: ${event.error}`);
      }
      clearTimer();
      sentRef.current = true;
      recognitionRef.current = null;
      setIsRecording(false);
    };

    // the browser can end a session on its own (a long pause, a lost mic);
    // whatever was heard still gets sent
    recognition.onend = () => {
      if (recognitionRef.current === recognition) finish();
    };

    sentRef.current = false;
    recognitionRef.current = recognition;
    recognition.start();
  }, [finish, silenceMs]);

  useEffect(
    () => () => {
      clearTimer();
      if (recognitionRef.current) {
        sentRef.current = true;
        recognitionRef.current.abort();
      }
    },
    []
  );

  return { isRecording, transcript, startRecording, finish, error };
}
