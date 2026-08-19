// @vitest-environment node
//
// These build real ceremonies with a real P-256 key and a real signature, and
// then damage them one field at a time. A verifier is only as good as the
// things it refuses, so the happy path is four tests and the refusals are the
// rest — and each refusal is written as "change exactly one thing".

import { describe, expect, it } from "vitest";
import { createHash, createSign, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import {
  ES256,
  RS256,
  b64u,
  coseToKeyObject,
  parseAuthenticatorData,
  relyingPartyFromEnv,
  verifyAssertion,
  verifyRegistration,
  type RelyingParty,
} from "./webauthn.ts";

const RP: RelyingParty = { id: "localhost", name: "Cosign", origins: ["http://localhost:8787"] };
const CHALLENGE = Buffer.from("a-challenge-32-bytes-long-padding").toString("base64url");

// ── a minimal CBOR encoder, for fixtures only ───────────────────────────────
const head = (major: number, n: number): Buffer => {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff]);
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
};
const cInt = (n: number): Buffer => (n >= 0 ? head(0, n) : head(1, -n - 1));
const cBytes = (b: Buffer): Buffer => Buffer.concat([head(2, b.length), b]);
const cText = (s: string): Buffer => Buffer.concat([head(3, Buffer.byteLength(s)), Buffer.from(s)]);
const cMap = (pairs: [Buffer, Buffer][]): Buffer =>
  Buffer.concat([head(5, pairs.length), ...pairs.flat()]);

// ── fixtures ────────────────────────────────────────────────────────────────
function es256Key() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const cose = cMap([
    [cInt(1), cInt(2)], // kty: EC2
    [cInt(3), cInt(ES256)],
    [cInt(-1), cInt(1)], // crv: P-256
    [cInt(-2), cBytes(Buffer.from(jwk.x, "base64url"))],
    [cInt(-3), cBytes(Buffer.from(jwk.y, "base64url"))],
  ]);
  return { privateKey, cose };
}

function rs256Key() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
  const cose = cMap([
    [cInt(1), cInt(3)], // kty: RSA
    [cInt(3), cInt(RS256)],
    [cInt(-1), cBytes(Buffer.from(jwk.n, "base64url"))],
    [cInt(-2), cBytes(Buffer.from(jwk.e, "base64url"))],
  ]);
  return { privateKey, cose };
}

function authData(opts: {
  rpId?: string;
  flags?: number;
  signCount?: number;
  cose?: Buffer;
  credentialId?: Buffer;
}): Buffer {
  const rpIdHash = createHash("sha256").update(opts.rpId ?? RP.id).digest();
  const header = Buffer.alloc(5);
  header[0] = opts.flags ?? 0x45; // UP | UV | AT
  header.writeUInt32BE(opts.signCount ?? 0, 1);
  const base = Buffer.concat([rpIdHash, header]);
  if (!opts.cose) return base;
  const credId = opts.credentialId ?? Buffer.from("credential-id-01");
  const len = Buffer.alloc(2);
  len.writeUInt16BE(credId.length, 0);
  return Buffer.concat([base, Buffer.alloc(16), len, credId, opts.cose]);
}

const clientData = (o: { type?: string; challenge?: string; origin?: string; crossOrigin?: boolean }) =>
  b64u.encode(
    Buffer.from(
      JSON.stringify({
        type: o.type ?? "webauthn.create",
        challenge: o.challenge ?? CHALLENGE,
        origin: o.origin ?? RP.origins[0],
        ...(o.crossOrigin === undefined ? {} : { crossOrigin: o.crossOrigin }),
      }),
    ),
  );

const attestation = (ad: Buffer, fmt = "none") =>
  b64u.encode(
    cMap([
      [cText("fmt"), cText(fmt)],
      [cText("attStmt"), cMap([])],
      [cText("authData"), cBytes(ad)],
    ]),
  );

const register = (over: Partial<Parameters<typeof verifyRegistration>[0]> = {}, cose?: Buffer) =>
  verifyRegistration({
    attestationObject: attestation(authData({ cose: cose ?? es256Key().cose })),
    clientDataJSON: clientData({}),
    expectedChallenge: CHALLENGE,
    rp: RP,
    ...over,
  });

// ── registration ────────────────────────────────────────────────────────────
describe("registration (§7.1)", () => {
  it("accepts a well-formed ES256 registration and returns the credential", () => {
    const { cose } = es256Key();
    const out = register({}, cose);
    expect(out.alg).toBe(ES256);
    expect(b64u.decode(out.credentialId).toString()).toBe("credential-id-01");
    expect(out.userVerified).toBe(true);
    expect(out.signCount).toBe(0);
    // The stored key must be the COSE key EXACTLY — a byte more and every
    // later assertion fails with nothing to point at.
    expect(b64u.decode(out.publicKey).equals(cose)).toBe(true);
  });

  it("accepts RS256 too", () => {
    expect(register({}, rs256Key().cose).alg).toBe(RS256);
  });

  it("slices the COSE key exactly, ignoring trailing extension bytes", () => {
    const { cose } = es256Key();
    const withExtensions = Buffer.concat([authData({ cose }), cMap([[cText("x"), cInt(1)]])]);
    const parsed = parseAuthenticatorData(withExtensions);
    expect(Buffer.from(parsed.credentialPublicKey!).equals(cose)).toBe(true);
  });

  it("refuses a challenge that is not the one issued", () => {
    expect(() => register({ expectedChallenge: "some-other-challenge" })).toThrow(/challenge/);
  });

  it("refuses an origin that is not on the list", () => {
    expect(() =>
      register({ clientDataJSON: clientData({ origin: "https://evil.example" }) }),
    ).toThrow(/origin/);
  });

  it("refuses a cross-origin ceremony", () => {
    expect(() => register({ clientDataJSON: clientData({ crossOrigin: true }) })).toThrow(/cross-origin/);
  });

  it("refuses the wrong ceremony type", () => {
    expect(() => register({ clientDataJSON: clientData({ type: "webauthn.get" }) })).toThrow(/type/);
  });

  it("refuses authenticator data hashed for a different RP", () => {
    const ad = authData({ cose: es256Key().cose, rpId: "evil.example" });
    expect(() => register({ attestationObject: attestation(ad) })).toThrow(/rpIdHash/);
  });

  it("refuses a registration with the user-present flag clear", () => {
    const ad = authData({ cose: es256Key().cose, flags: 0x44 }); // UV | AT, no UP
    expect(() => register({ attestationObject: attestation(ad) })).toThrow(/user-present/);
  });

  it("refuses an attestation format it does not verify, rather than ignoring it", () => {
    const ad = authData({ cose: es256Key().cose });
    expect(() => register({ attestationObject: attestation(ad, "packed") })).toThrow(/fmt/);
  });

  it("refuses a COSE key on the wrong curve or algorithm", () => {
    const wrongCurve = cMap([
      [cInt(1), cInt(2)],
      [cInt(3), cInt(ES256)],
      [cInt(-1), cInt(2)], // P-384
      [cInt(-2), cBytes(Buffer.alloc(32))],
      [cInt(-3), cBytes(Buffer.alloc(32))],
    ]);
    expect(() => coseToKeyObject(wrongCurve)).toThrow(/curve/);
    const wrongAlg = cMap([
      [cInt(1), cInt(2)],
      [cInt(3), cInt(-8)], // EdDSA
      [cInt(-1), cInt(1)],
      [cInt(-2), cBytes(Buffer.alloc(32))],
      [cInt(-3), cBytes(Buffer.alloc(32))],
    ]);
    expect(() => coseToKeyObject(wrongAlg)).toThrow(/alg/);
  });
});

// ── assertion ───────────────────────────────────────────────────────────────
function assertionFor(key: ReturnType<typeof es256Key>, opts: { signCount?: number; rpId?: string } = {}) {
  const ad = authData({ signCount: opts.signCount ?? 0, flags: 0x05, rpId: opts.rpId });
  const cdj = clientData({ type: "webauthn.get" });
  const signed = Buffer.concat([ad, createHash("sha256").update(b64u.decode(cdj)).digest()]);
  const sig = cryptoSign("sha256", signed, { key: key.privateKey, dsaEncoding: "der" });
  return { authenticatorData: b64u.encode(ad), clientDataJSON: cdj, signature: b64u.encode(sig) };
}

describe("assertion (§7.2)", () => {
  it("verifies a real ES256 signature", () => {
    const key = es256Key();
    const a = assertionFor(key);
    const out = verifyAssertion({
      ...a,
      storedPublicKey: b64u.encode(key.cose),
      storedSignCount: 0,
      expectedChallenge: CHALLENGE,
      rp: RP,
    });
    expect(out.signCount).toBe(0);
  });

  it("verifies a real RS256 signature, and reports UV honestly", () => {
    const key = rs256Key();
    // UP only, no UV: the caller has to be able to tell a verified ceremony
    // from a merely-present one, and 0x05 would have set both.
    const ad = authData({ flags: 0x01 });
    const cdj = clientData({ type: "webauthn.get" });
    const signed = Buffer.concat([ad, createHash("sha256").update(b64u.decode(cdj)).digest()]);
    const sig = createSign("sha256").update(signed).end().sign(key.privateKey);
    const out = verifyAssertion({
      authenticatorData: b64u.encode(ad),
      clientDataJSON: cdj,
      signature: b64u.encode(sig),
      storedPublicKey: b64u.encode(key.cose),
      storedSignCount: 0,
      expectedChallenge: CHALLENGE,
      rp: RP,
    });
    expect(out.userVerified).toBe(false);
  });

  it("refuses a signature made by a different key", () => {
    const a = assertionFor(es256Key());
    expect(() =>
      verifyAssertion({
        ...a,
        storedPublicKey: b64u.encode(es256Key().cose), // somebody else's
        storedSignCount: 0,
        expectedChallenge: CHALLENGE,
        rp: RP,
      }),
    ).toThrow(/signature/);
  });

  it("refuses authenticator data altered after signing", () => {
    const key = es256Key();
    const a = assertionFor(key);
    const tampered = b64u.decode(a.authenticatorData);
    tampered.writeUInt32BE(99, 33); // bump the counter only
    expect(() =>
      verifyAssertion({
        ...a,
        authenticatorData: b64u.encode(tampered),
        storedPublicKey: b64u.encode(key.cose),
        storedSignCount: 0,
        expectedChallenge: CHALLENGE,
        rp: RP,
      }),
    ).toThrow(/signature/);
  });

  it("refuses a counter that went backwards — a cloned credential", () => {
    const key = es256Key();
    const a = assertionFor(key, { signCount: 5 });
    expect(() =>
      verifyAssertion({
        ...a,
        storedPublicKey: b64u.encode(key.cose),
        storedSignCount: 9,
        expectedChallenge: CHALLENGE,
        rp: RP,
      }),
    ).toThrow(/cloned/);
  });

  it("accepts a counter that stays at zero, because synced passkeys never move it", () => {
    const key = es256Key();
    const a = assertionFor(key, { signCount: 0 });
    expect(
      verifyAssertion({
        ...a,
        storedPublicKey: b64u.encode(key.cose),
        storedSignCount: 0,
        expectedChallenge: CHALLENGE,
        rp: RP,
      }).signCount,
    ).toBe(0);
  });

  it("refuses an assertion replayed against a different challenge", () => {
    const key = es256Key();
    const a = assertionFor(key);
    expect(() =>
      verifyAssertion({
        ...a,
        storedPublicKey: b64u.encode(key.cose),
        storedSignCount: 0,
        expectedChallenge: "a-different-challenge",
        rp: RP,
      }),
    ).toThrow(/challenge/);
  });

  it("refuses a registration response replayed as an assertion", () => {
    const key = es256Key();
    const a = assertionFor(key);
    expect(() =>
      verifyAssertion({
        ...a,
        clientDataJSON: clientData({ type: "webauthn.create" }),
        storedPublicKey: b64u.encode(key.cose),
        storedSignCount: 0,
        expectedChallenge: CHALLENGE,
        rp: RP,
      }),
    ).toThrow(/type/);
  });

  it("refuses an assertion for a different RP id", () => {
    const key = es256Key();
    const a = assertionFor(key, { rpId: "evil.example" });
    expect(() =>
      verifyAssertion({
        ...a,
        storedPublicKey: b64u.encode(key.cose),
        storedSignCount: 0,
        expectedChallenge: CHALLENGE,
        rp: RP,
      }),
    ).toThrow(/rpIdHash/);
  });
});

describe("the relying party is configuration, and fails closed", () => {
  it("defaults to localhost and the port the server is on", () => {
    const rp = relyingPartyFromEnv({ PORT: "8791" } as NodeJS.ProcessEnv);
    expect(rp.id).toBe("localhost");
    expect(rp.origins).toEqual(["http://localhost:8791"]);
  });

  it("takes an explicit id and a comma-separated origin list", () => {
    const rp = relyingPartyFromEnv({
      COSIGN_RP_ID: "cosign.example",
      COSIGN_ORIGINS: "https://cosign.example, https://www.cosign.example",
    } as NodeJS.ProcessEnv);
    expect(rp.id).toBe("cosign.example");
    expect(rp.origins).toEqual(["https://cosign.example", "https://www.cosign.example"]);
  });

  it("rejects base64url that is not base64url, rather than decoding something else", () => {
    expect(() => b64u.decode("not base64!")).toThrow();
  });
});
