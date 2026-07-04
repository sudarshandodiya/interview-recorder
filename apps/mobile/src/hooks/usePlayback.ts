import { useCallback, useEffect, useRef, useState } from "react";
import { Audio } from "expo-av";

// ---------------------------------------------------------------------------
// usePlayback (T-018) — seekable in-app audio player.
//
// Source preference: the local audio file when present (offline-capable),
// else the backend's presigned `/audio` URL via getAudioUrl().
// ---------------------------------------------------------------------------

export interface PlaybackState {
  isPlaying: boolean;
  isLoading: boolean;
  positionMs: number;
  durationMs: number;
  error: string | null;
}

const INITIAL: PlaybackState = {
  isPlaying: false,
  isLoading: false,
  positionMs: 0,
  durationMs: 0,
  error: null,
};

export function usePlayback() {
  const [state, setState] = useState<PlaybackState>(INITIAL);
  const soundRef = useRef<Audio.Sound | null>(null);

  // Teardown on unmount.
  useEffect(() => {
    return () => {
      void soundRef.current?.unloadAsync();
      soundRef.current = null;
    };
  }, []);

  const load = useCallback(async (source: string) => {
    setState({ ...INITIAL, isLoading: true });
    try {
      // Unload any previous instance first.
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      const { sound } = await Audio.Sound.createAsync({ uri: source });
      soundRef.current = sound;
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });
      const status = (await sound.getStatusAsync()) as {
        isLoaded: boolean;
        durationMillis?: number;
      };
      setState({
        ...INITIAL,
        isLoading: false,
        durationMs: status.durationMillis ?? 0,
      });
    } catch (err) {
      setState({
        ...INITIAL,
        error: `Failed to load: ${(err as Error).message}`,
      });
    }
  }, []);

  const play = useCallback(async () => {
    if (!soundRef.current) return;
    await soundRef.current.playAsync();
    setState((s) => ({ ...s, isPlaying: true }));
  }, []);

  const pause = useCallback(async () => {
    if (!soundRef.current) return;
    await soundRef.current.pauseAsync();
    setState((s) => ({ ...s, isPlaying: false }));
  }, []);

  const seek = useCallback(
    async (positionMs: number) => {
      if (!soundRef.current) return;
      await soundRef.current.setPositionAsync(positionMs);
      setState((s) => ({ ...s, positionMs }));
    },
    []
  );

  // Poll position while playing (cheap at ~500ms).
  useEffect(() => {
    if (!state.isPlaying) return;
    const id = setInterval(async () => {
      if (!soundRef.current) return;
      const st = await soundRef.current.getStatusAsync();
      const s = st as { isLoaded: boolean; positionMillis?: number; didJustFinish?: boolean };
      if (s.didJustFinish) {
        setState((prev) => ({ ...prev, isPlaying: false, positionMs: 0 }));
        return;
      }
      setState((prev) => ({ ...prev, positionMs: s.positionMillis ?? prev.positionMs }));
    }, 500);
    return () => clearInterval(id);
  }, [state.isPlaying]);

  return { state, load, play, pause, seek };
}

/** Format ms as M:SS. */
export function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}