// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decode, decodeFirst } from "./cbor.ts";

const h = (hex: string) => Uint8Array.from(Buffer.from(hex.replace(/\s+/g, ""), "hex"));

describe("CBOR: the shapes WebAuthn uses", () => {
  it("reads unsigned integers at every argument width", () => {
    expect(decode(h("00"))).toBe(0);
    expect(decode(h("17"))).toBe(23);
    expect(decode(h("1818"))).toBe(24);
    expect(decode(h("1903e8"))).toBe(1000);
    expect(decode(h("1a000f4240"))).toBe(1_000_000);
  });

  it("reads negative integers, which is how COSE spells its algorithms", () => {
    expect(decode(h("20"))).toBe(-1);
    // -7 is ES256 and -257 is RS256; both appear in every registration.
    expect(decode(h("26"))).toBe(-7);
    expect(decode(h("390100"))).toBe(-257);
  });

  it("reads byte strings and text strings", () => {
    expect(Buffer.from(decode(h("43010203")) as Uint8Array)).toEqual(Buffer.from([1, 2, 3]));
    expect(decode(h("63666d74"))).toBe("fmt");
  });

  it("reads arrays and maps, including negative keys", () => {
    expect(decode(h("83010203"))).toEqual([1, 2, 3]);
    const m = decode(h("a201020326")) as Map<number, number>;
    expect(m.get(1)).toBe(2);
    expect(m.get(3)).toBe(-7);
  });

  it("reads the three simple values", () => {
    expect(decode(h("f4"))).toBe(false);
    expect(decode(h("f5"))).toBe(true);
    expect(decode(h("f6"))).toBe(null);
  });

  it("reports how far it read, which is how the COSE key gets sliced exactly", () => {
    // A one-byte item followed by junk: length must be 1, not 3.
    const { value, length } = decodeFirst(h("01ffff"));
    expect(value).toBe(1);
    expect(length).toBe(1);
  });
});

describe("CBOR: what it refuses, and why each one matters", () => {
  it("refuses trailing bytes after the top-level item", () => {
    // Otherwise the thing we parsed and the thing that was signed can differ.
    expect(() => decode(h("01ff"))).toThrow(/trailing/);
  });

  it("refuses indefinite-length items", () => {
    // CTAP2 mandates definite lengths; anything else is not a conforming
    // authenticator and guessing at its intent is not our job.
    expect(() => decode(h("5f42010243030405ff"))).toThrow(/indefinite/);
  });

  it("refuses a duplicate map key", () => {
    // Two `fmt` entries is the shape of an attack: one read by us, one by
    // something downstream.
    expect(() => decode(h("a2616101616102"))).toThrow(/duplicate/);
  });

  it("refuses a truncated item rather than returning a short read", () => {
    expect(() => decode(h("43 0102"))).toThrow(/truncated/);
  });

  it("refuses tags and floats instead of skipping them", () => {
    expect(() => decode(h("c074323031332d30332d32315432303a30343a30305a"))).toThrow(/major type 6/);
    expect(() => decode(h("f93c00"))).toThrow(/simple value/);
  });

  it("refuses invalid UTF-8 in a text string", () => {
    expect(() => decode(h("62c328"))).toThrow();
  });

  it("refuses a map key that is not an integer or a string", () => {
    expect(() => decode(h("a18101 01"))).toThrow(/map keys/);
  });
});
