// ==========================================================
//  util.js — أدوات مشتركة
// ==========================================================

const enc = new TextEncoder();
const dec = new TextDecoder();

export const nowIso = () => new Date().toISOString();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export const ok = (data = { ok: true }) => json(data, 200);
export const fail = (message, status = 400, extra = {}) =>
  json({ error: message, ...extra }, status);

export function randomHex(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const b64 = {
  // يقبل سلسلة نصية أو مصفوفة بايتات
  encode: (input) => {
    const bytes = typeof input === "string" ? enc.encode(input) : new Uint8Array(input);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/=+$/, "");
  },
  decode: (str) => {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

/** قراءة جسم الطلب كـ JSON بأمان */
export async function readJson(req) {
  try {
    const text = await req.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "جسم الطلب غير صالح");
  }
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- التحقق من المدخلات ----------

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const PRIORITIES = ["low", "normal", "high", "urgent"];
const STATUSES = ["new", "read", "done", "cancelled"];

export function normUsername(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) throw new HttpError(400, "اسم المستخدم مطلوب");
  if (!USERNAME_RE.test(s)) {
    throw new HttpError(
      400,
      "اسم المستخدم يجب أن يكون 3-32 حرفاً إنجليزياً (حروف صغيرة وأرقام . _ - فقط)"
    );
  }
  return s;
}

/** يزيل المحارف غير المرئية ويحدّد الطول */
export function cleanText(v, { min = 0, max = 4000, field = "الحقل", required = false } = {}) {
  const s = String(v ?? "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .trim();
  if (required && !s) throw new HttpError(400, `${field} مطلوب`);
  if (s.length < min) throw new HttpError(400, `${field} قصير جداً`);
  if (s.length > max) throw new HttpError(400, `${field} أطول من الحد المسموح (${max} حرفاً)`);
  return s;
}

export function normPassword(v, { min = 6 } = {}) {
  const s = String(v ?? "");
  if (s.length < min) throw new HttpError(400, `كلمة المرور يجب أن تكون ${min} أحرف على الأقل`);
  if (s.length > 128) throw new HttpError(400, "كلمة المرور طويلة جداً");
  return s;
}

export function normPriority(v) {
  const s = String(v ?? "normal").trim().toLowerCase();
  return PRIORITIES.includes(s) ? s : "normal";
}

export function normStatus(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!STATUSES.includes(s)) throw new HttpError(400, "حالة المهمة غير صحيحة");
  return s;
}

/** يتحقق من صيغة التاريخ YYYY-MM-DD ويقبل null */
export function normDate(v, field = "التاريخ") {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, `${field} يجب أن يكون بصيغة YYYY-MM-DD`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${field} غير صالح`);
  return s;
}

export function toInt(v, field = "الرقم", { min = null, max = null, def = null } = {}) {
  if (v === undefined || v === null || v === "") {
    if (def !== null) return def;
    throw new HttpError(400, `${field} مطلوب`);
  }
  const n = Number(v);
  if (!Number.isInteger(n)) throw new HttpError(400, `${field} يجب أن يكون رقماً صحيحاً`);
  if (min !== null && n < min) throw new HttpError(400, `${field} أقل من الحد المسموح`);
  if (max !== null && n > max) throw new HttpError(400, `${field} أكبر من الحد المسموح`);
  return n;
}

export { enc, dec, b64, PRIORITIES, STATUSES };

// ---------- CX / تاريخات عربية ----------
const AR_MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

export function fmtDate(v) {
  if (!v) return null;
  const d = new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${AR_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function fmtDateTime(v) {
  if (!v) return null;
  const d = new Date(v.includes("T") ? v : v.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return null;
  let h = d.getHours();
  const ampm = h < 12 ? "ص" : "م";
  h = h % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()} — ${h}:${mm} ${ampm}`;
}

/** يحسب حالة التأخير */
export function isOverdue(row, todayStr) {
  if (!row.due_date || row.status === "done" || row.status === "cancelled") return false;
  return row.due_date < todayStr;
}

export function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}