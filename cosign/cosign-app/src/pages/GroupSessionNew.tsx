import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { track } from "@/lib/analytics";
import { useTitle } from "@/lib/title";
import { MAX_PARTICIPANTS } from "@/lib/group";
import type { User } from "@/types/cosign";
import Nothing from "@/components/Nothing";

/**
 * Asking. The only thing this screen does is pick up to three people you have
 * already agreed to know and make one link — which is the whole of what
 * "a friend asked" means, and the only notification group mode ever sends.
 */
const GroupSessionNew = () => {
  const navigate = useNavigate();
  const [friends, setFriends] = useState<User[] | null>(null);
  const [reachable, setReachable] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useTitle("Ask three people");

  useEffect(() => {
    api
      .friends()
      .then((v) => setFriends(v.accepted))
      .catch(() => setReachable(false));
  }, []);

  const cap = MAX_PARTICIPANTS - 1;

  const toggle = (username: string) =>
    setPicked((p) =>
      p.includes(username) ? p.filter((u) => u !== username) : p.length >= cap ? p : [...p, username],
    );

  const ask = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { session } = await api.startGroup(picked);
      track("friend_asked", { invited: picked.length });
      navigate(`/g/${session.id}`, { replace: true });
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  if (!reachable) {
    return (
      <main data-group-new data-state="unreachable" className="cs-wrap flex min-h-dvh flex-col justify-center pb-10">
        <Nothing
          kicker="Can't reach it"
          standalone
          title="Cosign can't reach your people right now."
          body="This is this machine, not them. Nothing was sent, so there is nothing to undo."
          action={
            <Link to="/" className="cs-pill-ghost">
              Back home
            </Link>
          }
        />
      </main>
    );
  }

  if (friends === null) {
    return (
      <main data-group-new data-state="loading" className="cs-wrap flex min-h-dvh items-center justify-center">
        <p className="cs-display text-muted">Looking.</p>
      </main>
    );
  }

  return (
    <main data-group-new className="cs-wrap pb-16 pt-[max(var(--space-4),env(safe-area-inset-top))]">
      <div className="flex items-baseline justify-between gap-4">
        <Link to="/" className="cs-word cs-caps text-muted">
          Leave
        </Link>
        <p className="cs-caps text-right text-gold">Cosign · a table for four</p>
      </div>

      <h1 className="cs-display mt-4 text-balance text-xl text-line">
        One table that works for all of you.
      </h1>
      <div className="mt-4 h-px bg-ember" />
      <p className="mt-5 text-sm text-line">
        Everybody says what they can't do without, and what is left over is the answer. Nobody votes — a
        vote is a rating with extra steps, and it hands the table to whoever brought the most friends.
      </p>

      {friends.length === 0 ? (
        <div className="mt-8">
          <Nothing
            kicker="Nobody yet"
            title="You haven't agreed to know anybody here."
            body="A table is people you'd actually ask, so Cosign will only let you ask them. Open somebody's page and add them, and this screen fills up."
            action={
              <Link to="/search" className="cs-pill-ghost">
                Find a place instead
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <section className="mt-8">
            <h2 className="cs-caps text-gold">Who are you asking?</h2>
            <p className="mt-2 text-xs text-muted">
              Up to {cap}. Anybody you send the link to can answer, with or without an account — this is
              just who gets told.
            </p>
            <div className="mt-3">
              {friends.map((f) => {
                const on = picked.includes(f.username);
                return (
                  <button
                    key={f.id}
                    type="button"
                    data-invite={f.username}
                    aria-pressed={on}
                    aria-disabled={!on && picked.length >= cap}
                    onClick={() => toggle(f.username)}
                    className="cs-row py-4"
                  >
                    <span className="cs-display block text-lg text-ink">{f.display_name}</span>
                    {f.taste_line && (
                      <span className="mt-1 block text-xs text-muted">{f.taste_line}</span>
                    )}
                  </button>
                );
              })}
            </div>
            {picked.length >= cap && (
              <p data-cap className="cs-caps mt-3 text-muted">
                That's {cap} — a table is four people. Drop one first.
              </p>
            )}
          </section>

          <button type="button" data-ask disabled={busy} onClick={ask} className="cs-pill mt-8">
            {busy ? "Asking…" : picked.length === 0 ? "Make the link" : `Ask ${picked.length}`}
          </button>
          {failed && (
            <p data-said className="cs-caps mt-4 text-ember-ink">
              That didn't send. Nobody was asked — tap it again.
            </p>
          )}
          <p className="mt-4 text-xs text-muted">
            They each get one line on their own page saying you asked. Cosign sends nothing else, ever — no
            reminder, no second ask, nothing on a timer.
          </p>
        </>
      )}
    </main>
  );
};

export default GroupSessionNew;
