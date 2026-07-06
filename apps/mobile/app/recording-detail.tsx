import type { Recording } from "@interview-recorder/shared";
import type { Href } from "expo-router";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBadge } from "../src/components/StatusBadge";
import { formatTime, usePlayback } from "../src/hooks/usePlayback";
import * as api from "../src/services/api";
import * as localStore from "../src/services/localStore";
import { onStatusChange } from "../src/services/syncEngine";

// ---------------------------------------------------------------------------
// Recording detail (T-016) + playback (T-018) + metadata edit (T-017).
//
// Metadata is editable only while status === "local" (not yet uploaded), per
// PRD F3 ("editable until the recording is finalized"). Once synced it is
// frozen server-side; the UI reflects that.
// ---------------------------------------------------------------------------

function formatBytes(n: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function RecordingDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [rec, setRec] = useState<Recording | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  // Editable-field state.
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [notes, setNotes] = useState("");
  const [nameErr, setNameErr] = useState(false);

  // Playback.
  const { state: pb, load, play, pause } = usePlayback();

  const reload = useCallback(async () => {
    const r = await localStore.getRecording(id);
    setRec(r);
    if (r) {
      setName(r.intervieweeName);
      setRole(r.role ?? "");
      setTagsText((r.tags ?? []).join(", "));
      setNotes(r.notes ?? "");
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void reload();
    const unsub = onStatusChange((changedId, _status) => {
      if (changedId === id) {
        // Re-fetch the latest row (status may have changed).
        void localStore.getRecording(id).then(setRec);
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Load audio for playback. Prefer the local file (offline-capable); fall
  // back to the backend presigned URL when only the server has it.
  useEffect(() => {
    if (!rec) return;
    if (rec.localUri) {
      void load(rec.localUri);
    } else if (rec.status === "synced" && rec.id) {
      void api
        .getAudioUrl(rec.id)
        .then((res) => load(res.url))
        .catch(() => {
          /* handled by playback error state */
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec?.id, rec?.status, rec?.localUri]);

  const onSaveMetadata = useCallback(async () => {
    if (!rec) return;
    if (!name.trim()) {
      setNameErr(true);
      return;
    }
    const updated: Recording = {
      ...rec,
      title: `Interview with ${name.trim()}`,
      intervieweeName: name.trim(),
      role: role.trim() || undefined,
      tags: tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      notes: notes.trim() || undefined,
    };
    await localStore.upsertRecording(updated);
    setRec(updated);
    setEditing(false);
  }, [rec, name, role, tagsText, notes]);

  const onDelete = useCallback(async () => {
    if (!rec) return;
    Alert.alert(
      "Delete recording?",
      "This cannot be undone and removes the server-side copy too.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            if (rec.status === "synced") {
              try {
                await api.deleteRecording(rec.id);
              } catch {
                // best-effort; remove local copy regardless
              }
            }
            await localStore.removeRecording(rec.id);
            router.push("/recordings" as Href);
          },
        },
      ],
    );
  }, [rec, router]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!rec) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Recording not found.</Text>
      </View>
    );
  }

  const editable = rec.status === "local";

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.name} accessibilityRole="header">
          {rec.intervieweeName}
        </Text>
        <StatusBadge status={rec.status} />
      </View>
      <Text style={styles.meta}>
        {rec.role ? `${rec.role} · ` : ""}
        {formatTime(rec.durationMs)} · {formatBytes(rec.fileSizeBytes)}
      </Text>

      {/* ---- Playback (T-018) ---- */}
      <View style={styles.player}>
        {pb.isLoading ? (
          <ActivityIndicator />
        ) : pb.error ? (
          <Text style={styles.muted}>Cannot play: {pb.error}</Text>
        ) : (
          <>
            <Text style={styles.position}>
              {formatTime(pb.positionMs)} / {formatTime(pb.durationMs)}
            </Text>
            <View style={styles.seekRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  pb.isPlaying ? "Pause playback" : "Play playback"
                }
                style={[styles.playBtn, styles.primary]}
                onPress={() => (pb.isPlaying ? void pause() : void play())}
              >
                <Text style={styles.controlTextLight}>
                  {pb.isPlaying ? "❚❚" : "▶"}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </View>

      {/* ---- Metadata (T-017) ---- */}
      <View style={styles.section}>
        {editing && editable ? (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>Interviewee name *</Text>
              <TextInput
                accessibilityLabel="Interviewee name, required"
                style={[styles.input, nameErr && styles.inputError]}
                value={name}
                onChangeText={(v) => {
                  setName(v);
                  if (v.trim()) setNameErr(false);
                }}
                autoFocus
              />
              {nameErr && (
                <Text style={styles.errorText}>
                  Interviewee name is required.
                </Text>
              )}
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Role / position</Text>
              <TextInput
                accessibilityLabel="Interviewee role"
                style={styles.input}
                value={role}
                onChangeText={setRole}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Tags (comma-separated)</Text>
              <TextInput
                accessibilityLabel="Tags"
                style={styles.input}
                value={tagsText}
                onChangeText={setTagsText}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Notes</Text>
              <TextInput
                accessibilityLabel="Notes"
                style={[styles.input, styles.textarea]}
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save metadata"
                style={[styles.control, styles.primary]}
                onPress={() => void onSaveMetadata()}
              >
                <Text style={styles.controlTextLight}>Save</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel editing"
                style={[styles.control, styles.ghost]}
                onPress={() => {
                  setEditing(false);
                  setName(rec.intervieweeName);
                  setRole(rec.role ?? "");
                  setTagsText((rec.tags ?? []).join(", "));
                  setNotes(rec.notes ?? "");
                }}
              >
                <Text style={styles.controlTextDark}>Cancel</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <View style={styles.fieldRow}>
              <Text style={styles.label}>Interviewee</Text>
              <Text style={styles.value}>{rec.intervieweeName}</Text>
            </View>
            <View style={styles.fieldRow}>
              <Text style={styles.label}>Role</Text>
              <Text style={styles.value}>{rec.role || "—"}</Text>
            </View>
            <View style={styles.fieldRow}>
              <Text style={styles.label}>Tags</Text>
              <Text style={styles.value}>
                {(rec.tags ?? []).join(", ") || "—"}
              </Text>
            </View>
            <View style={styles.fieldRow}>
              <Text style={styles.label}>Notes</Text>
              <Text style={styles.value}>{rec.notes || "—"}</Text>
            </View>
            {editable && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit metadata"
                style={[styles.control, styles.secondary, { marginTop: 12 }]}
                onPress={() => setEditing(true)}
              >
                <Text style={styles.controlTextDark}>Edit metadata</Text>
              </Pressable>
            )}
            {!editable && (
              <Text style={[styles.muted, { marginTop: 12 }]}>
                Metadata is read-only once the recording is uploaded (server
                source of truth).
              </Text>
            )}
          </>
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Delete recording"
        style={[styles.control, styles.danger, { marginTop: 16 }]}
        onPress={() => void onDelete()}
      >
        <Text style={styles.controlTextLight}>Delete recording</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: "#f8f9fa", paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: "#6c757d", fontSize: 14 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  name: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1a1a2e",
    flex: 1,
    marginRight: 8,
  },
  meta: { fontSize: 13, color: "#6c757d", marginBottom: 16 },
  player: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    alignItems: "center",
  },
  position: {
    fontSize: 18,
    fontWeight: "600",
    color: "#343a40",
    marginBottom: 10,
  },
  seekRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  playBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  section: { backgroundColor: "#fff", borderRadius: 12, padding: 16 },
  field: { marginBottom: 14 },
  fieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e9ecef",
  },
  label: { fontSize: 13, fontWeight: "600", color: "#6c757d", width: 100 },
  value: { fontSize: 15, color: "#1a1a2e", flex: 1, textAlign: "right" },
  input: {
    backgroundColor: "#f8f9fa",
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
  row: { flexDirection: "row", gap: 10, marginTop: 8 },
  control: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
  },
  primary: { backgroundColor: "#0b5ed7" },
  secondary: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#0b5ed7",
  },
  ghost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#dee2e6",
  },
  danger: { backgroundColor: "#dc3545" },
  controlTextLight: { color: "#fff", fontWeight: "600", fontSize: 15 },
  controlTextDark: { color: "#0b5ed7", fontWeight: "600", fontSize: 15 },
});
