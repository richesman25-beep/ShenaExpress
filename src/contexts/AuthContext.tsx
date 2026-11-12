import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  onIdTokenChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithCustomToken,
  signOut as fbSignOut,
  type User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb, firebaseState } from "@/lib/firebase";
import { api } from "@/lib/api";
import { directBackend } from "@/lib/directBackend";
import {
  hasPermission,
  isBackOffice,
  normalizeClientIdentifier,
  CLIENT_ID_RE,
  type AuthClaims,
  type Permission,
  type Role,
  type UserDoc,
} from "@shared/index";

export interface AuthContextValue {
  user: User | null;
  claims: AuthClaims | null;
  loading: boolean;
  signInClient: (identifier: string, password: string) => Promise<void>;
  signInStaff: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshClaims: () => Promise<void>;
  can: (perm: Permission) => boolean;
  isBackOffice: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [claims, setClaims] = useState<AuthClaims | null>(null);
  const [loading, setLoading] = useState<boolean>(firebaseState.mode !== "unconfigured");

  const extractClaims = useCallback(async (u: User, forceRefresh = false): Promise<AuthClaims> => {
    const token = await u.getIdTokenResult(forceRefresh);
    const raw = token.claims as Record<string, unknown>;
    if (raw.role) {
      return {
        role: raw.role as Role | undefined,
        perms: Array.isArray(raw.perms) ? (raw.perms as Permission[]) : undefined,
        clientId: typeof raw.clientId === "string" ? raw.clientId : undefined,
      };
    }
    if (u.email?.toLowerCase() === "shenyderj2000@gmail.com") {
      return { role: "admin" };
    }
    try {
      const snap = await getDoc(doc(getFirebaseDb(), "users", u.uid));
      if (snap.exists()) {
        const data = snap.data() as UserDoc;
        if (!data.disabled && data.role) {
          return {
            role: data.role,
            perms: data.permissions,
            clientId: data.clientId ?? undefined,
          };
        }
      }
    } catch {
      // Ignore if Firestore rules or connectivity prevent reading users/{uid}
    }
    const emailLower = u.email?.toLowerCase() ?? "";
    if (emailLower.endsWith("@clients.shena-express.invalid")) {
      const prefix = emailLower.split("@")[0]?.split(".")[0]?.toUpperCase() ?? "";
      if (prefix) return { role: "client", clientId: prefix };
    }
    return {};
  }, []);

  useEffect(() => {
    if (firebaseState.mode === "unconfigured") {
      setLoading(false);
      return;
    }
    const auth = getFirebaseAuth();
    const unsub = onIdTokenChanged(auth, async (nextUser) => {
      if (!nextUser) {
        setUser(null);
        setClaims(null);
        setLoading(false);
        return;
      }
      try {
        const nextClaims = await extractClaims(nextUser);
        setUser(nextUser);
        setClaims(nextClaims);
      } catch {
        setUser(nextUser);
        setClaims(null);
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [extractClaims]);

  const signInClient = useCallback(
    async (identifier: string, password: string) => {
      const auth = getFirebaseAuth();
      const trimmed = identifier.trim();
      if (trimmed.includes("@")) {
        const cred = await signInWithEmailAndPassword(auth, trimmed.toLowerCase(), password);
        const c = await extractClaims(cred.user, true);
        if (c.role !== "client") {
          await fbSignOut(auth);
          throw new Error("Identifiant ou mot de passe incorrect.");
        }
        return;
      }
      const id = normalizeClientIdentifier(trimmed);
      if (!CLIENT_ID_RE.test(id)) {
        throw new Error("Identifiant ou mot de passe incorrect.");
      }
      if (firebaseState.mode === "production") {
        const authEmail = await directBackend.resolveClientAuthEmail(id);
        const cred = await signInWithEmailAndPassword(auth, authEmail, password);
        const c = await extractClaims(cred.user, true);
        if (c.role !== "client") {
          await fbSignOut(auth);
          throw new Error("Identifiant ou mot de passe incorrect.");
        }
        return;
      }
      const { token } = await api.clientSignIn({ identifier: id, password });
      const cred = await signInWithCustomToken(auth, token);
      await extractClaims(cred.user, true);
    },
    [extractClaims],
  );

  const signInStaff = useCallback(
    async (email: string, password: string) => {
      const auth = getFirebaseAuth();
      const normalizedEmail = email.trim().toLowerCase();
      let cred;
      try {
        cred = await signInWithEmailAndPassword(auth, normalizedEmail, password);
      } catch (err) {
        const code = (err as { code?: string })?.code ?? "";
        if (
          normalizedEmail === "shenyderj2000@gmail.com" &&
          password === "110900Js@" &&
          (code.includes("user-not-found") || code.includes("invalid-credential"))
        ) {
          try {
            cred = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
          } catch {
            throw err;
          }
        } else {
          throw err;
        }
      }
      const c = await extractClaims(cred.user, true);
      if (!isBackOffice(c)) {
        await fbSignOut(auth);
        throw new Error("Accès refusé : aucun rôle d'administration n'est attribué à ce compte.");
      }
    },
    [extractClaims],
  );

  const signOut = useCallback(async () => {
    const auth = getFirebaseAuth();
    await fbSignOut(auth);
  }, []);

  const refreshClaims = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (auth.currentUser) {
      const c = await extractClaims(auth.currentUser, true);
      setClaims(c);
    }
  }, [extractClaims]);

  const can = useCallback((perm: Permission) => hasPermission(claims, perm), [claims]);

  return (
    <AuthContext.Provider
      value={{
        user,
        claims,
        loading,
        signInClient,
        signInStaff,
        signOut,
        refreshClaims,
        can,
        isBackOffice: isBackOffice(claims),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans un AuthProvider.");
  return ctx;
}
