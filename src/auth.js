// ==========================================================
//  auth.js — تجزئة كلمات المرور، الجلسات، الحماية
// ==========================================================

import { b64, randomHex, HttpError } from "./util.js";

// حد Web Crypto في Cloudflare Workers: 100000 دورة كحد أقصى
const PBKDF2_ITERATIONS = 100000;

// ---------- تجزئة كلمة المرور (PBKDF2-SHA256) ----------

export async function hashPassword(password, saltHex = randomHex(16)) {
  const salt = Uint8Array.from(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, key, 256
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${saltHex}$${b64.encode(bits)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, iterStr, saltHex, hashB64] = String(stored).split("$");
    if (scheme !== "pbkdf2") return false;
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
    );
    const salt = Uint8Array.from(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: Number(iterStr), hash: "SHA-256" }, key, 256
    );
    const a = new Uint8Array(bits);
    const b = Uint8Array.from(b64.decode(hashB64));
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  } catch {
    return false;
  }
}

export { PBKDF2_ITERATIONS };

// ---------- توليد كلمة مرور قوية ----------

const W_A = ["safar", "nahr", "waraqa", "jamal", "sahil", "zaytun", "qamar", "raml", "warda", "saba", "jumh", "rimal", "matar", "nidar"];
const W_B = ["88", "77", "42", "135", "909", "617", "310", "505", "240"];
const DIGITS = "23456789";
const LOWER = "abcdefghijkmnpqrstuvwxyz";

export function generatePassword(len = 10) {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const chars = [pick(W_A), pick(DIGITS), pick(W_A), pick(W_B)];
  const pool = DIGITS + LOWER;
  while (chars.length < len) chars.push(pick(pool.split("")));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// ---------- JWT (HS256) ----------

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
}

export async function signJwt(payload, secret) {
  const header = b64.encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64.encode(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return `${data}.${b64.encode(sig)}`;
}

export async function verifyJwt(token, secret) {
  try {
    const parts = String(token).split(".");
    if (parts.length !== 3) return null;
    const data = `${parts[0]}.${parts[1]}`;
    const key = await hmacKey(secret);
    const good = await crypto.subtle.verify("HMAC", key, b64.decode(parts[2]), new TextEncoder().encode(data));
    if (!good) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64.decode(parts[1])));
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------- الكوكيز ----------

export const SESSION_COOKIE = "cw_session";
export const CSRF_COOKIE = "cw_csrf";

export function cookieHeader(value, { maxAge, expires, clear = false } = {}) {
  const parts = [`${SESSION_COOKIE}=${clear ? "" : value}`, "Path=/", "HttpOnly", "SameSite=Strict", "Secure"];
  if (clear) parts.push("Max-Age=0");
  else if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  else if (expires) parts.push(`Expires=${new Date(expires).toUTCString()}`);
  return parts.join("; ");
}

export function readCookie(req, name = SESSION_COOKIE) {
  const raw = req.headers.get("cookie") || "";
  for (const chunk of raw.split(";")) {
    const i = chunk.indexOf("=");
    if (i === -1) continue;
    if (chunk.slice(0, i).trim() === name) return decodeURIComponent(chunk.slice(i + 1).trim());
  }
  return null;
}

// ---------- إنشاء الجلسات ----------

export async function createSession(env, user, req, workspaceId = null) {
  const days = Number(env.SESSION_DAYS || 14);
  const sid = randomHex(24);
  const expSec = Math.floor(Date.now() / 1000) + days * 86400;
  const expiresAt = new Date(expSec * 1000).toISOString();

  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "")
    .split(",")[0].trim() || "unknown";

  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, user_agent, ip, expires_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(sid, user.id, (req.headers.get("user-agent") || "").slice(0, 200), ip, expiresAt).run();

  const token = await signJwt(
    { sid, uid: user.id, wid: workspaceId, tv: user.token_version, exp: expSec },
    env.SESSION_SECRET
  );

  return { token, expiresAt, maxAge: days * 86400 };
}

/**
 * يقرأ المستخدم الحالي من الجلسة ويتحقق من صلاحيتها.
 * يُعيد: بيانات المستخدم + عضويته في بيئة العمل النشطة.
 */
export async function getSessionUser(env, req) {
  const token = readCookie(req) ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();

  if (!token) return null;
  if (!env.SESSION_SECRET) throw new HttpError(500, "مفتاح الجلسات غير مُعدّ");

  const payload = await verifyJwt(token, env.SESSION_SECRET);
  if (!payload?.sid) return null;

  const row = await env.DB.prepare(
    `SELECT s.revoked_at, s.expires_at,
            u.id, u.username, u.full_name, u.job_title, u.phone, u.email, u.avatar_color,
            u.bio, u.is_active, u.must_change_password, u.token_version,
            u.created_at, u.last_login_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`
  ).bind(payload.sid).first();

  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  if (!row.is_active) return null;
  if (payload.tv !== row.token_version) return null;

  row.sid = payload.sid;
  row.wid = payload.wid ?? null;

  // التحقق من عضوية بيئة العمل النشطة
  row.workspace = null;
  row.membership = null;
  if (row.wid) {
    const m = await env.DB.prepare(
      `SELECT m.id AS mid, m.role, m.status, m.job_title AS member_title,
              w.id AS wid, w.name, w.tagline, w.avatar_color AS ws_color,
              w.owner_id, w.task_due_days, w.is_personal
         FROM members m JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.workspace_id = ? AND m.user_id = ?`
    ).bind(row.wid, row.id).first();

    if (m && m.status === "active") {
      row.workspace = {
        id: m.wid, name: m.name, tagline: m.tagline, avatarColor: m.ws_color,
        ownerId: m.owner_id, taskDueDays: m.task_due_days, isPersonal: !!m.is_personal,
      };
      row.membership = { id: m.mid, role: m.role, status: m.status, jobTitle: m.member_title || "" };
    } else {
      row.wid = null; // لم يعد عضواً — نتجاهل بيئة العمل
    }
  }

  return row;
}

/** هل المستخدم يملك صلاحية إدارة بيئة العمل؟ */
export const isAdmin = (user) => user?.membership?.role === "owner" || user?.membership?.role === "admin";
/** هل المستخدم هو صاحب بيئة العمل؟ */
export const isOwner = (user) => user?.membership?.role === "owner";

export async function revokeSession(env, sid) {
  await env.DB.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").bind(sid).run();
}

export async function revokeAllSessions(env, userId) {
  await env.DB.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL").bind(userId).run();
}

export async function cleanupSessions(env) {
  await env.DB.prepare(
    "DELETE FROM sessions WHERE expires_at < datetime('now','-1 day') OR (revoked_at IS NOT NULL AND revoked_at < datetime('now','-1 day'))"
  ).run();
}