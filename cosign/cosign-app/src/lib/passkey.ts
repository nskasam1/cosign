// The browser half of the passkey ceremonies.
//
// Two jobs, and they are both translation: WebAuthn speaks ArrayBuffer and the
// API speaks base64url, so everything crossing that line goes through here and
// nowhere else. A second place that does this conversion is a second place it
// can be done differently, and the symptom of doing it differently is a
// signature that will not verify with nothing on screen to say why.
//
// `isSupported()` is a real question, not a formality: WebAuthn needs a secure
// context, so it is present on `https://` and on `http://localhost` and absent
// on `http://<lan-ip>`. Somebody testing on their phone over the office wifi
// will hit exactly that, and the honest thing is to say so rather than to
// render a button that throws.

import type { User } from "@/types/cosign";

const b64uToBytes = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
};

const bytesToB64u = (b: ArrayBuffer | null): string => {
  if (!b) return "";
  let s = "";
  for (const byte of new Uint8Array(b)) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export function isSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential === "function" &&
    window.isSecureContext
  );
}

/** Why it is not available, in a sentence somebody can act on. */
export function unsupportedReason(): string | null {
  if (typeof window === "undefined") return null;
  if (typeof window.PublicKeyCredential !== "function") {
    return "This browser doesn’t do passkeys.";
  }
  if (!window.isSecureContext) {
    return "Passkeys need https, or localhost. This page is on neither.";
  }
  return null;
}

async function json<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "that didn’t work");
  return data;
}

/**
 * A ceremony the person abandoned is not an error worth shouting about.
 * Cancelling the platform sheet throws `NotAllowedError`, and so does a
 * timeout; neither is a fault and neither should paint a red line.
 */
export class Cancelled extends Error {}

const asCancelled = (err: unknown): never => {
  const e = err as { name?: string };
  if (e?.name === "NotAllowedError" || e?.name === "AbortError") throw new Cancelled();
  throw err;
};

export async function createPasskey(input?: {
  username: string;
  display_name: string;
}): Promise<User> {
  const options = await json<{
    challenge: string;
    rp: { id: string; name: string };
    user: { id: string; name: string; displayName: string };
    pubKeyCredParams: { type: "public-key"; alg: number }[];
    excludeCredentials: { type: "public-key"; id: string }[];
    authenticatorSelection: AuthenticatorSelectionCriteria;
    attestation: AttestationConveyancePreference;
    timeout: number;
  }>("/api/auth/passkey/register/options", input ?? {});

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({
      publicKey: {
        challenge: b64uToBytes(options.challenge),
        rp: options.rp,
        user: {
          id: b64uToBytes(options.user.id),
          name: options.user.name,
          displayName: options.user.displayName,
        },
        pubKeyCredParams: options.pubKeyCredParams,
        excludeCredentials: options.excludeCredentials.map((c) => ({
          type: c.type,
          id: b64uToBytes(c.id),
        })),
        authenticatorSelection: options.authenticatorSelection,
        attestation: options.attestation,
        timeout: options.timeout,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    return asCancelled(err);
  }
  if (!credential) throw new Cancelled();

  const response = credential.response as AuthenticatorAttestationResponse;
  const { user } = await json<{ user: User }>("/api/auth/passkey/register/verify", {
    id: credential.id,
    label: deviceLabel(),
    response: {
      clientDataJSON: bytesToB64u(response.clientDataJSON),
      attestationObject: bytesToB64u(response.attestationObject),
    },
  });
  return user;
}

export async function signInWithPasskey(): Promise<User> {
  const options = await json<{
    challenge: string;
    rpId: string;
    userVerification: UserVerificationRequirement;
    timeout: number;
  }>("/api/auth/passkey/authenticate/options", {});

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get({
      publicKey: {
        challenge: b64uToBytes(options.challenge),
        rpId: options.rpId,
        // No allowCredentials: the server deliberately does not say which
        // passkeys exist, so the platform offers whichever it holds.
        userVerification: options.userVerification,
        timeout: options.timeout,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    return asCancelled(err);
  }
  if (!credential) throw new Cancelled();

  const response = credential.response as AuthenticatorAssertionResponse;
  const { user } = await json<{ user: User }>("/api/auth/passkey/authenticate/verify", {
    id: credential.id,
    response: {
      clientDataJSON: bytesToB64u(response.clientDataJSON),
      authenticatorData: bytesToB64u(response.authenticatorData),
      signature: bytesToB64u(response.signature),
      userHandle: bytesToB64u(response.userHandle),
    },
  });
  return user;
}

/**
 * A name for the key that will mean something when somebody comes back in a
 * year to remove one. The user agent is the only thing the browser will tell
 * us, and it is coarse — but "Windows · Chrome" beats "Passkey 2".
 */
function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os =
    /iPhone|iPad/.test(ua) ? "iPhone" :
    /Android/.test(ua) ? "Android" :
    /Mac OS X/.test(ua) ? "Mac" :
    /Windows/.test(ua) ? "Windows" :
    /Linux/.test(ua) ? "Linux" : "This device";
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Safari\//.test(ua) ? "Safari" :
    /Firefox\//.test(ua) ? "Firefox" : null;
  return browser ? `${os} · ${browser}` : os;
}
