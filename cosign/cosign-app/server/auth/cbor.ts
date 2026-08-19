// The subset of CBOR (RFC 8949) that WebAuthn actually uses.
//
// A passkey's attestation object and its COSE public key are CBOR, so
// verifying a registration means decoding CBOR. The obvious move is to install
// a CBOR package; this repo went from 48 dependencies to 8 in Phase 7 by
// deleting things nothing needed, and the two structures involved here use six
// major types between them. So it is written out, and it is written to be
// *strict* rather than permissive — a decoder that guesses is a decoder that
// can be made to disagree with the authenticator about what was signed.
//
// Supported: unsigned ints (0), negative ints (1), byte strings (2), text
// strings (3), arrays (4), maps (5), and the three simple values (7: false,
// true, null). Everything else — tags, floats, indefinite-length items, and
// bignums — throws by name rather than being skipped, because the failure mode
// of silently ignoring part of a signed structure is the interesting one.
//
// Two rules this decoder does NOT relax:
//
//   * **Nothing after the top-level item.** `decodeFirst` returns how many
//     bytes it consumed and the callers check it. An attestation object with
//     trailing bytes is malformed, and accepting it means the thing you parsed
//     and the thing that was signed can differ.
//   * **No indefinite-length encoding.** CTAP2 mandates canonical, definite
//     length CBOR; anything else is not coming from a conforming authenticator.

export type CborValue =
  | number
  | bigint
  | string
  | Uint8Array
  | CborValue[]
  | Map<CborValue, CborValue>
  | boolean
  | null;

class Reader {
  constructor(
    readonly buf: Uint8Array,
    public pos = 0,
  ) {}

  private need(n: number): void {
    if (this.pos + n > this.buf.length) {
      throw new Error(`CBOR: truncated — wanted ${n} bytes at ${this.pos} of ${this.buf.length}`);
    }
  }

  u8(): number {
    this.need(1);
    return this.buf[this.pos++];
  }

  bytes(n: number): Uint8Array {
    this.need(n);
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  /**
   * The argument of a CBOR head: either packed into the low 5 bits, or in the
   * following 1/2/4/8 bytes. 31 is indefinite length and is refused here.
   *
   * Returned as a number below 2^53 and as a bigint above it, so an 8-byte
   * length cannot silently lose precision and become a *smaller* length than
   * the one that was encoded.
   */
  argument(info: number): number | bigint {
    if (info < 24) return info;
    if (info === 24) return this.u8();
    if (info === 25) {
      const b = this.bytes(2);
      return (b[0] << 8) | b[1];
    }
    if (info === 26) {
      const b = this.bytes(4);
      return ((b[0] << 24) >>> 0) + (b[1] << 16) + (b[2] << 8) + b[3];
    }
    if (info === 27) {
      const b = this.bytes(8);
      let v = 0n;
      for (const byte of b) v = (v << 8n) | BigInt(byte);
      return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
    }
    if (info === 31) throw new Error("CBOR: indefinite-length items are not accepted");
    throw new Error(`CBOR: reserved additional-information value ${info}`);
  }

  /** A length used to slice the buffer must fit in a number, and be sane. */
  private length(info: number): number {
    const n = this.argument(info);
    if (typeof n === "bigint") throw new Error("CBOR: length larger than this decoder accepts");
    return n;
  }

  value(depth = 0): CborValue {
    // WebAuthn's structures are three deep. The bound is a guard against a
    // hostile input costing us the stack, not a real constraint.
    if (depth > 16) throw new Error("CBOR: nested too deeply");
    const head = this.u8();
    const major = head >> 5;
    const info = head & 0x1f;

    switch (major) {
      case 0:
        return this.argument(info) as number | bigint;
      case 1: {
        const n = this.argument(info);
        return typeof n === "bigint" ? -1n - n : -1 - n;
      }
      case 2:
        return this.bytes(this.length(info));
      case 3:
        return new TextDecoder("utf-8", { fatal: true }).decode(this.bytes(this.length(info)));
      case 4: {
        const n = this.length(info);
        const out: CborValue[] = [];
        for (let i = 0; i < n; i++) out.push(this.value(depth + 1));
        return out;
      }
      case 5: {
        const n = this.length(info);
        const out = new Map<CborValue, CborValue>();
        for (let i = 0; i < n; i++) {
          const k = this.value(depth + 1);
          if (typeof k !== "number" && typeof k !== "string" && typeof k !== "bigint") {
            throw new Error("CBOR: map keys must be integers or strings here");
          }
          // A duplicate key is malformed CBOR, and it is also the shape of an
          // attack: two `fmt` entries, one read by us and one by something else.
          if (out.has(k)) throw new Error(`CBOR: duplicate map key ${String(k)}`);
          out.set(k, this.value(depth + 1));
        }
        return out;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        throw new Error(`CBOR: unsupported simple value ${info}`);
      default:
        throw new Error(`CBOR: unsupported major type ${major}`);
    }
  }
}

/** Decode one item; returns it and the number of bytes it used. */
export function decodeFirst(buf: Uint8Array): { value: CborValue; length: number } {
  const r = new Reader(buf);
  const value = r.value();
  return { value, length: r.pos };
}

/** Decode exactly one item, refusing trailing bytes. */
export function decode(buf: Uint8Array): CborValue {
  const { value, length } = decodeFirst(buf);
  if (length !== buf.length) {
    throw new Error(`CBOR: ${buf.length - length} trailing bytes after the top-level item`);
  }
  return value;
}

/** A map value, by key, typed at the call site. */
export function mapGet(m: CborValue, key: number | string): CborValue | undefined {
  if (!(m instanceof Map)) throw new Error("CBOR: expected a map");
  return m.get(key);
}
