import { useEffect, useRef, useState } from "react";

export interface UseLocalStreamResult {
  stream: MediaStream | null;
  error: string | null;
  isLoading: boolean;
}

/**
 * Requests microphone access once on mount and cleans up the tracks on
 * unmount. Deliberately requests ONLY audio (per the spec — no camera,
 * no screen, nothing beyond what voice chat needs).
 */
export function useLocalStream(): UseLocalStreamResult {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        setStream(s);
        setIsLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || "Could not access microphone");
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { stream, error, isLoading };
}
