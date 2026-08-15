// @vitest-environment node
import { describe, expect, it } from "vitest";
import { COOKIE_NAME, makeSessionCookie, verifySession } from "./cookie";

describe("signed session cookie", () => {
  it("round-trips a user id", () => {
    const setCookie = makeSessionCookie("u_maya");
    const value = setCookie.split(";")[0]; // "cosign_session=..."
    expect(verifySession(value)).toBe("u_maya");
  });

  it("rejects tampered payloads", () => {
    const value = makeSessionCookie("u_maya").split(";")[0];
    const forged = value.replace("u_maya", "u_dev");
    expect(verifySession(forged)).toBeNull();
  });

  it("rejects garbage and missing cookies", () => {
    expect(verifySession(undefined)).toBeNull();
    expect(verifySession("")).toBeNull();
    expect(verifySession(`${COOKIE_NAME}=abc`)).toBeNull();
    expect(verifySession(`${COOKIE_NAME}=a.b.c`)).toBeNull();
  });

  it("rejects expired sessions", () => {
    const past = Math.floor(Date.now() / 1000) - 60 * 24 * 60 * 60;
    const value = makeSessionCookie("u_maya", past).split(";")[0];
    const future = Math.floor(Date.now() / 1000);
    expect(verifySession(value, future)).toBeNull();
  });

  it("finds the session cookie among others", () => {
    const value = makeSessionCookie("u_june").split(";")[0];
    expect(verifySession(`other=1; ${value}; theme=dark`)).toBe("u_june");
  });
});
