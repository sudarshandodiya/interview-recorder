import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "../src/auth/AuthContext";

/**
 * Login screen — shown by the root layout when no session token is present.
 *
 * Posts credentials to `POST /api/auth/login`; the backend validates them
 * against Tinyauth and returns a session JWT. Three dummy accounts work out of
 * the box (see docker-compose.yml / docs/auth.md):
 *
 *   interviewer1 / pass1
 *   interviewer2 / pass2
 *   interviewer3 / pass3
 */
export default function LoginScreen() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    if (!username.trim() || !password) {
      Alert.alert("Sign in", "Enter a username and password.");
      return;
    }
    setBusy(true);
    try {
      await signIn(username, password);
    } catch (err) {
      Alert.alert("Sign in failed", (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        Interview Recorder
      </Text>
      <Text style={styles.subtitle}>
        Sign in with your interviewer account.
      </Text>

      <TextInput
        accessibilityLabel="Username"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Username"
        value={username}
        onChangeText={setUsername}
        style={styles.input}
        textContentType="username"
      />
      <TextInput
        accessibilityLabel="Password"
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={styles.input}
        textContentType="password"
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign in"
        style={[styles.button, busy && styles.buttonDisabled]}
        onPress={onSubmit}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator />
        ) : (
          <Text style={styles.buttonText}>Sign in</Text>
        )}
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
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: "#555",
    textAlign: "center",
    marginBottom: 32,
  },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#24292f",
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 8,
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
