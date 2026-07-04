import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import type { Href } from "expo-router";
import { useEffect, useState } from "react";
import * as localStore from "../src/services/localStore.js";

// ---------------------------------------------------------------------------
// Home screen — entry point. Two actions: start a new recording, or browse
// past recordings. Also kicks the sync engine so pending uploads proceed.
// ---------------------------------------------------------------------------

export default function HomeScreen() {
  const router = useRouter();
  const [count, setCount] = useState(0);

  useEffect(() => {
    void localStore.countRecordings().then(setCount);
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        Interview Recorder
      </Text>
      <Text style={styles.subtitle}>
        Record, manage, and sync your interview sessions.
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start a new recording"
        style={[styles.button, styles.primary]}
        onPress={() => router.push("/recording" as Href)}
      >
        <Text style={styles.buttonTextPrimary}>＋ New Recording</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${count} past recordings`}
        style={[styles.button, styles.secondary]}
        onPress={() => router.push("/recordings" as Href)}
      >
        <Text style={styles.buttonTextSecondary}>
          My Recordings{count > 0 ? ` (${count})` : ""}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#f8f9fa",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#1a1a2e",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#6c757d",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 32,
  },
  button: {
    width: "100%",
    maxWidth: 320,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
  },
  primary: { backgroundColor: "#0b5ed7" },
  secondary: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#dee2e6" },
  buttonTextPrimary: { color: "#fff", fontSize: 16, fontWeight: "600" },
  buttonTextSecondary: { color: "#0b5ed7", fontSize: 16, fontWeight: "600" },
});