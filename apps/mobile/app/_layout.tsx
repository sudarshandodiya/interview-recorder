import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { performAppLaunchRecovery } from "../src/services/durability.js";
import { initSyncEngine } from "../src/services/syncEngine.js";

/**
 * Root layout.
 *
 * Runs the app-launch recovery sequence (T-012) before rendering any screen:
 *   1. Recover interrupted recording sessions (crash/kill during recording)
 *      → finalize their partial audio as `local` recordings.
 *   2. Reset any recordings stuck in `uploading` back to `local` so the sync
 *      engine can requeue them (no recording stuck in `uploading`).
 *
 * This realizes the PRD's non-negotiable #1 (zero recording loss on crash).
 */
export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await performAppLaunchRecovery();
      } catch (err) {
        // Recovery must never block app launch — log and continue.
        console.warn("[launch] recovery failed:", err);
      }
      // Kick the sync engine so pending `local` recordings start uploading.
      try {
        await initSyncEngine();
      } catch (err) {
        console.warn("[launch] sync engine init failed:", err);
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="index" options={{ title: "Interview Recorder" }} />
        <Stack.Screen name="recording" options={{ title: "Recording" }} />
        <Stack.Screen name="recordings" options={{ title: "Recordings" }} />
        <Stack.Screen name="recording-detail" options={{ title: "Details" }} />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});