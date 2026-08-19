// AuthProvider interface, v1: dev user-switcher over seeded users backed by
// the local server's signed cookie. No passwords, no OAuth, no external
// auth service — and the public share surfaces never touch this.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { User } from "@/types/cosign";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  switchTo: (userId: string) => Promise<void>;
  /**
   * Take a session the server has already established. The passkey routes set
   * the cookie themselves as part of verifying the assertion, so there is
   * nothing left to POST — the only thing missing is that this provider does
   * not yet know who it is. Calling `refresh()` instead would work and would
   * cost a round trip to learn something the response already told us.
   */
  adopt: (user: User) => void;
  createAccount: (input: { username: string; display_name: string; school_id?: string }) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.me();
      setUser(user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const switchTo = useCallback(async (userId: string) => {
    const { user } = await api.switchUser(userId);
    setUser(user);
  }, []);

  const adopt = useCallback((next: User) => setUser(next), []);

  const createAccount = useCallback(async (input: { username: string; display_name: string; school_id?: string }) => {
    const { user } = await api.createUser(input);
    setUser(user);
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, switchTo, adopt, createAccount, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
