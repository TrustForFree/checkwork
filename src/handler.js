// ==========================================================
//  handler.js — منطق الطلب المشترك بين Workers و Pages
// ==========================================================

import { handleApi } from "./api.js";
import { getSessionUser, cleanupSessions, readCookie, CSRF_COOKIE } from "./auth.js";

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "geolocation=(), microphone=(), camera=(), payment=(), usb=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "x-permitted-cross-domain-policies": "none",
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join("; "),
};

const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const ASSET_RE = /\.(?:css|js|mjs|woff2?|ttf|png|jpe?g|svg|ico|webp|avif|json|webmanifest|txt|xml)$/i;

/**
 * ينشئ معالج fetch مشترك.
 * @param {(request, env, ctx) => Promise<Response>} staticHandler المطلوب إلى ملفات الواجهة
 */
export function makeFetch(staticHandler) {
  return async function handle(request, env, ctx) {
    const url = new URL(request.url);

    try {
      // ─────────── واجهة البرمجة ───────────
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        if (MUTATING.has(request.method)) {
          // 1) تحقّق من مصدر الطلب
          const origin = request.headers.get("origin");
          if (origin && origin !== url.origin) {
            return finalize(jsonRes({ error: "طلب مرفوض (مصدر غير موثوق)" }, 403), request);
          }
          const referer = request.headers.get("referer");
          if (!origin && referer) {
            try {
              if (new URL(referer).origin !== url.origin) {
                return finalize(jsonRes({ error: "طلب مرفوض (مصدر غير موثوق)" }, 403), request);
              }
            } catch { return finalize(jsonRes({ error: "طلب مرفوض" }, 403), request); }
          }

          // 2) تحقّق مزدوج من CSRF
          const cookieToken = readCookie(request, CSRF_COOKIE);
          const headerToken = request.headers.get("x-csrf-token");
          if (!cookieToken || !headerToken || cookieToken !== headerToken) {
            return finalize(
              jsonRes({ error: "طلب مرفوض (فشل التحقق الأمني). أعد تحميل الصفحة." }, 403),
              request
            );
          }
        }

        let user = null;
        try {
          user = await getSessionUser(env, request);
        } catch (err) {
          console.error("session error:", err?.message || err);
        }

        return finalize(await handleApi(request, env, user), request);
      }

      // ─────────── ملفات الواجهة ───────────
      const res = await staticHandler(request, env, ctx);
      const headers = new Headers(res.headers);

      if (ASSET_RE.test(url.pathname) && res.status === 200) {
        headers.set("cache-control", "public, max-age=604800, must-revalidate");
      } else {
        headers.set("cache-control", "no-cache, must-revalidate");
      }

      // كوكي رمز CSRF (غير HttpOnly) ليستخدمه العميل في الترويسة
      if (!readCookie(request, CSRF_COOKIE)) {
        const bytes = new Uint8Array(24);
        crypto.getRandomValues(bytes);
        const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
        headers.append("set-cookie", `${CSRF_COOKIE}=${token}; Path=/; SameSite=Strict; Secure; Max-Age=1209600`);
      }

      const body = res.body && res.status !== 304 ? await res.arrayBuffer() : null;
      return finalize(new Response(body, {
        status: res.status,
        statusText: res.statusText,
        headers,
      }), request);
    } catch (err) {
      console.error("Unhandled error:", err?.stack || err);
      return finalize(
        new Response(env.DEBUG_ERRORS === "1" ? `ERR: ${err?.message}\n${err?.stack || ""}` : "خطأ داخلي في الخادم", {
          status: 500,
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        }),
        request
      );
    }
  };
}

function finalize(res, request) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  if (request.method === "OPTIONS") {
    res.headers.set("allow", "GET, HEAD, POST, PATCH, PUT, DELETE, OPTIONS");
  }
  return res;
}

function jsonRes(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** التنظيف الدوري (Cron) */
export async function runCleanup(env) {
  await cleanupSessions(env);
  await env.DB.prepare("DELETE FROM activity WHERE created_at < datetime('now','-90 day')").run();
}