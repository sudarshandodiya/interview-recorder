import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { AuthProvider, useAuth } from "../src/auth/AuthContext";
import { performAppLaunchRecovery } from "../src/services/durability";
import { initSyncEngine } from "../src/services/syncEngine";
import LoginScreen from "./login";

/**
 * Root layout.
 *
 * Wraps the app in {@link AuthProvider} (Tinyauth OIDC) and gates the whole
 * navigation tree on a valid id token. Until the token is loaded from secure
 * storage a splash spinner is shown; if there is no token, the login screen is
 * shown. Once authenticated, the app-launch recovery sequence (T-012) runs
 * before the main screens render — realizing the PRD's non-negotiable #1
 * (zero recording loss on crash).
 */
export default function RootLayout() {
  return (
    <AuthProvider>
      <RootGate />
    </AuthProvider>
  );
}

function RootGate() {
  const { idToken, isLoading } = useAuth();
  const [ready, setReady] = useState(false);

  // Only run the recovery + sync-init sequence once authenticated.
  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    (async () => {
      try {
        await performAppLaunchRecovery();
      } catch (err) {
        console.warn("[launch] recovery failed:", err);
      }
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
  }, [idToken]);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!idToken) {
    return (
      <>
        <StatusBar style="auto" />
        <LoginScreen />
      </>
    );
  }

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
