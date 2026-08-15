// The dev user-switcher — auth v1's entire sign-in surface. Pick a seeded
// user, or head to onboarding to make a new one. Replaces the deleted
// email/password LoginScreen.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import type { User } from "@/types/cosign";

const UserSwitcher = () => {
  const { switchTo } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.authUsers().then(({ users }) => setUsers(users));
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <img src="/logo.png" alt="Cosign" className="h-12 mx-auto mb-2" />
        <h1 className="text-xl font-semibold text-center mb-1">Who's this?</h1>
        <p className="text-sm text-muted-foreground text-center mb-6">
          Dev build — pick a seeded user. No passwords here.
        </p>
        <div className="space-y-2">
          {users.map((u) => (
            <button
              key={u.id}
              disabled={busy !== null}
              onClick={async () => {
                setBusy(u.id);
                try {
                  await switchTo(u.id);
                } finally {
                  setBusy(null);
                }
              }}
              className="w-full flex items-center gap-3 rounded-2xl bg-card border border-border p-3 text-left hover:border-primary/60 min-h-[44px]"
            >
              {u.avatar ? (
                <img src={u.avatar} alt="" className="w-10 h-10 rounded-full" />
              ) : (
                <span className="w-10 h-10 rounded-full bg-muted grid place-items-center text-sm">
                  {u.display_name[0]}
                </span>
              )}
              <span>
                <span className="block font-medium">{u.display_name}</span>
                <span className="block text-xs text-muted-foreground">@{u.username}</span>
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={() => navigate("/onboarding")}
          className="w-full mt-4 text-sm text-primary underline-offset-4 hover:underline min-h-[44px]"
        >
          New here? Make a profile
        </button>
      </div>
    </div>
  );
};

export default UserSwitcher;
