import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import type { Href } from "expo-router";
import { useRecording } from "../src/hooks/useRecording";
import { Waveform } from "../src/components/Waveform";
import { upsertRecording } from "../src/services/localStore";
import { enqueueUpload } from "../src/services/syncEngine";
import { AUDIO_MIME_TYPE } from "../src/utils/constants";
import { formatTime } from "../src/hooks/usePlayback";
import type { Recording } from "@interview-recorder/shared";

// ---------------------------------------------------------------------------
// Recording screen — F1 (start/pause/resume/stop), F2 (waveform + timer),
// F3 (metadata capture on stop). Single-file-with-gaps pause model.
// ---------------------------------------------------------------------------

type Phase = "capturing" | "metadata" | "saving";

export default function RecordingScreen() {
  const router = useRouter();
  const rec = useRecording();

  // Metadata form state (F3).
  const [intervieweeName, setIntervieweeName] = useState("");
  const [role, setRole] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [notes, setNotes] = useState("");
  const [phase, setPhase] = useState<Phase>("capturing");
  const [lastRecording, setLastRecording] = useState<Recording | null>(null);
  const [nameErr, setNameErr] = useState(false);

  // Request mic permission on mount.
  useEffect(() => {
    void rec.requestPermission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onStart = useCallback(async () => {
    await rec.start();
  }, [rec]);

  const onStop = useCallback(async () => {
    const recording = await rec.stop();
    if (recording) {
      setLastRecording(recording);
      setPhase("metadata");
    }
  }, [rec]);

  const onFinalize = useCallback(async () => {
    if (!intervieweeName.trim()) {
      setNameErr(true);
      return;
    }
    if (!lastRecording) return;
    setPhase("saving");
    const updated: Recording = {
      ...lastRecording,
      title: `Interview with ${intervieweeName.trim()}`,
      intervieweeName: intervieweeName.trim(),
      role: role.trim() || undefined,
      tags: tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      notes: notes.trim() || undefined,
    };
    await upsertRecording(updated);
    await enqueueUpload(updated.id);
    router.push("/recordings" as Href);
  }, [intervieweeName, role, tagsText, notes, lastRecording, router]);

  const onCancelRecording = useCallback(async () => {
    await rec.cancel();
    setLastRecording(null);
    setPhase("capturing");
  }, [rec]);

  // ---- Capturing phase ----
  if (phase === "capturing") {
    return (
      <View style={styles.container}>
        <Text style={styles.timer}>{formatTime(rec.durationMs)}</Text>
        <View style={styles.waveformWrap}>
          <Waveform metering={rec.metering} active={rec.state === "recording"} />
        </View>

        <Text style={styles.stateLabel} accessibilityLiveRegion="polite">
          {rec.state === "recording"
            ? "Recording"
            : rec.state === "paused"
              ? "Paused"
              : rec.state === "idle"
                ? "Ready"
                : rec.state}
        </Text>

        <View style={styles.controls}>
          {rec.state === "idle" && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Start recording"
              style={[styles.control, styles.primary]}
              onPress={onStart}
            >
              <Text style={styles.controlTextLight}>● Record</Text>
            </Pressable>
          )}
          {rec.state === "recording" && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Pause recording"
              style={[styles.control, styles.secondary]}
              onPress={() => void rec.pause()}
            >
              <Text style={styles.controlTextDark}>❚❚ Pause</Text>
            </Pressable>
          )}
          {rec.state === "paused" && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Resume recording"
              style={[styles.control, styles.primary]}
              onPress={() => void rec.resume()}
            >
              <Text style={styles.controlTextLight}>▶ Resume</Text>
            </Pressable>
          )}
          {(rec.state === "recording" || rec.state === "paused") && (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Stop and finalize recording"
                style={[styles.control, styles.stop]}
                onPress={onStop}
              >
                <Text style={styles.controlTextLight}>■ Stop</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel recording without saving"
                style={[styles.control, styles.ghost]}
                onPress={onCancelRecording}
              >
                <Text style={styles.controlTextDark}>Cancel</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  }

  // ---- Metadata phase (F3) post-stop ----
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionTitle}>Session complete</Text>
        <Text style={styles.helper}>
          Duration: {formatTime(lastRecording?.durationMs ?? 0)}
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>Interviewee name *</Text>
          <TextInput
            accessibilityLabel="Interviewee name, required"
            style={[styles.input, nameErr && styles.inputError]}
            value={intervieweeName}
            onChangeText={(v) => {
              setIntervieweeName(v);
              if (v.trim()) setNameErr(false);
            }}
            placeholder="Jane Doe"
            autoFocus
          />
          {nameErr && (
            <Text style={styles.errorText}>Interviewee name is required.</Text>
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Role / position</Text>
          <TextInput
            accessibilityLabel="Interviewee role"
            style={styles.input}
            value={role}
            onChangeText={setRole}
            placeholder="Senior Backend Engineer"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Tags (comma-separated)</Text>
          <TextInput
            accessibilityLabel="Tags"
            style={styles.input}
            value={tagsText}
            onChangeText={setTagsText}
            placeholder="system-design, culture-fit"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Notes</Text>
          <TextInput
            accessibilityLabel="Notes"
            style={[styles.input, styles.textarea]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Strong candidate; revisit async topic…"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        <View style={styles.controls}>
          {phase === "metadata" ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save recording"
                style={[styles.control, styles.primary]}
                onPress={() => void onFinalize()}
              >
                <Text style={styles.controlTextLight}>Save & Sync</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Discard the recording"
                style={[styles.control, styles.ghost]}
                onPress={() => {
                  void rec.cleanup();
                  setPhase("capturing");
                  setLastRecording(null);
                  router.push("/" as Href);
                }}
              >
                <Text style={styles.controlTextDark}>Discard</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.helper}>Saving…</Text>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: "#f8f9fa",
  },
  scroll: { paddingBottom: 48 },
  timer: {
    fontSize: 56,
    fontWeight: "700",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    color: "#1a1a2e",
    textAlign: "center",
    marginTop: 24,
  },
  waveformWrap: {
    marginVertical: 32,
  },
  stateLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0b5ed7",
    textAlign: "center",
    marginBottom: 24,
  },
  controls: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 12,
  },
  control: {
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 12,
    minWidth: 100,
    alignItems: "center",
  },
  primary: { backgroundColor: "#0b5ed7" },
  secondary: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#0b5ed7" },
  stop: { backgroundColor: "#dc3545" },
  ghost: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#dee2e6" },
  controlTextLight: { color: "#fff", fontWeight: "600", fontSize: 16 },
  controlTextDark: { color: "#495057", fontWeight: "600", fontSize: 16 },
  sectionTitle: { fontSize: 22, fontWeight: "700", color: "#1a1a2e", marginBottom: 4 },
  helper: { fontSize: 14, color: "#6c757d", marginBottom: 16 },
  field: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: "600", color: "#343a40", marginBottom: 6 },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#dee2e6",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  inputError: { borderColor: "#dc3545" },
  textarea: { minHeight: 96 },
  errorText: { color: "#dc3545", fontSize: 13, marginTop: 4 },
});