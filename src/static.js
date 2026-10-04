// ==========================================================
//  static.js — خدمة الملفات الساكنة من حزمة مدمجة
//  تُستخدم في بيئة Pages حيث لا يتوفّر ctx.next()
//
//  ملاحظة: تُنشأ src/assets.generated.js أثناء البناء عبر
//  scripts/build-pages.mjs وتحتوي خريطة { path -> { type, body } }
// ==========================================================

import { FILES } from "./assets.generated.js";

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

function typeFor(path) {
  const dot = path.lastIndexOf(".");
  return TYPES[path.slice(dot).toLowerCase()] || "application/octet-stream";
}

const decoder = new TextDecoder();

function decodeDataUrl(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function isTextual(type) {
  return type.startsWith("text/") || type.includes("json") || type.includes("javascript") || type.includes("xml");
}

/**
 * @param {Request} request
 * @returns {Promise<Response>} رد بالملف المطلوب، أو index.html لمسارات SPA
 */
export async function serveStatic(request) {
  const url = new URL(request.url);
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith("/")) path += "index.html";

  let entry = FILES[path];

  // مسار غير معروف → تطبيق صفحة واحدة
  if (!entry) {
    entry = FILES["/index.html"];
    if (!entry) {
      return new Response("الملفات غير متاحة", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
  }

  const type = entry.type || typeFor(path);
  const body = isTextual(type) ? decoder.decode(decodeDataUrl(entry.data)) : decodeDataUrl(entry.data);

  return new Response(body, {
    status: 200,
    headers: { "content-type": type },
  });
}