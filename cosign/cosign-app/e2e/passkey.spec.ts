// Passkeys, driven by a real virtual authenticator.
//
//   COSIGN_EVIDENCE=phase9 npx playwright test passkey.spec.ts
//
// Chrome's CDP `WebAuthn` domain gives a software authenticator that does real
// key generation and real signatures, so none of this is mocked: the browser
// performs the ceremony, and `server/auth/webauthn.ts` verifies the signature
// exactly as it would for a phone. What it cannot test is the platform's own
// sheet — that is the founder's item, and it is a person with a thumb.
//
// Everything here goes through the PRODUCT'S OWN UI or its HTTP API, never by
// importing `src/lib/passkey.ts` into the page. That was the first draft, and
// it only worked under `npm run dev`, where Vite serves the source: against
// the production build there is no `/src/lib/passkey.ts` to import, so the
// suite would have passed in dev and 404'd in exactly the mode every other
// suite runs in.
//
// **These tests WRITE** (accounts, credentials) — scratch database only.
//
// `COSIGN_STRICT_BASE` points at a second server run the way a deployment
// would be: NODE_ENV=production, no COSIGN_DEV_AUTH. The tests that prove the
// credential-free door is *shut* run there and skip without it, the same way
// home.spec's finals tests skip without COSIGN_FINALS_BASE.

import { expect, test, type Page } from "@playwright/test";
import { settled, shotViewport } from "./fixtures";

const STRICT_BASE = process.env.COSIGN_STRICT_BASE;

/** A platform authenticator that is present, verified, and holds resident keys. */
async function virtualAuthenticator(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

/** A username nothing else in the run will claim. */
const freshName = (tag: string) =>
  `pk${tag}${Date.now().toString(36).slice(-4)}${Math.floor(Math.random() * 1e4)}`.slice(0, 24);

/** Sign up through onboarding, using the passkey button. */
async function signUpWithPasskey(page: Page, base = ""): Promise<string> {
  const username = freshName("u");
  await page.goto(`${base}/onboarding`);
  await expect(page.locator("[data-onboarding]")).toBeVisible();
  await page.locator("#ob-name").fill("Pat Passkey");
  await page.locator("#ob-username").fill(username);
  // The school is part of the form and the button stays disabled without it.
  // Picking it by position rather than by name keeps this working for the
  // second school somebody seeds.
  await page.locator('[aria-labelledby="ob-school-label"] button').first().click();
  const create = page.locator("[data-passkey-create]");
  await expect(create).toBeEnabled();
  await create.click();
  // Step 2 is the "anywhere you already trust" picker, which only renders once
  // the account exists — so reaching it IS the assertion that it worked.
  await expect(page.locator('[data-onboarding][data-step="2"]')).toBeVisible({ timeout: 15_000 });
  return username;
}

test.describe("a passkey is the credential", () => {
  test("somebody with no account makes one, and their device is the key", async ({ page }) => {
    await virtualAuthenticator(page);
    const username = await signUpWithPasskey(page);

    const me = await (await page.request.get("/api/me")).json();
    expect(me.user.username).toBe(username);

    // One passkey, on this account, and the screen that manages them can see it.
    const keys = await (await page.request.get("/api/auth/passkeys")).json();
    expect(keys.passkeys).toHaveLength(1);
    expect(keys.passkeys[0].label.length).toBeGreaterThan(0);
    // Never the credential id: that is the handle for aiming an assertion.
    expect(JSON.stringify(keys.passkeys[0])).not.toMatch(/credential_id/);
  });

  test("the same device signs back in after a sign-out, with no username typed", async ({
    page,
  }) => {
    await virtualAuthenticator(page);
    const username = await signUpWithPasskey(page);
    await page.request.post("/api/auth/logout");
    expect((await (await page.request.get("/api/me")).json()).user).toBeNull();

    await page.goto("/");
    await page.locator("[data-passkey-signin]").click();
    // No username was typed and no credential list was sent: the authenticator
    // offered its resident key and the server worked out who that is.
    await expect(page.locator("[data-home]")).toBeVisible({ timeout: 15_000 });
    expect((await (await page.request.get("/api/me")).json()).user.username).toBe(username);
  });

  test("a captured assertion cannot be replayed — the challenge is spent", async ({ page }) => {
    await virtualAuthenticator(page);
    await signUpWithPasskey(page);
    await page.request.post("/api/auth/logout");

    // Capture one complete, VALID assertion as the app sends it, then post the
    // identical body a second time.
    await page.goto("/");
    // Install the tap, THEN click. The first version returned a promise from
    // `page.evaluate` that only settled once the request went out, and awaited
    // it before clicking — so the click never happened and the test hung for
    // its full 30 s. Store it on `window` and poll instead: `signIn` navigates
    // client-side, so `window` survives.
    await page.evaluate(() => {
      const real = window.fetch.bind(window);
      (window as unknown as { __captured: string | null }).__captured = null;
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("authenticate/verify")) {
          (window as unknown as { __captured: string | null }).__captured = String(init?.body ?? "");
        }
        return real(input, init);
      };
    });
    await page.locator("[data-passkey-signin]").click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __captured: string | null }).__captured), {
        timeout: 15_000,
      })
      .toBeTruthy();
    const body = (await page.evaluate(
      () => (window as unknown as { __captured: string | null }).__captured,
    ))!;
    expect(body, "the assertion body was not captured").toBeTruthy();

    const replay = await page.request.post("/api/auth/passkey/authenticate/verify", {
      headers: { "content-type": "application/json" },
      data: JSON.parse(body),
    });
    expect(replay.status(), await replay.text()).toBe(400);
    expect((await replay.json()).error).toMatch(/expired|start again/i);
  });

  test("sign-in options name nobody, so the login screen cannot enumerate accounts", async ({
    request,
  }) => {
    const res = await request.post("/api/auth/passkey/authenticate/options", { data: {} });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // No allowCredentials at all. "Does this person have an account here" must
    // not be answerable by anybody who can reach the login screen — on a
    // product whose whole privacy model is friends-only.
    expect(body.allowCredentials).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/maya|lena|u_/i);
  });

  test("registering against a username that already exists is refused", async ({ request }) => {
    const res = await request.post("/api/auth/passkey/register/options", {
      data: { username: "maya", display_name: "Not Maya" },
    });
    expect(res.status()).toBe(409);
  });

  test("a malformed or forged response is refused, and says nothing useful", async ({ request }) => {
    const opts = await (
      await request.post("/api/auth/passkey/authenticate/options", { data: {} })
    ).json();
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: "webauthn.get",
        challenge: opts.challenge,
        origin: "http://localhost:8791",
      }),
    ).toString("base64url");
    const res = await request.post("/api/auth/passkey/authenticate/verify", {
      data: {
        id: "not-a-real-credential",
        response: {
          clientDataJSON,
          authenticatorData: Buffer.alloc(37).toString("base64url"),
          signature: Buffer.alloc(64).toString("base64url"),
        },
      },
    });
    expect(res.status()).toBe(401);
    // "no such credential" and "bad signature" must not be distinguishable.
    expect((await res.json()).error).toBe("that passkey was not recognised");
  });

  test("the front door offers the passkey first, and it is a real target", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await expect(page.locator("[data-passkey-door]")).toBeVisible();
    const button = page.locator("[data-passkey-signin]");
    const box = (await button.boundingBox())!;
    expect(box.height, "44 px minimum target").toBeGreaterThanOrEqual(44);
    await settled(page);
    await shotViewport(page, "front-door-passkey", testInfo.project.name);
  });
});

test.describe("the credential-free door, when the operator has not opened it", () => {
  test.skip(!STRICT_BASE, "needs COSIGN_STRICT_BASE — a server in production mode");

  test("POST /api/auth/switch is refused", async ({ request }) => {
    // The whole point of the phase: before it, this returned a live session
    // for any user id anybody cared to name, with no credential at all.
    const res = await request.post(`${STRICT_BASE}/api/auth/switch`, { data: { userId: "u_maya" } });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toMatch(/passkey/i);
  });

  test("the roster is not readable, so the accounts are not even listed", async ({ request }) => {
    const res = await request.get(`${STRICT_BASE}/api/auth/users`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.users).toEqual([]);
    expect(body.dev_auth).toBe(false);
  });

  test("the front door shows no roster to pick from", async ({ page }, testInfo) => {
    await page.goto(`${STRICT_BASE}/`);
    await expect(page.locator("[data-passkey-door]")).toBeVisible();
    await expect(page.locator("[data-user]")).toHaveCount(0);
    await settled(page);
    await shotViewport(page, "front-door-strict", testInfo.project.name);
  });

  test("passkeys still work there — the door is shut, not the building", async ({ page }) => {
    await virtualAuthenticator(page);
    const username = await signUpWithPasskey(page, STRICT_BASE);
    const me = await (await page.request.get(`${STRICT_BASE}/api/me`)).json();
    expect(me.user.username).toBe(username);
  });
});
