import * as SecureStore from "expo-secure-store";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { setAuthToken, setOnAuthExpired } from "../services/api";
import { setStoreUserId } from "../services/localStore";

// ---------------------------------------------------------------------------
// Username/password auth (Tinyauth-backed) for the mobile app.
// ---------------------------------------------------------------------------
// The mobile posts `{ username, password }` to `POST /api/auth/login` on the
// backend. The backend validates the credentials against Tinyauth (running
// over HTTP at http://localhost:3001 — no mobile contact with Tinyauth), then
// returns a session JWT. The token is stored in expo-secure-store and sent as
// `Authorization: Bearer <token>` on every API call (see services/api.ts).
// When the backend returns 401, the API client invokes `onAuthExpired` so we
// drop the token and show the login screen again.
//
// No OAuth/PKCE/browser flow, no HTTPS, no client secret — simple and works
// under Expo Go.
// ---------------------------------------------------------------------------

const TOKEN_KEY = "auth.session_token";
const USER_ID_KEY = "auth.user_id";
const USERNAME_KEY = "auth.username";
const EMAIL_KEY = "auth.email";

interface AuthContextValue {
  /** The session JWT to send as `Authorization: Bearer`, or null when logged out. */
  idToken: string | null;
  /** The logged-in interviewer's user ID, or null when logged out. */
  userId: string | null;
  /** The logged-in interviewer's username, or null when logged out. */
  username: string | null;
  /** The logged-in interviewer's email, or null when logged out. */
  email: string | null;
  /** True until the stored token has been loaded from secure storage. */
  isLoading: boolean;
  /** Sign in with username/password. Throws on bad credentials. */
  signIn: (username: string, password: string) => Promise<void>;
  /** Drop the stored token. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [idToken, setIdToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load any stored token on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(TOKEN_KEY);
        const storedUid = await SecureStore.getItemAsync(USER_ID_KEY);
        const storedUsername = await SecureStore.getItemAsync(USERNAME_KEY);
        const storedEmail = await SecureStore.getItemAsync(EMAIL_KEY);
        if (!cancelled && stored) {
          setIdToken(stored);
          if (storedUid) setUserId(storedUid);
          if (storedUsername) setUsername(storedUsername);
          if (storedEmail) setEmail(storedEmail);
        }
      } catch (err) {
        console.warn("[auth] init failed:", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim(), password }),
    });
    const body = res.ok ? await res.json() : null;
    if (!res.ok || !body?.data?.token) {
      const message = body?.message ?? `Login failed (HTTP ${res.status})`;
      throw new Error(message);
    }
    const token = body.data.token as string;
    const uid = body.data.user.id as string;
    const uName = body.data.user.username as string;
    const uEmail = body.data.user.email as string;
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await SecureStore.setItemAsync(USER_ID_KEY, uid);
    await SecureStore.setItemAsync(USERNAME_KEY, uName);
    await SecureStore.setItemAsync(EMAIL_KEY, uEmail);
    setIdToken(token);
    setUserId(uid);
    setUsername(uName);
    setEmail(uEmail);
  }, []);

  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_ID_KEY);
    await SecureStore.deleteItemAsync(USERNAME_KEY);
    await SecureStore.deleteItemAsync(EMAIL_KEY);
    setIdToken(null);
    setUserId(null);
    setUsername(null);
    setEmail(null);
  }, []);

  // Push the current token into the API client so every fetch sends it as a
  // bearer header. On a 401, the API client calls onAuthExpired -> drop token.
  useEffect(() => {
    setAuthToken(idToken);
  }, [idToken]);

  // Set the user ID in the localStore to scope local manifest paths per interviewer
  useEffect(() => {
    setStoreUserId(userId);
  }, [userId]);

  useEffect(() => {
    setOnAuthExpired(() => {
      void (async () => {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        await SecureStore.deleteItemAsync(USER_ID_KEY);
        await SecureStore.deleteItemAsync(USERNAME_KEY);
        await SecureStore.deleteItemAsync(EMAIL_KEY);
        setIdToken(null);
        setUserId(null);
        setUsername(null);
        setEmail(null);
      })();
    });
    return () => setOnAuthExpired(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ idToken, userId, username, email, isLoading, signIn, signOut }),
    [idToken, userId, username, email, isLoading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
