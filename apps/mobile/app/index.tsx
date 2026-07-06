import type { Href } from "expo-router";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../src/auth/AuthContext";
import * as localStore from "../src/services/localStore";

// ---------------------------------------------------------------------------
// Home screen — entry point. Two actions: start a new recording, or browse
// past recordings. Also kicks the sync engine so pending uploads proceed.
// ---------------------------------------------------------------------------

export default function HomeScreen() {
  const router = useRouter();
  const { signOut, username } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    void localStore.countRecordings().then(setCount);
  }, []);

  return (
    <View style={styles.container}>
      {username && (
        <View style={styles.userBanner}>
          <Text style={styles.userBannerText}>
            Logged in as: <Text style={styles.usernameText}>{username}</Text>
          </Text>
        </View>
      )}

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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out"
        style={[styles.button, styles.signOutButton]}
        onPress={signOut}
      >
        <Text style={styles.buttonTextSignOut}>Sign Out</Text>
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
  userBanner: {
    backgroundColor: "#eef2f6",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "#dee2e6",
  },
  userBannerText: {
    fontSize: 14,
    color: "#495057",
    fontWeight: "500",
  },
  usernameText: {
    fontWeight: "700",
    color: "#0b5ed7",
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
  secondary: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#dee2e6",
  },
  signOutButton: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#dc3545",
    marginTop: 24,
  },
  buttonTextPrimary: { color: "#fff", fontSize: 16, fontWeight: "600" },
  buttonTextSecondary: { color: "#0b5ed7", fontSize: 16, fontWeight: "600" },
  buttonTextSignOut: { color: "#dc3545", fontSize: 16, fontWeight: "600" },
});
