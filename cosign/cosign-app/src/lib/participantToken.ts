const STORAGE_KEY = "cosign_participant_token";

// Anonymous per-browser identity for no-login-wall group session voting
// (brief §4.1). Soft-trust by design — see the migration's comment on
// group_session_votes for the tradeoff this accepts.
export function getParticipantToken(): string {
  let token = localStorage.getItem(STORAGE_KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, token);
  }
  return token;
}
