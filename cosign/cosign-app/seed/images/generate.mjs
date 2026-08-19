// Cosign committed imagery generator.
// One warm editorial treatment: dark warm ground, layered abstract cafe-interior
// compositions (arched windows, table circles, mugs, hanging lamps, plant fronds),
// six palettes keyed by filename hash, soft turbulence grain, no text except
// avatar initials. Deterministic: every file is seeded from its own filename,
// so re-runs reproduce byte-identical output. No deps beyond node:fs/node:path.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

const SLUGS = [
  "wheelhouse", "cricket-and-crow", "terrazzo", "night-owl", "hackberry",
  "lantern-lane", "oval-grounds", "bramble", "copper-kettle", "marginalia",
  "south-porch", "foundry", "petal-and-bean", "high-street-standard", "juniper",
  "all-nighter", "grandview-social", "bexley-common", "short-north-drip",
];
const KINDS = ["room", "best_seat", "counter"];
const AVATARS = ["maya", "dev", "june", "theo", "priya", "sam", "lena", "noah"];

// a = key hue, b = deep companion, c = highlight cream, g = dark warm ground
const PALETTES = [
  { name: "warm",  a: "#c8a96e", b: "#8a6f42", c: "#e9dcbc", g: "#171512" },
  { name: "amber", a: "#d9a441", b: "#9a7127", c: "#f0dda2", g: "#181410" },
  { name: "rose",  a: "#c98a7a", b: "#8f5d51", c: "#eccdc2", g: "#181314" },
  { name: "moss",  a: "#8a9a6e", b: "#5d6b48", c: "#ccd6b6", g: "#141611" },
  { name: "slate", a: "#7d8a99", b: "#525d6a", c: "#c4cedb", g: "#131518" },
  { name: "clay",  a: "#b07a5c", b: "#7a4f39", c: "#e2bda6", g: "#171311" },
];

// FNV-1a hash of a string -> uint32
function hash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

// mulberry32 PRNG
function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const F = (n) => Math.round(n * 10) / 10;
const F2 = (n) => Math.round(n * 100) / 100;

function doc(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

function grainFilter(bf, amt) {
  return `<filter id="g"><feTurbulence type="fractalNoise" baseFrequency="${bf}" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${amt} 0 0 0 0"/></filter>`;
}

// ---- motifs -----------------------------------------------------------------

function arch(parts, R, P, x, y, w, h) {
  const r = w / 2;
  const ay = y + r;
  const cx = x + r;
  parts.push(
    `<path d="M${F(x)} ${F(y + h)}V${F(ay)}A${F(r)} ${F(r)} 0 0 1 ${F(x + w)} ${F(ay)}V${F(y + h)}Z" fill="${P.c}" fill-opacity="${F2(0.04 + R() * 0.05)}" stroke="${P.a}" stroke-opacity="0.5" stroke-width="2.5"/>`,
    `<line x1="${F(cx)}" y1="${F(y + 5)}" x2="${F(cx)}" y2="${F(y + h)}" stroke="${P.a}" stroke-opacity="0.3" stroke-width="1.5"/>`,
    `<line x1="${F(x)}" y1="${F(ay)}" x2="${F(x + w)}" y2="${F(ay)}" stroke="${P.a}" stroke-opacity="0.3" stroke-width="1.5"/>`
  );
}

function lamp(parts, R, P, x, len) {
  parts.push(
    `<line x1="${F(x)}" y1="0" x2="${F(x)}" y2="${F(len)}" stroke="${P.b}" stroke-width="2"/>`,
    `<path d="M${F(x - 17)} ${F(len + 15)}A17 17 0 0 1 ${F(x + 17)} ${F(len + 15)}Z" fill="${P.a}" fill-opacity="0.85"/>`,
    `<circle cx="${F(x)}" cy="${F(len + 21)}" r="4.5" fill="${P.c}"/>`,
    `<circle cx="${F(x)}" cy="${F(len + 21)}" r="26" fill="${P.c}" fill-opacity="0.08"/>`
  );
}

function table(parts, R, P, cx, cy, rx) {
  const ry = F(rx * 0.3);
  parts.push(
    `<ellipse cx="${F(cx)}" cy="${F(cy)}" rx="${F(rx)}" ry="${ry}" fill="${P.a}" fill-opacity="0.13" stroke="${P.a}" stroke-opacity="0.55" stroke-width="2"/>`,
    `<line x1="${F(cx)}" y1="${F(cy + ry)}" x2="${F(cx)}" y2="${F(cy + ry + 42)}" stroke="${P.b}" stroke-width="3.5" stroke-opacity="0.6"/>`,
    `<ellipse cx="${F(cx)}" cy="${F(cy + ry + 44)}" rx="${F(rx * 0.35)}" ry="5" fill="${P.b}" fill-opacity="0.4"/>`
  );
}

function mug(parts, R, P, cx, baseY, s, col) {
  const h = s * 1.25;
  const w = s * 1.7;
  parts.push(
    `<rect x="${F(cx - w / 2)}" y="${F(baseY - h)}" width="${F(w)}" height="${F(h)}" rx="${F(s * 0.22)}" fill="${col}" fill-opacity="0.9"/>`,
    `<circle cx="${F(cx + w / 2 + s * 0.28)}" cy="${F(baseY - h * 0.55)}" r="${F(s * 0.42)}" fill="none" stroke="${col}" stroke-opacity="0.9" stroke-width="${F(s * 0.24)}"/>`
  );
  if (s > 10) {
    parts.push(
      `<path d="M${F(cx - s * 0.2)} ${F(baseY - h - 6)}q6 -9 0 -18q-6 -9 0 -18" fill="none" stroke="${P.c}" stroke-opacity="0.4" stroke-width="2"/>`
    );
  }
}

function frond(parts, R, P, x, y) {
  const n = 5 + ((R() * 3) | 0);
  let d = "";
  for (let i = 0; i < n; i++) {
    const dx = -90 + R() * 180;
    const len = 80 + R() * 110;
    d += `M${F(x)} ${F(y)}Q${F(x + dx * 0.25)} ${F(y - len * 0.75)} ${F(x + dx)} ${F(y - len)}`;
  }
  parts.push(
    `<path d="${d}" fill="none" stroke="${P.a}" stroke-opacity="0.55" stroke-width="2"/>`,
    `<path d="M${F(x - 16)} ${F(y)}h32l-5 26h-22Z" fill="${P.b}" fill-opacity="0.7"/>`
  );
}

// ---- scene layouts ----------------------------------------------------------

function roomScene(parts, R, P, fy) {
  const n = 2 + ((R() * 2) | 0);
  let x = 70 + R() * 60;
  for (let i = 0; i < n; i++) {
    const w = 100 + R() * 60;
    if (x + w > 780) break;
    const y = 80 + R() * 60;
    const h = fy - y - (10 + R() * 50);
    arch(parts, R, P, x, y, w, h);
    x += w + 50 + R() * 80;
  }
  const ln = 1 + ((R() * 2) | 0);
  for (let i = 0; i < ln; i++) lamp(parts, R, P, 120 + R() * 560, 60 + R() * 90);
  const tx = 180 + R() * 440;
  const ty = fy + 40 + R() * 60;
  table(parts, R, P, tx, ty, 70 + R() * 40);
  mug(parts, R, P, tx - 20 + R() * 40, ty - 4, 13 + R() * 5, P.c);
  if (R() < 0.7) frond(parts, R, P, R() < 0.5 ? 60 + R() * 60 : 680 + R() * 60, fy + 60 + R() * 60);
}

function seatScene(parts, R, P, fy) {
  const left = R() < 0.5;
  const wx = left ? 70 + R() * 40 : 520 + R() * 60;
  const ww = Math.min(190 + R() * 70, 790 - wx);
  const wy = 60 + R() * 50;
  arch(parts, R, P, wx, wy, ww, fy - wy - 20 - R() * 30);
  lamp(parts, R, P, left ? 560 + R() * 120 : 130 + R() * 120, 70 + R() * 80);
  const tx = 300 + R() * 200;
  const ty = fy + 50 + R() * 50;
  table(parts, R, P, tx, ty, 95 + R() * 35);
  mug(parts, R, P, tx - 20 + R() * 40, ty - 4, 15 + R() * 6, P.c);
  frond(parts, R, P, left ? 700 + R() * 40 : 70 + R() * 50, fy + 70 + R() * 50);
}

function counterScene(parts, R, P, fy) {
  parts.push(
    `<rect y="${F(fy)}" width="800" height="${F(90 + R() * 30)}" fill="${P.b}" fill-opacity="0.22"/>`,
    `<line x1="0" y1="${F(fy)}" x2="800" y2="${F(fy)}" stroke="${P.a}" stroke-opacity="0.5" stroke-width="2.5"/>`
  );
  const sy = 120 + R() * 60;
  parts.push(
    `<line x1="${F(90 + R() * 60)}" y1="${F(sy)}" x2="${F(560 + R() * 120)}" y2="${F(sy)}" stroke="${P.a}" stroke-opacity="0.35" stroke-width="2"/>`
  );
  const ms = 2 + ((R() * 3) | 0);
  let mx = 160 + R() * 80;
  for (let i = 0; i < ms; i++) {
    mug(parts, R, P, mx, sy - 2, 7 + R() * 3, P.a);
    mx += 60 + R() * 50;
  }
  const mc = 2 + ((R() * 2) | 0);
  let cx = 140 + R() * 120;
  for (let i = 0; i < mc; i++) {
    mug(parts, R, P, cx, fy - 3, 14 + R() * 6, P.c);
    cx += 150 + R() * 110;
  }
  const ln = 2 + ((R() * 2) | 0);
  let lx = 130 + R() * 90;
  for (let i = 0; i < ln; i++) {
    lamp(parts, R, P, lx, 55 + R() * 70);
    lx += 180 + R() * 90;
  }
  if (R() < 0.5) frond(parts, R, P, 700 + R() * 50, fy - 6);
}

// ---- documents --------------------------------------------------------------

function scene(relName, kind) {
  const seed = hash(relName);
  const R = mulberry(seed);
  const P = PALETTES[seed % PALETTES.length];
  const parts = [];
  parts.push(grainFilter(F2(0.65 + R() * 0.35), "0.14"));
  parts.push(`<rect width="800" height="600" fill="${P.g}"/>`);
  const gn = 1 + ((R() * 2) | 0);
  for (let i = 0; i < gn; i++) {
    parts.push(
      `<circle cx="${F(80 + R() * 640)}" cy="${F(60 + R() * 300)}" r="${F(140 + R() * 130)}" fill="${P.a}" fill-opacity="0.05"/>`
    );
  }
  const fy = F(420 + R() * 40);
  parts.push(
    `<rect y="${fy}" width="800" height="${F(600 - fy)}" fill="${P.a}" fill-opacity="0.05"/>`,
    `<line x1="0" y1="${fy}" x2="800" y2="${fy}" stroke="${P.a}" stroke-opacity="0.2" stroke-width="1.5"/>`
  );
  if (kind === "room") roomScene(parts, R, P, fy);
  else if (kind === "best_seat") seatScene(parts, R, P, fy);
  else if (kind === "counter") counterScene(parts, R, P, fy);
  else [roomScene, seatScene, counterScene][(R() * 3) | 0](parts, R, P, fy);
  parts.push(`<rect width="800" height="600" filter="url(#g)"/>`);
  return doc(800, 600, parts.join(""));
}

function avatar(name) {
  const seed = hash(`avatars/${name}.svg`);
  const R = mulberry(seed);
  const P = PALETTES[seed % PALETTES.length];
  const parts = [];
  parts.push(grainFilter(F2(0.7 + R() * 0.3), "0.1"));
  parts.push(`<rect width="240" height="240" fill="${P.g}"/>`);
  parts.push(`<circle cx="120" cy="120" r="${F(112 + R() * 8)}" fill="${P.a}" fill-opacity="0.07"/>`);
  parts.push(
    `<circle cx="120" cy="120" r="104" fill="${P.a}" fill-opacity="0.12" stroke="${P.a}" stroke-opacity="0.8" stroke-width="2.5"/>`,
    `<circle cx="120" cy="120" r="90" fill="none" stroke="${P.c}" stroke-opacity="0.3" stroke-width="1.5" stroke-dasharray="${R() < 0.5 ? "1 6" : "3 8"}"/>`,
    `<text x="120" y="153" text-anchor="middle" font-family="Georgia,'Iowan Old Style','Times New Roman',serif" font-size="94" fill="${P.c}">${name[0].toUpperCase()}</text>`,
    `<path d="M${F(96 + R() * 8)} 190h${F(40 + R() * 8)}" stroke="${P.a}" stroke-opacity="0.6" stroke-width="2" stroke-linecap="round"/>`
  );
  parts.push(`<rect width="240" height="240" filter="url(#g)"/>`);
  return doc(240, 240, parts.join(""));
}

// ---- write everything -------------------------------------------------------

const dirs = {
  shops: join(ROOT, "shops"),
  avatars: join(ROOT, "avatars"),
  logs: join(ROOT, "logs"),
};
for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });

const counts = { shops: 0, avatars: 0, logs: 0 };
let maxBytes = 0;
const over = [];

function out(key, file, svg) {
  writeFileSync(join(dirs[key], file), svg);
  const b = Buffer.byteLength(svg);
  if (b >= 6144) over.push(`${key}/${file} (${b}B)`);
  if (b > maxBytes) maxBytes = b;
  counts[key]++;
}

for (const slug of SLUGS) {
  for (const kind of KINDS) {
    out("shops", `${slug}-${kind}.svg`, scene(`shops/${slug}-${kind}.svg`, kind));
  }
}
for (const name of AVATARS) out("avatars", `${name}.svg`, avatar(name));
for (let i = 1; i <= 40; i++) {
  const id = String(i).padStart(3, "0");
  out("logs", `log-${id}.svg`, scene(`logs/log-${id}.svg`, "log"));
}

const total = counts.shops + counts.avatars + counts.logs;
console.log(
  `wrote shops=${counts.shops} avatars=${counts.avatars} logs=${counts.logs} total=${total} maxBytes=${maxBytes}`
);
if (over.length) {
  console.error("FILES AT/OVER 6KB:", over.join(", "));
  process.exit(1);
}
