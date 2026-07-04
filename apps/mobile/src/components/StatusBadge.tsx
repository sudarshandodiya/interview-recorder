import { Text, View, StyleSheet } from "react-native";
import type { SyncStatus } from "@interview-recorder/shared";

// ---------------------------------------------------------------------------
// StatusBadge (T-014) — coloured pill showing a recording's sync status.
// ---------------------------------------------------------------------------

const COLORS: Record<SyncStatus, { bg: string; fg: string; label: string }> = {
  local: { bg: "#e9ecef", fg: "#495057", label: "Local" },
  uploading: { bg: "#cfe2ff", fg: "#0b5ed7", label: "Uploading…" },
  synced: { bg: "#d1e7dd", fg: "#0f5132", label: "Synced" },
  failed: { bg: "#f8d7da", fg: "#842029", label: "Failed" },
};

interface Props {
  status: SyncStatus;
}

export function StatusBadge({ status }: Props) {
  const c = COLORS[status] ?? COLORS.local;
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text
        accessibilityLabel={`Status: ${c.label}`}
        style={[styles.text, { color: c.fg }]}
      >
        {c.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: "flex-start",
  },
  text: {
    fontSize: 12,
    fontWeight: "600",
  },
});