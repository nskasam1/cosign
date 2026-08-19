// Passkey storage and the challenge lifecycle.
//
// Nothing in `credentials` is a secret — a public key is public — so the
// interesting security property here is not confidentiality but *singleness*:
// one challenge, spent once, or the whole ceremony is replayable.

import type { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";

export interface Credential {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  alg: number;
  sign_count: number;
  label: string;
  created_at: string;
  last_used_at: string | null;
}

const CHALLENGE_TTL_MS = 5 * 60_000;

/**
 * Issue a challenge and record it.
 *
 * 32 bytes from `randomBytes`, which is the spec's floor (16) doubled. Stored
 * as the base64url text the browser will echo back, because that string is
 * what `clientDataJSON` carries and comparing text to text removes a decoding
 * step that two implementations could disagree about.
 */
export function newChallenge(
  db: DatabaseSync,
  purpose: "register" | "authenticate",
  userId: string | null,
  now = new Date(),
): string {
  // Sweep first. Expired rows are worthless and an unbounded table of them is
  // the kind of thing nobody notices until a year in.
  db.prepare("DELETE FROM webauthn_challenges WHERE expires_at < ?").run(now.toISOString());

  const challenge = randomBytes(32).toString("base64url");
  db.prepare(
    "INSERT INTO webauthn_challenges (challenge, purpose, user_id, created_at, expires_at) VALUES (?,?,?,?,?)",
  ).run(
    challenge,
    purpose,
    userId,
    now.toISOString(),
    new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(),
  );
  return challenge;
}

/**
 * Take a challenge: return it if it is live, and delete it either way.
 *
 * Deleting on a *failed* read matters as much as on a successful one. A
 * challenge that survives one bad attempt is a challenge an attacker can keep
 * trying against, and the only reason to retry a specific challenge is that
 * something is wrong.
 */
export function takeChallenge(
  db: DatabaseSync,
  challenge: string,
  purpose: "register" | "authenticate",
  now = new Date(),
): { ok: true; userId: string | null } | { ok: false; why: string } {
  const row = db
    .prepare("SELECT * FROM webauthn_challenges WHERE challenge = ?")
    .get(challenge) as unknown as
    | { challenge: string; purpose: string; user_id: string | null; expires_at: string }
    | undefined;
  if (row) db.prepare("DELETE FROM webauthn_challenges WHERE challenge = ?").run(challenge);

  if (!row) return { ok: false, why: "that sign-in attempt has expired — start again" };
  if (row.purpose !== purpose) return { ok: false, why: "challenge was issued for something else" };
  if (row.expires_at < now.toISOString()) return { ok: false, why: "that sign-in attempt has expired — start again" };
  return { ok: true, userId: row.user_id };
}

export function credentialsFor(db: DatabaseSync, userId: string): Credential[] {
  return db
    .prepare("SELECT * FROM credentials WHERE user_id = ? ORDER BY created_at")
    .all(userId) as unknown as Credential[];
}

export function credentialById(db: DatabaseSync, credentialId: string): Credential | undefined {
  return db
    .prepare("SELECT * FROM credentials WHERE credential_id = ?")
    .get(credentialId) as unknown as Credential | undefined;
}

export function addCredential(
  db: DatabaseSync,
  input: {
    userId: string;
    credentialId: string;
    publicKey: string;
    alg: number;
    signCount: number;
    label: string;
  },
  now = new Date(),
): Credential {
  const id = `cred_${randomUUID()}`;
  db.prepare(
    `INSERT INTO credentials (id, user_id, credential_id, public_key, alg, sign_count, label, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    input.userId,
    input.credentialId,
    input.publicKey,
    input.alg,
    input.signCount,
    input.label,
    now.toISOString(),
  );
  return credentialById(db, input.credentialId)!;
}

export function touchCredential(
  db: DatabaseSync,
  credentialId: string,
  signCount: number,
  now = new Date(),
): void {
  db.prepare("UPDATE credentials SET sign_count = ?, last_used_at = ? WHERE credential_id = ?").run(
    signCount,
    now.toISOString(),
    credentialId,
  );
}

/**
 * Remove a passkey — but never the last one, which would lock the person out
 * of their own account with no recovery channel in the product to get them
 * back in. The UI has to offer adding one before removing the only one.
 */
export function removeCredential(
  db: DatabaseSync,
  userId: string,
  credentialId: string,
): { ok: true } | { ok: false; why: string } {
  const mine = credentialsFor(db, userId);
  if (!mine.some((c) => c.credential_id === credentialId)) {
    return { ok: false, why: "not your passkey" };
  }
  if (mine.length === 1) {
    return { ok: false, why: "that is your only passkey — add another before removing this one" };
  }
  db.prepare("DELETE FROM credentials WHERE user_id = ? AND credential_id = ?").run(
    userId,
    credentialId,
  );
  return { ok: true };
}
