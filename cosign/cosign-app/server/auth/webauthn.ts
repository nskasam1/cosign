// Passkey registration and assertion verification (WebAuthn Level 2, §7.1/§7.2).
//
// This is the product's real authentication, and it is the one credential
// mechanism that does not break the brief's zero-external-services rule: the
// authenticator is the person's own device, the ceremony is a browser API, and
// the only party involved is this server. No email provider, no SMS gateway,
// no OAuth, no key in the repo.
//
// WHAT IS DELIBERATELY NOT DONE, and why:
//
//   * **Attestation is refused unless `fmt` is "none".** Verifying an
//     attestation statement means shipping a trust store of authenticator root
//     certificates and keeping it current, and what it buys a first-party
//     consumer RP is the ability to say which brand of authenticator somebody
//     used. Cosign has no reason to care. Registration requests
//     `attestation: "none"`, and anything else is rejected rather than parsed
//     and ignored — a statement we do not check must not be one we accept.
//   * **`signCount` is enforced only when the authenticator uses it.** Most
//     platform passkeys (iCloud Keychain, Google Password Manager) always send
//     0, because a credential synced across devices cannot keep a meaningful
//     per-authenticator counter. So: if the stored count and the new count are
//     both 0, that tells us nothing and is fine. If the authenticator has ever
//     sent a non-zero count, the count must strictly increase, and a regression
//     is treated as a cloned credential and refused.
//
// The signature check is `node:crypto` over a SubjectPublicKeyInfo built from
// the COSE key. Only ES256 (-7) and RS256 (-257) are accepted; both are
// required of every conforming authenticator, and an algorithm we did not ask
// for arriving in a response is a reason to stop, not to widen the switch.

import { createHash, createPublicKey, createVerify, verify as cryptoVerify } from "node:crypto";
import { decode, decodeFirst, mapGet } from "./cbor.ts";

export const ES256 = -7;
export const RS256 = -257;

/** base64url, the encoding every WebAuthn field travels in. */
export const b64u = {
  encode: (b: Uint8Array | Buffer): string => Buffer.from(b).toString("base64url"),
  decode: (s: string): Buffer => {
    if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s)) {
      throw new Error("expected base64url");
    }
    return Buffer.from(s, "base64url");
  },
};

export interface RelyingParty {
  /** The registrable domain. `localhost` in dev; the bare host in production. */
  id: string;
  name: string;
  /** Every origin allowed to complete a ceremony for this RP. */
  origins: string[];
}

/**
 * The RP is configuration, never a hardcoded host: the same build has to work
 * on localhost, on a laptop reached over a LAN, and on a real domain. Getting
 * it wrong fails closed — an origin that is not on the list is refused.
 */
export function relyingPartyFromEnv(env = process.env): RelyingParty {
  const id = env.COSIGN_RP_ID ?? "localhost";
  const origins = (env.COSIGN_ORIGINS ?? `http://localhost:${env.PORT ?? 8787}`)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { id, name: "Cosign", origins };
}

/** authenticatorData: rpIdHash(32) ‖ flags(1) ‖ signCount(4) ‖ [attested] ‖ [ext] */
export interface AuthenticatorData {
  rpIdHash: Buffer;
  flags: number;
  userPresent: boolean;
  userVerified: boolean;
  attestedCredentialData: boolean;
  signCount: number;
  credentialId?: Buffer;
  credentialPublicKey?: Uint8Array;
}

export function parseAuthenticatorData(buf: Buffer): AuthenticatorData {
  if (buf.length < 37) throw new Error("authenticatorData: shorter than its fixed header");
  const rpIdHash = buf.subarray(0, 32);
  const flags = buf[32];
  const signCount = buf.readUInt32BE(33);
  const out: AuthenticatorData = {
    rpIdHash,
    flags,
    userPresent: (flags & 0x01) !== 0,
    userVerified: (flags & 0x04) !== 0,
    attestedCredentialData: (flags & 0x40) !== 0,
    signCount,
  };
  if (!out.attestedCredentialData) return out;

  // aaguid(16) ‖ credentialIdLength(2) ‖ credentialId ‖ COSEPublicKey
  if (buf.length < 55) throw new Error("authenticatorData: attested-credential flag set but no data");
  const idLen = buf.readUInt16BE(53);
  const idEnd = 55 + idLen;
  if (buf.length < idEnd) throw new Error("authenticatorData: credentialId runs past the buffer");
  out.credentialId = buf.subarray(55, idEnd);

  // The COSE key is a CBOR item followed, possibly, by the extensions map. The
  // decoder reports how far it read so the key can be sliced exactly rather
  // than "the rest of the buffer" — which would swallow extensions into the
  // stored key and make every later assertion fail for no visible reason.
  const rest = buf.subarray(idEnd);
  const { length } = decodeFirst(rest);
  out.credentialPublicKey = rest.subarray(0, length);
  return out;
}

/** COSE_Key → a node KeyObject, via DER SubjectPublicKeyInfo. */
export function coseToKeyObject(cose: Uint8Array): { key: ReturnType<typeof createPublicKey>; alg: number } {
  const m = decode(cose);
  if (!(m instanceof Map)) throw new Error("COSE key: not a map");
  const kty = Number(mapGet(m, 1));
  const alg = Number(mapGet(m, 3));

  if (kty === 2) {
    if (alg !== ES256) throw new Error(`COSE key: EC2 with unsupported alg ${alg}`);
    const crv = Number(mapGet(m, -1));
    if (crv !== 1) throw new Error(`COSE key: unsupported curve ${crv} (only P-256)`);
    const x = mapGet(m, -2) as Uint8Array;
    const y = mapGet(m, -3) as Uint8Array;
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) {
      throw new Error("COSE key: P-256 coordinates must be 32 bytes each");
    }
    // SPKI for id-ecPublicKey + prime256v1, then the uncompressed point.
    const header = Buffer.from(
      "3059301306072a8648ce3d020106082a8648ce3d030107034200",
      "hex",
    );
    const der = Buffer.concat([header, Buffer.from([0x04]), Buffer.from(x), Buffer.from(y)]);
    return { key: createPublicKey({ key: der, format: "der", type: "spki" }), alg };
  }

  if (kty === 3) {
    if (alg !== RS256) throw new Error(`COSE key: RSA with unsupported alg ${alg}`);
    const n = mapGet(m, -1) as Uint8Array;
    const e = mapGet(m, -2) as Uint8Array;
    if (!(n instanceof Uint8Array) || !(e instanceof Uint8Array)) {
      throw new Error("COSE key: RSA modulus/exponent missing");
    }
    const der = rsaSpki(Buffer.from(n), Buffer.from(e));
    return { key: createPublicKey({ key: der, format: "der", type: "spki" }), alg };
  }

  throw new Error(`COSE key: unsupported key type ${kty}`);
}

// ── just enough DER to wrap an RSA key ──────────────────────────────────────
const derLen = (n: number): Buffer => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
const derTlv = (tag: number, body: Buffer): Buffer =>
  Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
/** DER INTEGERs are signed, so a leading high bit needs a 0x00 in front. */
const derInt = (b: Buffer): Buffer =>
  derTlv(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);

function rsaSpki(n: Buffer, e: Buffer): Buffer {
  const pkcs1 = derTlv(0x30, Buffer.concat([derInt(n), derInt(e)]));
  const algId = Buffer.from("300d06092a864886f70d0101010500", "hex"); // rsaEncryption, NULL
  const bitString = derTlv(0x03, Buffer.concat([Buffer.from([0x00]), pkcs1]));
  return derTlv(0x30, Buffer.concat([algId, bitString]));
}

// ── the two ceremonies ──────────────────────────────────────────────────────

interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

/**
 * Steps common to §7.1 and §7.2: the client data says what ceremony it was,
 * which challenge it answered, and where it happened.
 *
 * The challenge is compared as the base64url TEXT the client sent, against the
 * base64url of the challenge we issued — never by decoding both, because two
 * different strings can decode to the same bytes under a lenient decoder and
 * the value we stored is the one we must be sure came back.
 */
function checkClientData(
  raw: Buffer,
  expect: { type: string; challenge: string; rp: RelyingParty },
): ClientData {
  let data: ClientData;
  try {
    data = JSON.parse(raw.toString("utf-8")) as ClientData;
  } catch {
    throw new Error("clientDataJSON: not JSON");
  }
  if (data.type !== expect.type) {
    throw new Error(`clientDataJSON: type is ${JSON.stringify(data.type)}, wanted ${expect.type}`);
  }
  if (typeof data.challenge !== "string" || data.challenge !== expect.challenge) {
    throw new Error("clientDataJSON: challenge does not match the one issued");
  }
  if (!expect.rp.origins.includes(data.origin)) {
    throw new Error(`clientDataJSON: origin ${JSON.stringify(data.origin)} is not allowed`);
  }
  if (data.crossOrigin === true) throw new Error("clientDataJSON: cross-origin ceremony refused");
  return data;
}

function checkRpIdHash(actual: Buffer, rpId: string): void {
  const want = createHash("sha256").update(rpId).digest();
  if (!actual.equals(want)) throw new Error("authenticatorData: rpIdHash is for a different RP");
}

export interface RegistrationResult {
  credentialId: string;
  publicKey: string;
  signCount: number;
  userVerified: boolean;
  alg: number;
}

/** §7.1 — register a new credential. */
export function verifyRegistration(input: {
  attestationObject: string;
  clientDataJSON: string;
  expectedChallenge: string;
  rp: RelyingParty;
}): RegistrationResult {
  const clientDataBytes = b64u.decode(input.clientDataJSON);
  checkClientData(clientDataBytes, {
    type: "webauthn.create",
    challenge: input.expectedChallenge,
    rp: input.rp,
  });

  const att = decode(b64u.decode(input.attestationObject));
  if (!(att instanceof Map)) throw new Error("attestationObject: not a map");
  const fmt = mapGet(att, "fmt");
  if (fmt !== "none") {
    throw new Error(`attestationObject: fmt ${JSON.stringify(fmt)} refused — this RP asks for "none"`);
  }
  const authDataRaw = mapGet(att, "authData");
  if (!(authDataRaw instanceof Uint8Array)) throw new Error("attestationObject: no authData");

  const authData = parseAuthenticatorData(Buffer.from(authDataRaw));
  checkRpIdHash(authData.rpIdHash, input.rp.id);
  if (!authData.userPresent) throw new Error("authenticatorData: user-present flag not set");
  if (!authData.attestedCredentialData || !authData.credentialId || !authData.credentialPublicKey) {
    throw new Error("authenticatorData: no attested credential data in a registration");
  }

  // Parse the key now rather than at first login: a key we cannot read is a
  // credential the person can never use, and the moment to find that out is
  // while they are still standing at the screen that made it.
  const { alg } = coseToKeyObject(authData.credentialPublicKey);

  return {
    credentialId: b64u.encode(authData.credentialId),
    publicKey: b64u.encode(authData.credentialPublicKey),
    signCount: authData.signCount,
    userVerified: authData.userVerified,
    alg,
  };
}

export interface AssertionResult {
  signCount: number;
  userVerified: boolean;
}

/** §7.2 — verify an authentication assertion. */
export function verifyAssertion(input: {
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
  storedPublicKey: string;
  storedSignCount: number;
  expectedChallenge: string;
  rp: RelyingParty;
}): AssertionResult {
  const clientDataBytes = b64u.decode(input.clientDataJSON);
  checkClientData(clientDataBytes, {
    type: "webauthn.get",
    challenge: input.expectedChallenge,
    rp: input.rp,
  });

  const authDataBytes = b64u.decode(input.authenticatorData);
  const authData = parseAuthenticatorData(authDataBytes);
  checkRpIdHash(authData.rpIdHash, input.rp.id);
  if (!authData.userPresent) throw new Error("authenticatorData: user-present flag not set");

  const { key, alg } = coseToKeyObject(b64u.decode(input.storedPublicKey));
  const signed = Buffer.concat([authDataBytes, createHash("sha256").update(clientDataBytes).digest()]);
  const sig = b64u.decode(input.signature);

  const ok =
    alg === ES256
      ? cryptoVerify("sha256", signed, { key, dsaEncoding: "der" }, sig)
      : createVerify("sha256").update(signed).end().verify(key, sig);
  if (!ok) throw new Error("assertion signature does not verify");

  // A synced passkey reports 0 forever and that is not evidence of anything.
  // A counter that has ever moved must keep moving.
  if (!(authData.signCount === 0 && input.storedSignCount === 0)) {
    if (authData.signCount <= input.storedSignCount) {
      throw new Error("signature counter did not increase — the credential may have been cloned");
    }
  }

  return { signCount: authData.signCount, userVerified: authData.userVerified };
}
