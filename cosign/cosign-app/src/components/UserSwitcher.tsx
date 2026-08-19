// The dev user-switcher — auth v1's entire sign-in surface. Pick a seeded
// user, or head to onboarding to make a new one. Replaces the deleted
// email/password LoginScreen; there is no password anywhere in this product.
//
// It is also, and this had gone unnoticed for five phases, the FRONT DOOR:
// `/` is the only unauthenticated route in the app that is not a token link,
// so this is what a person sees who typed the address rather than being sent
// one. It opened with "Cosign · dev build / Who's this?" — a tool's screen,
// on the one surface where somebody has not yet been told what any of this
// is. It still does exactly the same job with exactly the same shapes; it
// just says the product's own sentence first, the way the share page does
// before it shows you a list.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Cancelled, signInWithPasskey, isSupported, unsupportedReason } from "@/lib/passkey";
import type { User } from "@/types/cosign";

const UserSwitcher = () => {
  const { switchTo, adopt } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  /** Neither the list arrived nor a switch went through. Not `isError`. */
  const [unreachable, setUnreachable] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  /**
   * Whether the credential-free switcher exists at all. The server decides
   * (COSIGN_DEV_AUTH), and it is `null` until it has answered — rendering
   * either the passkey door or the roster before knowing would flash one and
   * replace it with the other on the one screen where somebody is deciding
   * whether this is a real product.
   */
  const [devAuth, setDevAuth] = useState<boolean | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const navigate = useNavigate();
  const noPasskeys = unsupportedReason();

  useEffect(() => {
    // A bare `.then`, on the front door, for five phases: with the server
    // down this screen rendered its heading over nothing at all and gave no
    // reason — the same silence Phase 6 found in Onboarding, in the same
    // shape, one component away. Gate on the DATA rather than on a loading
    // flag: a request the browser paused because it went offline is neither
    // loading nor errored.
    api
      .authUsers()
      .then(({ users, dev_auth }) => {
        setUsers(users);
        setDevAuth(Boolean(dev_auth));
      })
      .catch(() => setUnreachable(true));
  }, []);

  const signIn = async () => {
    setSigningIn(true);
    setTrouble(null);
    try {
      adopt(await signInWithPasskey());
      navigate("/");
    } catch (err) {
      // Abandoning the platform sheet is not a failure and must not paint a
      // red line — the person changed their mind, which is allowed.
      if (!(err instanceof Cancelled)) {
        setTrouble(err instanceof Error ? err.message : "That passkey wasn\u2019t recognised.");
      }
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <main data-switcher className="cs-wrap pb-16 pt-[max(var(--space-8),env(safe-area-inset-top))]">
      <p className="cs-caps border-b border-rule pb-4 text-gold">Cosign</p>
      <h1 className="cs-display mt-6 text-balance text-3xl text-ink sm:text-4xl">
        Places near campus, cosigned by the people you’d actually ask.
      </h1>
      {/* The same rule, drawing itself, that sits under Home's question and
          marks the live tab — the product's one recurring mark, and this is
          the first time anybody arriving here sees it. */}
      <div className="cs-draw mt-5 h-px w-full bg-ember" aria-hidden="true" />
      {/* One line of caps, not two. Tracked small caps are the label voice
          and a wrapped one is a wall of shouting — the same note Phase 4
          wrote about Home's hero summary. The rest of the sentence goes in
          the body voice underneath, where it belongs. */}
      <p className="cs-caps mt-3 text-gold">Never scored, never bought</p>
      <p className="mt-4 text-sm text-line">
        Ranked head to head, one place at a time. No passwords — your own device is the key, and none of
        it leaves this machine.
      </p>

      {isSupported() && (
        <div data-passkey-door className="mt-7 border-t border-rule pt-6">
          <button
            type="button"
            data-passkey-signin
            disabled={signingIn}
            onClick={signIn}
            className="cs-pill"
          >
            {signingIn ? "Waiting for your device\u2026" : "Sign in with a passkey"}
          </button>
          <p className="mt-3 text-xs text-muted">
            Your device holds the key. Nothing to remember, nothing to leak, and no account anywhere but
            this machine.
          </p>
        </div>
      )}

      {noPasskeys && (
        <p data-passkey-unsupported className="mt-7 border-t border-rule pt-6 text-sm text-line">
          {noPasskeys} You can still make a profile below.
        </p>
      )}

      {devAuth === true && (
        <p className="cs-caps mt-8 border-t border-rule-strong pt-6 text-gold">
          Dev build · look around as somebody
        </p>
      )}

      <div className="cs-column mt-6">
        {devAuth === true &&
          users.map((u) => (
          <button
            key={u.id}
            type="button"
            data-user={u.username}
            disabled={busy !== null}
            onClick={async () => {
              setBusy(u.id);
              setTrouble(null);
              try {
                await switchTo(u.id);
              } catch {
                // A try/finally with no catch put every button back exactly
                // as it was and said nothing, which reads as "that worked"
                // to somebody still looking at the list they just tapped.
                setTrouble(`Couldn't sign in as ${u.display_name.split(" ")[0]}. Tap it again.`);
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

      {users.length === 0 && unreachable && (
        <p data-users-unreachable role="alert" className="mt-6 border-t border-rule pt-5 text-sm text-line">
          Cosign can't reach its own server, so it can't offer you anybody to be. Nothing is broken on your
          end — try again in a moment.
        </p>
      )}

      {trouble && (
        <p role="alert" className="mt-5 text-sm text-line">
          {trouble}
        </p>
      )}

      <div className="mt-8 border-t border-rule-strong pt-6">
        <button type="button" onClick={() => navigate("/onboarding")} className="cs-pill-ghost">
          New here — make a profile
        </button>
      </div>
    </main>
  );
};

export default UserSwitcher;
