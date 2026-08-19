import { useEffect, useState } from "react";
import { Cancelled, createPasskey, isSupported, unsupportedReason } from "@/lib/passkey";

interface Passkey {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

/**
 * The keys that open this account, and the one screen that can add another.
 *
 * The reason this exists rather than being a settings page nobody visits: a
 * passkey lives on a device, and a person with exactly one device is one
 * dropped phone away from an account they can never open again. Cosign has no
 * recovery channel and cannot get one without breaking the rule the whole
 * product is built on — every route back in (an email, a text) is somebody
 * else's service. So the honest answer is to make the second device easy and
 * to say plainly what one device means, rather than to imply a safety net that
 * is not there.
 *
 * The server refuses to remove the last passkey for the same reason; this
 * screen says so before the person finds out by trying.
 */
const Passkeys = () => {
  const [keys, setKeys] = useState<Passkey[] | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const noPasskeys = unsupportedReason();

  const load = () =>
    fetch("/api/auth/passkeys")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no"))))
      .then((d: { passkeys: Passkey[] }) => {
        setKeys(d.passkeys);
        setUnreachable(false);
      })
      // Gate on the DATA, never on a loading flag: "no passkeys" and "the list
      // did not load" are different sentences, and Phase 7 found this exact
      // component telling somebody they had no share links when it simply had
      // not managed to ask.
      .catch(() => setUnreachable(true));

  useEffect(() => {
    void load();
  }, []);

  const add = async () => {
    setBusy(true);
    setTrouble(null);
    try {
      await createPasskey();
      await load();
    } catch (e) {
      if (!(e instanceof Cancelled)) {
        setTrouble(e instanceof Error ? e.message : "That didn’t work.");
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setTrouble(null);
    try {
      const res = await fetch(`/api/auth/passkeys/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "no");
      await load();
    } catch (e) {
      setTrouble(e instanceof Error ? e.message : "That didn’t work.");
    } finally {
      setBusy(false);
    }
  };

  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  return (
    <section data-passkeys className="mt-8 border-t border-rule-strong pt-5">
      <h2 className="cs-caps text-gold">The keys to this account</h2>

      {unreachable && (
        <p data-passkeys-unreachable role="alert" className="mt-2 text-sm text-line">
          Cosign can’t reach its own server, so it can’t tell you which devices open this account. Nothing
          is wrong with them — try again in a moment.
        </p>
      )}

      {keys && (
        <>
          <p className="mt-2 text-sm text-line">
            {keys.length === 1
              ? "One device opens this account. If you lose it, there is no way back in — nobody here can " +
                "let you in, because there is nobody here. Add a second one."
              : `${keys.length} devices open this account. Losing one is an inconvenience rather than the end.`}
          </p>

          <div className="cs-column mt-5">
            {keys.map((k) => (
              <div key={k.id} className="cs-row grid grid-cols-[1fr_auto] items-baseline gap-x-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-lg text-ink">{k.label}</span>
                  <span className="mt-1 block text-xs text-muted">
                    added {when(k.created_at)}
                    {k.last_used_at ? ` · last used ${when(k.last_used_at)}` : " · not used yet"}
                  </span>
                </span>
                {keys.length > 1 && (
                  <button
                    type="button"
                    data-remove-passkey={k.id}
                    disabled={busy}
                    onClick={() => remove(k.id)}
                    className="cs-word px-3 text-muted"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {trouble && (
        <p role="alert" className="mt-4 text-sm text-line">
          {trouble}
        </p>
      )}

      {isSupported() ? (
        <button
          type="button"
          data-add-passkey
          disabled={busy}
          onClick={add}
          className="cs-pill-ghost mt-6"
        >
          {busy ? "Ask your device…" : "Add this device"}
        </button>
      ) : (
        <p className="mt-6 text-sm text-muted">{noPasskeys}</p>
      )}
    </section>
  );
};

export default Passkeys;
