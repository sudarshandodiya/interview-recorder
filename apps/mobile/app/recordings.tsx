import type { Recording } from "@interview-recorder/shared";
import type { Href } from "expo-router";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBadge } from "../src/components/StatusBadge";
import { formatTime } from "../src/hooks/usePlayback";
import * as api from "../src/services/api";
import * as localStore from "../src/services/localStore";
import { manualRetry, onStatusChange } from "../src/services/syncEngine";

// ---------------------------------------------------------------------------
// Recordings list (T-014) — manage past recordings: delete, retry (failed),
// navigate to detail. Re-renders on sync-engine status changes.
// ---------------------------------------------------------------------------

export default function RecordingsScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<Recording[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    const all = await localStore.listRecordings();
    setRows(all);
  }, []);

  useEffect(() => {
    void reload();
    const unsub = onStatusChange((id, status) => {
      // Optimistically patch the row's status; full reload is cheap too.
      setRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, status, updatedAt: new Date().toISOString() }
            : r,
        ),
      );
    });
    return unsub;
  }, [reload]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const onDelete = useCallback(
    (rec: Recording) => {
      Alert.alert(
        "Delete recording?",
        `Remove "${rec.intervieweeName}" — this cannot be undone. Also deletes the server-side copy.`,
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
                  // Still remove locally; backend cleanup best-effort.
                }
              }
              await localStore.removeRecording(rec.id);
              await reload();
            },
          },
        ],
      );
    },
    [reload],
  );

  const onRetry = useCallback(
    async (rec: Recording) => {
      await manualRetry(rec.id);
      await reload();
    },
    [reload],
  );

  return (
    <View style={styles.container}>
      <FlatList
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={rows.length === 0 ? styles.empty : undefined}
        data={rows}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open recording for ${item.intervieweeName}`}
            style={styles.row}
            onPress={() =>
              router.push(`/recording-detail?id=${item.id}` as Href)
            }
          >
            <View style={styles.rowMain}>
              <View style={styles.rowHeader}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.intervieweeName}
                </Text>
                <StatusBadge status={item.status} />
              </View>
              <Text style={styles.meta} numberOfLines={1}>
                {item.role ? `${item.role} · ` : ""}
                {item.durationMs > 0
                  ? formatTime(item.durationMs)
                  : "--"}
                {item.tags && item.tags.length > 0
                  ? ` · ${item.tags.join(", ")}`
                  : ""}
              </Text>
            </View>
            <View style={styles.rowActions}>
              {item.status === "failed" && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry upload"
                  style={[styles.mini, styles.miniPrimary]}
                  onPress={() => void onRetry(item)}
                >
                  <Text style={styles.miniTextLight}>Retry</Text>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete recording"
                style={[styles.mini, styles.miniDanger]}
                onPress={() => onDelete(item)}
              >
                <Text style={styles.miniTextLight}>Delete</Text>
              </Pressable>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>No recordings yet</Text>
            <Text style={styles.emptyText}>
              Tap “New Recording” on the home screen to start.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f9fa" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e9ecef",
  },
  rowMain: { flex: 1, marginRight: 8 },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  name: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a2e",
    flex: 1,
    marginRight: 8,
  },
  meta: { fontSize: 13, color: "#6c757d" },
  rowActions: { flexDirection: "row", gap: 8 },
  mini: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  miniPrimary: { backgroundColor: "#0b5ed7" },
  miniDanger: { backgroundColor: "#dc3545" },
  miniTextLight: { color: "#fff", fontWeight: "600", fontSize: 13 },
  empty: { flex: 1 },
  emptyWrap: { alignItems: "center", justifyContent: "center", padding: 32 },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#343a40",
    marginBottom: 6,
  },
  emptyText: { fontSize: 14, color: "#6c757d", textAlign: "center" },
});
