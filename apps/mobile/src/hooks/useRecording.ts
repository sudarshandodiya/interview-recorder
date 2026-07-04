import { useCallback, useEffect, useRef, useState } from "react";
import type { Recording } from "@interview-recorder/shared";
import {
  recordingService,
  type RecordingState,
  type RecordingStatusUpdate,
} from "../services/recordingService.js";
import { upsertRecording } from "../services/localStore.js";
import { AUDIO_MIME_TYPE } from "../utils/constants.js";

// ---------------------------------------------------------------------------
// useRecording hook (T-010)
//
// Combines the RecordingService (expo-av) with the LocalStore so that:
//   - start() begins a durable recording (session manifest written for crash recovery)
//   - stop() finalizes the audio file AND persists a Recording entry with status `local`
//   - pause()/resume() operate on the single-file-with-gaps model
//   - metering + duration are exposed for live UI (T-011)
//
// The returned Recording from stop() is ready for the sync engine (T-015)
// to pick up and upload.
// ---------------------------------------------------------------------------

export interface UseRecordingReturn {
  state: RecordingState;
  durationMs: number;
  metering: number | undefined;
  start: () => Promise<string>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<Recording | null>;
  cancel: () => Promise<void>;
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
}

export function useRecording(): UseRecordingReturn {
  const [state, setState] = useState<RecordingState>("idle");
  const [durationMs, setDurationMs] = useState(0);
  const [metering, setMetering] = useState<number | undefined>(undefined);
  const [hasPermission, setHasPermission] = useState(false);

  // Keep latest metadata ref so stop() can create the Recording entry
  const pendingMetadata = useRef<{
    sessionId: string;
    startedAt: string;
  }>({ sessionId: "", startedAt: "" });

  // Subscribe to recording service status updates
  useEffect(() => {
    recordingService.setStatusCallback((update: RecordingStatusUpdate) => {
      setState(update.state);
      setDurationMs(update.durationMs);
      setMetering(update.metering);
    });

    return () => {
      recordingService.setStatusCallback(() => {});
    };
  }, []);

  const requestPermission = useCallback(async () => {
    const granted = await recordingService.requestPermissions();
    setHasPermission(granted);
    return granted;
  }, []);

  const start = useCallback(async () => {
    const startedAt = new Date().toISOString();
    const sessionId = await recordingService.start();
    pendingMetadata.current = { sessionId, startedAt };
    setState("recording");
    return sessionId;
  }, []);

  const pause = useCallback(async () => {
    await recordingService.pause();
    setState("paused");
  }, []);

  const resume = useCallback(async () => {
    await recordingService.resume();
    setState("recording");
  }, []);

  const stop = useCallback(async (): Promise<Recording | null> => {
    const result = await recordingService.stop();
    setState("stopped");

    // Persist the recording in the local store with status `local`
    const now = new Date().toISOString();
    const recording: Recording = {
      id: result.sessionId,
      userId: "", // Filled by auth/sync layer (T-005 stub auth)
      title: "Untitled",
      intervieweeName: "Unknown",
      role: undefined,
      tags: [],
      notes: undefined,
      durationMs: result.durationMs,
      fileSizeBytes: result.fileSizeBytes,
      mimeType: AUDIO_MIME_TYPE,
      status: "local",
      s3Key: null,
      localUri: result.uri,
      createdAt: pendingMetadata.current.startedAt || now,
      updatedAt: now,
    };

    await upsertRecording(recording);

    // Reset state for the next recording
    setState("idle");
    setDurationMs(0);
    setMetering(undefined);

    return recording;
  }, []);

  const cancel = useCallback(async () => {
    await recordingService.cancel();
    setState("idle");
    setDurationMs(0);
    setMetering(undefined);
    pendingMetadata.current = { sessionId: "", startedAt: "" };
  }, []);

  return {
    state,
    durationMs,
    metering,
    start,
    pause,
    resume,
    stop,
    cancel,
    hasPermission,
    requestPermission,
  };
}