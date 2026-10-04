#!/usr/bin/env node
// ══════════════════════════════════════════════════════════
//  يبني مخرجات Cloudflare Pages:
//    1) نسخة من public/ إلى dist/
//    2) src/assets.generated.js  (خريطة base64 للأصول)
//    3) تجميع src/pages-worker.js → dist/_worker.js
// ══════════════════════════════════════════════════════════

import { build } from "esbuild";
import { cp, rm, mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "dist");
const PUBLIC = path.join(ROOT, "public");
const GENERATED = path.join(ROOT, "src", "assets.generated.js");

// ملفات Pages التوجيهية — لا تُدمج داخل الحزمة
const SKIP = new Set(["_headers", "_redirects", "_worker.js"]);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

function typeFor(p) {
  const dot = p.lastIndexOf(".");
  return TYPES[p.slice(dot).toLowerCase()] || "application/octet-stream";
}

async function walk(dir, base = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, rel)));
    else out.push({ rel, full });
  }
  return out;
}

if (!existsSync(PUBLIC)) {
  console.error("✗ مجلد public غير موجود");
  process.exit(1);
}

// ── 1) خريطة الأصول base64 ──
const files = await walk(PUBLIC);
files.sort((a, b) => a.rel.localeCompare(b.rel));

const entries = [];
let totalBytes = 0;
for (const f of files) {
  const buf = await readFile(f.full);
  totalBytes += buf.length;
  const key = "/" + f.rel;
  entries.push(
    `  ${JSON.stringify(key)}: { type: ${JSON.stringify(typeFor(f.rel))}, data: "data:application/octet-stream;base64,${buf.toString("base64")}" },`
  );
}

const header = `// ══════════════════════════════════════════════════════════
//  مولَّد تلقائياً — لا تعدّله يدوياً
//  source: public/  →  ${files.length} ملف، ${(totalBytes / 1024).toFixed(1)} KiB
//  أعد التوليد عبر: npm run build:pages
// ══════════════════════════════════════════════════════════

export const FILES = {
${entries.join("\n")}
};
`;

await writeFile(GENERATED, header, "utf8");
console.log(`✓ الأصول: ${files.length} ملف (${(totalBytes / 1024).toFixed(1)} KiB) → src/assets.generated.js`);

// ── 2) نسخ public إلى dist ──
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(PUBLIC, OUT, { recursive: true });
console.log("✓ نسخ public/ → dist/");

// ── 3) تجميع العامل ──
await build({
  entryPoints: [path.join(ROOT, "src", "pages-worker.js")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  minify: true,
  sourcemap: false,
  outfile: path.join(OUT, "_worker.js"),
  legalComments: "none",
  logLevel: "warning",
});

const size = (await stat(path.join(OUT, "_worker.js"))).size;
console.log(`✓ dist/_worker.js (${(size / 1024).toFixed(1)} KiB)`);
console.log("✓ تم بناء مخرجات Pages بنجاح");