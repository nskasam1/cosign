const STORAGE_KEY = "cosign_participant_token";

/**
 * Anonymous per-browser identity for group decision mode (decision 8): an
 * account is never the price of saying what you need, so a seat at a table is
 * this token and nothing else.
 *
 * It is a WRITE CREDENTIAL — whoever holds it can replace that seat's answer
 * — so it stays in this browser. `GET /api/group/:id` sends an opaque
 * per-response seat id instead; publishing the token let any link-holder
 * overwrite a signed-in friend's answer under her name.
 *
 * Signing in adds that person's own ranked list to the arithmetic and nothing
 * else. There is no voting here and there never was: the pre-Phase-1 schema's
 * `group_session_votes` table died with the Supabase migrations, and decision
 * 8 replaced it with the needs intersection.
 */
export function getParticipantToken(): string {
  let token = localStorage.getItem(STORAGE_KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, token);
  }
  return token;
}
