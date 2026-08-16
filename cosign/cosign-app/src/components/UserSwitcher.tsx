// The dev user-switcher — auth v1's entire sign-in surface. Pick a seeded
// user, or head to onboarding to make a new one. Replaces the deleted
// email/password LoginScreen; there is no password anywhere in this product.

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
    <main data-switcher className="cs-wrap pb-16 pt-[max(var(--space-8),env(safe-area-inset-top))]">
      <p className="cs-caps border-b border-rule pb-4 text-gold">Cosign · dev build</p>
      <h1 className="cs-display mt-6 text-3xl text-ink sm:text-4xl">Who's this?</h1>
      <p className="mt-3 text-sm text-line">
        Pick a seeded person. There are no passwords here — this whole thing runs on your machine.
      </p>

      <div className="mt-6">
        {users.map((u) => (
          <button
            key={u.id}
            type="button"
            data-user={u.username}
            disabled={busy !== null}
            onClick={async () => {
              setBusy(u.id);
              try {
                await switchTo(u.id);
              } finally {
                setBusy(null);
              }
            }}
            className="cs-row grid grid-cols-[2.5rem_1fr] items-center gap-x-4 py-4"
          >
            {u.avatar ? (
              <img src={u.avatar} alt="" width={40} height={40} className="h-10 w-10 rounded-full bg-surface" />
            ) : (
              <span className="cs-display grid h-10 w-10 place-items-center rounded-full bg-surface text-gold">
                {u.display_name[0]}
              </span>
            )}
            <span className="min-w-0 text-left">
              <span className="cs-display block truncate text-lg text-line">{u.display_name}</span>
              {u.taste_line && <span className="mt-1 block truncate text-xs text-muted">{u.taste_line}</span>}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-8 border-t border-rule-strong pt-6">
        <button type="button" onClick={() => navigate("/onboarding")} className="cs-pill-ghost">
          New here — make a profile
        </button>
      </div>
    </main>
  );
};

export default UserSwitcher;
