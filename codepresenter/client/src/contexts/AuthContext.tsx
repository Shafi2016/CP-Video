import React, { createContext, useContext, useEffect, useState } from "react";
import { getAuth, getGoogleProvider, hasFirebaseConfig } from "@/lib/firebase";

interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

interface AuthContextType {
  currentUser: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

interface AuthProviderProps {
  children: React.ReactNode;
}

async function ensureAuth() {
  if (!hasFirebaseConfig) {
    throw new Error("Firebase authentication is not configured");
  }

  const auth = await getAuth();
  if (!auth) {
    throw new Error("Firebase authentication is not available");
  }

  return auth;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const signInWithGoogle = async () => {
    const auth = await ensureAuth();

    const { signInWithPopup, GoogleAuthProvider } = await import("firebase/auth");
    const provider = await getGoogleProvider();

    if (!provider) {
      throw new Error("Google provider is not available");
    }

    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const googleAccessToken = credential?.accessToken;

    if (!googleAccessToken) {
      throw new Error("No Google access token returned. Please try again.");
    }

    localStorage.setItem("googleAccessToken", googleAccessToken);
    localStorage.setItem("googleAccessTokenExpiresAt", String(Date.now() + 55 * 60 * 1000));
  };

  const signInWithEmail = async (email: string, password: string) => {
    const auth = await ensureAuth();
    const { signInWithEmailAndPassword } = await import("firebase/auth");
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signUpWithEmail = async (email: string, password: string) => {
    const auth = await ensureAuth();
    const { createUserWithEmailAndPassword } = await import("firebase/auth");
    await createUserWithEmailAndPassword(auth, email, password);
  };

  const logout = async () => {
    const auth = await ensureAuth();
    const { signOut } = await import("firebase/auth");

    localStorage.removeItem("googleAccessToken");
    localStorage.removeItem("googleAccessTokenExpiresAt");
    localStorage.removeItem("googleDriveConnected");
    localStorage.removeItem("googleDriveUser");

    await signOut(auth);
  };

  useEffect(() => {
    if (!hasFirebaseConfig) {
      setLoading(false);
      return;
    }

    let unsubscribe: (() => void) | undefined;

    const initAuthState = async () => {
      try {
        const { onAuthStateChanged } = await import("firebase/auth");
        const auth = await getAuth();

        if (!auth) {
          setLoading(false);
          return;
        }

        unsubscribe = onAuthStateChanged(auth, (user: any) => {
          if (user) {
            setCurrentUser({
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
              photoURL: user.photoURL,
            });
          } else {
            setCurrentUser(null);
          }
          setLoading(false);
        });
      } catch (error) {
        console.error("Error setting up auth state listener:", error);
        setLoading(false);
      }
    };

    void initAuthState();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  const value: AuthContextType = {
    currentUser,
    loading,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
