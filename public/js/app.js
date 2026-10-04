/* ═══════════════════════════════════════════════════════════
   CheckWork v2 — التطبيق
   تسجيل ذاتي · بيئات عمل متعددة · مهمات · قوائم TODO
   ═══════════════════════════════════════════════════════════ */

// ─────────────────────────── ثوابت ───────────────────────────

const STATUS = {
  new:       { label: "جديد",    tone: "blue",   icon: "i-bell" },
  read:      { label: "مقروء",   tone: "amber",  icon: "i-eye-view" },
  done:      { label: "منجز",    tone: "green",  icon: "i-check" },
  cancelled: { label: "ملغي",    tone: "gray",   icon: "i-close" },
};
const PRIORITY = {
  low:    { label: "منخفضة", tone: "gray" },
  normal: { label: "عادية",  tone: "blue" },
  high:   { label: "عالية",  tone: "amber" },
  urgent: { label: "عاجلة",  tone: "red" },
};
const TODO_PRIORITY = { low: { label: "منخفضة", tone: "gray" }, normal: { label: "عادية", tone: "blue" }, high: { label: "عالية", tone: "red" } };
const ROLE_LABEL = { owner: "صاحب البيئة", admin: "مشرف", member: "موظف" };

const ACTION_META = {
  register:               { icon: "i-shield",    tone: "violet", label: "تسجيل جديد" },
  login:                  { icon: "i-logout",    tone: "green",  label: "تسجيل دخول" },
  login_failed:           { icon: "i-alert",     tone: "red",    label: "محاولة فاشلة" },
  password_change:        { icon: "i-key",       tone: "amber",  label: "تغيير كلمة المرور" },
  workspace_create:       { icon: "i-layers",    tone: "brand",  label: "بيئة جديدة" },
  workspace_update:       { icon: "i-edit",      tone: "blue",   label: "تعديل البيئة" },
  workspace_delete:       { icon: "i-trash",     tone: "red",    label: "حذف البيئة" },
  member_invite:          { icon: "i-user-plus", tone: "amber",  label: "دعوة عضو" },
  member_update:          { icon: "i-edit",      tone: "blue",   label: "تعديل عضو" },
  member_remove:          { icon: "i-trash",     tone: "red",    label: "إزالة عضو" },
  invite_accept:          { icon: "i-user-plus", tone: "green",  label: "قبول دعوة" },
  invite_decline:         { icon: "i-close",     tone: "gray",   label: "رفض دعوة" },
  task_create:            { icon: "i-plus",      tone: "brand",  label: "مهمة جديدة" },
  task_update:            { icon: "i-edit",      tone: "blue",   label: "تعديل مهمة" },
  task_read:              { icon: "i-eye-view",  tone: "amber",  label: "تعليم كمقروء" },
  task_delete:            { icon: "i-trash",     tone: "red",    label: "حذف مهمة" },
  task_note:              { icon: "i-chat",      tone: "blue",   label: "تعليق" },
  todo_create:            { icon: "i-checklist", tone: "brand",  label: "عنصر قائمة" },
  todo_done:              { icon: "i-check",     tone: "green",  label: "إنجاز عنصر" },
  todo_undone:            { icon: "i-refresh",   tone: "amber",  label: "إعادة فتح عنصر" },
  todo_delete:            { icon: "i-trash",     tone: "red",    label: "حذف عنصر" },
};

// ─────────────────────────── حالة ───────────────────────────

const state = {
  user: null,
  workspace: null,
  membership: null,
  isAdmin: false,
  isOwner: false,
  badges: {},
  invites: 0,
  inviteList: [],
  workspaces: [],
  members: [],
  view: "dashboard",
  filter: { status: "all", priority: "all", when: "all", q: "", sort: "newest", assigneeId: "", scope: "all" },
  todoView: "all",
  cache: {},
};

// ─────────────────────────── DOM ───────────────────────────

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

const icon = (id, cls = "ico") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"></use></svg>`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ─────────────────────────── أدوات ───────────────────────────

const AR_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

function fmtDate(v) {
  if (!v) return "—";
  const s = String(v);
  const d = s.length === 10 ? new Date(s + "T00:00:00") : new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  return isNaN(d) ? "—" : `${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtDateTime(v) {
  if (!v) return "—";
  const s = String(v);
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  if (isNaN(d)) return "—";
  let h = d.getHours();
  const ap = h < 12 ? "ص" : "م";
  h = h % 12 || 12;
  return `${fmtDate(v)} — ${h}:${String(d.getMinutes()).padStart(2, "0")} ${ap}`;
}

function fmtRelative(v) {
  if (!v) return "—";
  const s = String(v);
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  if (isNaN(d)) return "—";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 45)     return "الآن";
  if (diff < 3600)   return `قبل ${Math.round(diff / 60)} دقيقة`;
  if (diff < 86400)  return `قبل ${Math.round(diff / 3600)} ساعة`;
  if (diff < 172800) return "أمس";
  if (diff < 604800) return `قبل ${Math.round(diff / 86400)} يوم`;
  return fmtDate(v);
}

function dueLabel(dateStr) {
  if (!dateStr) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (dateStr < today) {
    const days = Math.round((new Date(today) - new Date(dateStr)) / 86400000);
    return { text: `متأخرة ${days} يوم`, tone: "red" };
  }
  if (dateStr === today) return { text: "مستحقة اليوم", tone: "amber" };
  const days = Math.round((new Date(dateStr) - new Date(today)) / 86400000);
  if (days === 1) return { text: "غداً", tone: "blue" };
  if (days <= 7) return { text: `بعد ${days} أيام`, tone: "blue" };
  return { text: fmtDate(dateStr), tone: "gray" };
}

const initials = (name) => {
  const p = String(name || "؟").trim().split(/\s+/);
  return (p[0]?.[0] || "؟") + (p[1]?.[0] || "");
};

function avatarEl(name, color, size, cls = "avatar") {
  const a = el("div", { class: cls, text: initials(name) });
  if (color) a.style.background = color;
  if (size) { a.style.width = size + "px"; a.style.height = size + "px"; }
  return a;
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* تجاهل */ }
  const ta = el("textarea", { style: { position: "fixed", opacity: "0", top: "0" } });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let done = false;
  try { done = document.execCommand("copy"); } catch { done = false; }
  ta.remove();
  return done;
}

// ─────────────────────────── عميل API ───────────────────────────

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function readCookie(name) {
  for (const chunk of (document.cookie || "").split(";")) {
    const i = chunk.indexOf("=");
    if (i !== -1 && chunk.slice(0, i).trim() === name) return decodeURIComponent(chunk.slice(i + 1).trim());
  }
  return "";
}

let csrfRepair = null;

/** يعيد جلب رمز CSRF من الخادم مرة واحدة عند الحاجة */
async function ensureCsrfToken() {
  let token = readCookie("cw_csrf");
  if (token) return token;
  csrfRepair = csrfRepair || fetch("/", { credentials: "same-origin" }).catch(() => null);
  await csrfRepair;
  csrfRepair = null;
  return readCookie("cw_csrf");
}

async function api(path, { method = "GET", body, headers = {} } = {}) {
  const opt = { method, credentials: "same-origin", headers: { ...headers } };
  if (method !== "GET" && method !== "HEAD") {
    if ("x-csrf-token" in opt.headers) {
      // قيمة صريحة من المستدعي تُحترم
    } else {
      opt.headers["x-csrf-token"] = await ensureCsrfToken();
    }
  }
  if (body !== undefined) { opt.headers["content-type"] = "application/json"; opt.body = JSON.stringify(body); }

  let res;
  try { res = await fetch("/api" + path, opt); }
  catch { throw new ApiError("تعذّر الاتصال بالخادم، تحقّق من الإنترنت", 0); }

  if (res.status === 204) return {};

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    if (!res.ok) throw new ApiError("حدث خطأ غير متوقع", res.status);
    return await res.text();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || "حدث خطأ غير متوقع", res.status);
  return data;
}

// ─────────────────────────── تنبيهات ونوافذ ───────────────────────────

const TOAST_ICON = { success: "i-check", error: "i-alert", info: "i-info", warn: "i-alert" };

function toast(message, kind = "info", ms = 3600) {
  const node = el("div", { class: `toast toast-${kind}`, role: "status" });
  node.innerHTML = icon(TOAST_ICON[kind] || "i-info");
  node.append(el("span", { text: message }));
  $("#toasts").append(node);
  const kill = () => { node.classList.add("is-out"); setTimeout(() => node.remove(), 350); };
  setTimeout(kill, ms);
  node.addEventListener("click", kill);
}
const toastOk = (m) => toast(m, "success");
const toastErr = (m) => toast(m, "error", 5200);

function showAlert(form, message, kind = "error") {
  let box = $("[data-error]", form);
  if (!box) {
    box = el("div", { class: "alert alert-error", "data-error": "" });
    form.insertBefore(box, form.querySelector("button[type=submit], [data-submit]") || form.lastChild);
  }
  box.className = `alert alert-${kind}`;
  box.textContent = message;
  box.hidden = false;
  box.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
function hideAlert(form) {
  const box = $("[data-error]", form);
  if (box) { box.hidden = true; box.textContent = ""; }
}

const busy = (btn, on) => { if (btn) { btn.classList.toggle("is-busy", on); btn.disabled = on; } };

const modalRoot = () => $("#modal-root");
let modalOnClose = null, lastFocus = null;

let modalPushedHistory = false;

/**
 * يفتح نافذة منبثقة.
 * - يعطيها عنواناً دائماً (لا يمكن أن تبقى بلا عنوان)
 * - يسجّل حالة في سجل التصفّح حتى يعمل زر «رجوع» في الهاتف كزر إغلاق
 */
function openModal({ title, body, footer = "", size = "", onClose = null }) {
  const root = modalRoot();
  lastFocus = document.activeElement;
  modalOnClose = onClose;
  $(".modal", root).className = "modal" + (size ? " modal-" + size : "");

  const titleNode = $("#modal-title");
  const label = String(title ?? "").trim();
  titleNode.textContent = label || "نافذة";
  if (!label) titleNode.classList.add("is-empty"); else titleNode.classList.remove("is-empty");

  const bodyNode = $("#modal-body");
  bodyNode.innerHTML = "";
  if (typeof body === "string") bodyNode.innerHTML = body; else if (body) bodyNode.append(body);
  // شبكة أمان: لا تبقَ نافذة فارغة أبداً
  if (!bodyNode.firstChild) {
    bodyNode.append(el("p", { class: "muted center small", text: "لا يوجد محتوى لعرضه." }));
  }

  const footNode = $("#modal-foot");
  footNode.innerHTML = "";
  if (typeof footer === "string") footNode.innerHTML = footer; else if (footer) footNode.append(footer);
  footNode.hidden = !footer;

  root.hidden = false;
  root.classList.remove("is-stale");
  document.body.style.overflow = "hidden";

  // زر الرجوع في الجوال يغلق النافذة
  if (!modalPushedHistory) {
    modalPushedHistory = true;
    try { history.pushState({ cwModal: 1 }, ""); } catch { /* تجاهل */ }
  }

  setTimeout(() => {
    const first = bodyNode.querySelector("input:not([type=hidden]), textarea, select, button");
    (first || $(".modal-head .icon-btn"))?.focus();
  }, 60);
}

function closeModal(fromHistory = false) {
  const root = modalRoot();
  if (root.hidden) {
    if (modalPushedHistory && !fromHistory) { modalPushedHistory = false; try { history.back(); } catch { /* تجاهل */ } }
    return;
  }
  root.hidden = true;
  $("#modal-title").textContent = "";
  $("#modal-body").innerHTML = "";
  $("#modal-foot").innerHTML = "";
  document.body.style.overflow = "";

  if (modalPushedHistory) {
    modalPushedHistory = false;
    if (!fromHistory) { try { history.back(); } catch { /* تجاهل */ } }
  }

  const cb = modalOnClose; modalOnClose = null;
  lastFocus?.focus?.();
  cb?.();
}

/** أي نافذة لا knows شيئاً تُغلق — شبكة أمان ضد النوافذ العالقة */
function purgeStaleModals() {
  const root = modalRoot();
  if (root.hidden) return;
  if ($("#modal-body").firstChild) return;
  closeModal();
}

function confirmDialog({ title, message, confirmText = "تأكيد", danger = false, icon: ic = "i-alert" }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); closeModal(); } };
    const box = el("div", { class: "row", style: { gap: "14px", alignItems: "flex-start" } });
    box.innerHTML = `<div class="stat-ico ${danger ? "t-red" : "t-amber"}" style="width:44px;height:44px;border-radius:14px">${icon(ic)}</div>
                     <p style="font-size:14.5px;line-height:1.7;flex:1">${esc(message)}</p>`;
    openModal({
      title, body: box, size: "sm", onClose: () => finish(false),
      footer: `<button class="btn btn-ghost" data-act="no">إلغاء</button>
               <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-act="yes">${esc(confirmText)}</button>`,
    });
    // نستبدل التذييل بنسخة جديدة حتى لا تتراكم المستمعات بين النوافذ
    const freshFoot = $("#modal-foot").cloneNode(true);
    $("#modal-foot").replaceWith(freshFoot);
    freshFoot.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "yes") finish(true);
      if (act === "no") finish(false);
    });
  });
}

// ─────────────────────────── الإقلاع ───────────────────────────

let booting = false;

async function boot() {
  if (booting) return;
  booting = true;
  try {
    // إعادة تحميل قد تترك نافذة منبثقة مفتوحة ⇒ نغلقها
    closeModal(true);
    const health = await api("/health").catch(() => null);
    if (!health?.ok) {
      showAuth("login");
      $(".auth-card").append(el("div", { class: "alert alert-error", style: { marginTop: "16px" } },
        "تعذّر الاتصال بقاعدة البيانات. نفّذ ترحيل المخطط على D1 ثم أعد المحاولة."));
      return;
    }

    let me;
    try { me = await api("/auth/me"); }
    catch (err) {
      if (err.status === 401) { showAuth("login"); return; }
      throw err;
    }

    applySession(me);
    $("#auth-page").hidden = true;
    $("#app").hidden = false;

    await Promise.all([loadWorkspaces(), loadInvites()]);
    await navigate(location.hash.replace(/^#\/?/, "") || (state.workspace ? "dashboard" : "welcome"));
  } catch (err) {
    console.error(err);
    showAuth("login");
    toastErr(err.message || "تعذّر تشغيل التطبيق");
  } finally {
    booting = false;
    const sp = $("#splash");
    if (sp) { sp.classList.add("is-hidden"); setTimeout(() => sp.remove(), 350); }
  }
}

function applySession(me) {
  state.user = me.user;
  state.workspace = me.workspace;
  state.membership = me.membership;
  state.isAdmin = !!me.isAdmin;
  state.isOwner = !!me.isOwner;
  state.badges = me.badges || {};
  state.invites = me.invites || 0;
  renderShell();
}

function showAuth(mode) {
  $("#splash")?.classList.add("is-hidden");
  $("#auth-page").hidden = false;
  $("#app").hidden = true;
  setAuthTab(mode);
  initPwToggles($("#auth-page"));
  setTimeout(() => $(mode === "login" ? "#lg-user" : "#rg-name")?.focus(), 120);
}

function setAuthTab(mode) {
  $("#tab-login").classList.toggle("is-active", mode === "login");
  $("#tab-register").classList.toggle("is-active", mode === "register");
  $("#tab-login").setAttribute("aria-selected", mode === "login");
  $("#tab-register").setAttribute("aria-selected", mode === "register");
  $("#form-login").hidden = mode !== "login";
  $("#form-register").hidden = mode !== "register";
}

// ─────────────────────────── المصادقة ───────────────────────────

function initPwToggles(root = document) {
  $$(".pw-toggle", root).forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.pw);
      if (!input) return;
      const shown = input.type === "text";
      input.type = shown ? "password" : "text";
      btn.parentElement.classList.toggle("is-shown", !shown);
      btn.setAttribute("aria-label", shown ? "إظهار كلمة المرور" : "إخفاء كلمة المرور");
      input.focus();
    });
  });
}

function bindAuth() {
  $("#tab-login").addEventListener("click", () => setAuthTab("login"));
  $("#tab-register").addEventListener("click", () => setAuthTab("register"));

  // روابط التبديل بين التبويبين
  $$("[data-goto]").forEach((btn) =>
    btn.addEventListener("click", () => setAuthTab(btn.dataset.goto))
  );

  const lf = $("#form-login");
  lf.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAlert(lf);
    const btn = lf.querySelector("button[type=submit]");
    const fd = new FormData(lf);
    busy(btn, true);
    try {
      await api("/auth/login", { method: "POST", body: { username: fd.get("username"), password: fd.get("password") } });
      $("#lg-pass").value = "";
      toastOk("أهلاً بك من جديد");
      await boot();
    } catch (err) {
      showAlert(lf, err.message);
      if (err.status === 401 || err.status === 429) {
        $("#lg-pass").value = "";
        const hint = $("#login-hint");
        if (hint && err.status === 401) {
          hint.textContent = "اسم المستخدم غير صحيح أو لم يُسجَّل بعد — جرّب تبويب «حساب جديد» لإنشاء حسابك.";
        }
      }
    } finally { busy(btn, false); }
  });

  const rf = $("#form-register");
  rf.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAlert(rf);
    const btn = rf.querySelector("button[type=submit]");
    const fd = new FormData(rf);
    if (fd.get("password") !== fd.get("password2")) return showAlert(rf, "كلمتا المرور غير متطابقتين");

    busy(btn, true);
    try {
      const res = await api("/auth/register", {
        method: "POST",
        body: {
          fullName: fd.get("fullName"),
          username: String(fd.get("username") || "").trim().toLowerCase(),
          password: fd.get("password"),
          workspaceName: fd.get("workspaceName") || undefined,
          workspaceTagline: fd.get("workspaceTagline") || undefined,
        },
      });
      rf.reset();
      $("#user-state").textContent = "";
      toastOk(`أهلاً ${res.user.fullName} — أُنشئت حسابك وبيئتك`);
      await boot();
    } catch (err) {
      showAlert(rf, err.message);
    } finally { busy(btn, false); }
  });

  [lf, rf].forEach((f) => f.addEventListener("input", () => hideAlert(f)));

  let uTimer;
  $("#rg-user").addEventListener("input", (e) => {
    clearTimeout(uTimer);
    const v = e.target.value.trim().toLowerCase();
    const badge = $("#user-state");
    badge.textContent = ""; badge.className = "user-state";
    if (!/^[a-z0-9._-]{3,32}$/.test(v)) return;
    uTimer = setTimeout(async () => {
      try {
        const r = await api("/auth/check-username?username=" + encodeURIComponent(v));
        badge.textContent = r.available ? "متاح" : "محجوز";
        badge.className = "user-state " + (r.available ? "ok" : "no");
      } catch { /* تجاهل */ }
    }, 380);
  });
}

// ─────────────────────────── هيكل التطبيق ───────────────────────────

function renderShell() {
  const u = state.user;
  const ws = state.workspace;

  document.title = ws ? `${ws.name} — CheckWork` : "منصّة إدارة الأعمال";

  $("#sb-name").textContent = u.fullName;
  $("#sb-role2").textContent = u.jobTitle || u.username;
  const av = $("#sb-avatar");
  av.textContent = initials(u.fullName);
  av.style.background = u.avatarColor || "var(--brand)";

  const wsn = $("#ws-name"), wsr = $("#ws-role"), wsa = $("#ws-avatar");
  if (ws) {
    wsn.textContent = ws.name;
    wsr.textContent = ROLE_LABEL[state.membership?.role] || "عضو";
    wsa.innerHTML = "";
    wsa.append(el("span", { text: initials(ws.name), style: { color: "#fff", fontWeight: "750", fontSize: "14px" } }));
    wsa.style.background = ws.avatarColor || "var(--brand)";
  } else {
    wsn.textContent = "لا توجد بيئة نشطة";
    wsr.textContent = "اختر أو أنشئ بيئة";
    wsa.innerHTML = icon("i-plus");
    wsa.style.background = "var(--surface-3)";
  }

  const nav = [
    { id: "dashboard", label: "لوحة التحكم", icon: "i-dash", show: !!ws },
    { id: "tasks",     label: "المهمات",    icon: "i-task", show: !!ws, badge: "openTasks" },
    { id: "done",      label: "سجل الإنجاز", icon: "i-check", show: !!ws },
    { id: "todos",     label: "قوائم TODO", icon: "i-checklist", show: true, badge: "openTodos" },
    { id: "members",   label: "الأعضاء",    icon: "i-users", show: state.isAdmin },
    { id: "reports",   label: "التقارير",   icon: "i-chart", show: state.isAdmin },
    { id: "activity",  label: "سجل النشاط", icon: "i-history", show: !!ws },
    { id: "settings",  label: "الإعدادات",  icon: "i-settings", show: state.isAdmin },
  ];

  const navNode = $("#sb-nav");
  navNode.innerHTML = "";
  navNode.append(el("div", { class: "sb-group", text: "العمل" }));
  for (const item of nav) {
    if (!item.show) continue;
    const btn = el("button", {
      class: "sb-item", type: "button", dataset: { view: item.id },
      onclick: () => { navigate(item.id); closeSidebar(); },
    });
    btn.innerHTML = icon(item.icon) + `<span>${item.label}</span>`;
    if (item.id === "members") {
      const pend = state.members.filter((m) => m.status === "pending").length;
      if (pend) btn.append(el("span", { class: "badge badge-amber", text: String(pend) }));
    } else if (item.badge && state.badges[item.badge]) {
      btn.append(el("span", { class: "badge badge-brand", text: String(state.badges[item.badge]) }));
    }
    navNode.append(btn);
  }

  const inv = $("#sb-invite");
  if (state.invites > 0) {
    inv.hidden = false;
    inv.innerHTML = icon("i-mail") + "<span>دعوات واردة</span>";
    inv.append(el("span", { class: "badge", text: String(state.invites) }));
    inv.onclick = () => { navigate("invites"); closeSidebar(); };
  } else inv.hidden = true;

  $("#btn-quick-todo").hidden = !ws;
  $("#btn-quick-todo").onclick = () => { state.isAdmin ? openTaskForm() : openTodoForm(); };
}

// ─────────────────────────── بيانات مشتركة ───────────────────────────

async function loadWorkspaces() {
  try { state.workspaces = (await api("/workspaces")).workspaces || []; }
  catch { state.workspaces = []; }
}

async function loadInvites() {
  try { const r = await api("/invites"); state.inviteList = r.invites || []; state.invites = r.invites?.length || 0; }
  catch { state.invites = 0; state.inviteList = []; }
}

async function loadMembers(force = false) {
  if (state.members.length && !force) return state.members;
  try { state.members = (await api("/members")).members || []; }
  catch { state.members = []; }
  return state.members;
}

// ─────────────────────────── مبدّل بيئات العمل ───────────────────────────

function toggleWsMenu() {
  const menu = $("#ws-menu");
  if (!menu.hidden) { menu.hidden = true; $("#btn-ws").setAttribute("aria-expanded", "false"); return; }

  menu.innerHTML = "";
  for (const w of state.workspaces) {
    const item = el("button", {
      class: "ws-item" + (w.id === state.workspace?.id ? " is-active" : ""),
      type: "button", role: "option", onclick: () => switchWorkspace(w.id),
    });
    const badge = el("div", { class: "logo-xs", text: initials(w.name) });
    badge.style.background = w.avatarColor || "var(--brand)";
    item.append(badge, el("div", { class: "ws-item-text" },
      el("strong", { text: w.name }),
      el("span", { text: `${ROLE_LABEL[w.role] || "عضو"} · ${w.memberCount} عضو${w.pendingCount ? ` · ${w.pendingCount} بانتظار` : ""}` })));
    if (w.id === state.workspace?.id) item.append(el("span", { class: "badge badge-green", text: "نشطة" }));
    menu.append(item);
  }

  menu.append(el("div", { class: "ws-sep" }));
  const newBtn = el("button", { class: "ws-item ws-new", type: "button", onclick: () => { menu.hidden = true; openWorkspaceForm(); } });
  newBtn.innerHTML = icon("i-plus") + "<span>بيئة عمل جديدة</span>";
  menu.append(newBtn);

  menu.hidden = false;
  $("#btn-ws").setAttribute("aria-expanded", "true");
}

async function switchWorkspace(id) {
  $("#ws-menu").hidden = true;
  if (id === state.workspace?.id) return;
  try {
    await api(`/workspaces/${id}/switch`, { method: "POST" });
    state.filter.assigneeId = ""; state.filter.status = "all";
    state.members = [];
    toastOk("تم تبديل بيئة العمل");
    await boot();
  } catch (err) { toastErr(err.message); }
}

function openWorkspaceForm() {
  const form = el("form", { class: "stack" });
  form.append(el("div", { class: "field" },
    el("label", { for: "wf-name", text: "اسم بيئة العمل *" }),
    el("input", { id: "wf-name", name: "name", required: true, minlength: "2", maxlength: "80", placeholder: "مثال: مكتب الاستشارات" })));
  form.append(el("div", { class: "field" },
    el("label", { for: "wf-tag", text: "وصف مختصر" }),
    el("input", { id: "wf-tag", name: "tagline", maxlength: "120", placeholder: "مثال: دراسات جدوى وإدارة مشاريع" })));

  openModal({
    title: "بيئة عمل جديدة", body: form, size: "sm",
    footer: `<button class="btn btn-ghost" data-close>إلغاء</button>
             <button class="btn btn-primary" data-submit>إنشاء</button>`,
  });
  $("#modal-foot").querySelector("[data-submit]").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    const fd = new FormData(form);
    busy(b, true);
    try {
      await api("/workspaces", { method: "POST", body: { name: fd.get("name"), tagline: fd.get("tagline") } });
      closeModal();
      toastOk("أُنشئت بيئة العمل");
      state.members = [];
      await boot();
    } catch (err) { showAlert(form, err.message); busy(b, false); }
  });
}

// ─────────────────────────── التنقل ───────────────────────────

const VIEWS = {
  welcome:   { title: "ابدأ",           render: renderWelcome },
  invites:   { title: "الدعوات",       render: renderInvites },
  dashboard: { title: "لوحة التحكم",    render: renderDashboard },
  tasks:     { title: "المهمات",       render: renderTasks },
  done:      { title: "سجل الإنجاز",   render: renderDone },
  todos:     { title: "قوائم TODO",    render: renderTodos },
  members:   { title: "الأعضاء",       render: renderMembers },
  reports:   { title: "تقارير الأداء", render: renderReports },
  activity:  { title: "سجل النشاط",    render: renderActivity },
  settings:  { title: "الإعدادات",     render: renderSettings },
  profile:   { title: "الملف الشخصي",  render: renderProfile },
};

async function navigate(view, push = true) {
  if (!VIEWS[view]) view = state.workspace ? "dashboard" : "welcome";
  state.view = view;
  state.cache = {};

  $$(".sb-item").forEach((b) => b.classList.toggle("is-active", b.dataset.view === view));

  $("#page-title").textContent = VIEWS[view].title;
  $("#page-sub").textContent = "";
  const wrap = $("#page-wrap");
  wrap.innerHTML = "";
  wrap.append(skeletonPage());

  if (push && location.hash !== "#/" + view) history.pushState(null, "", "#/" + view);
  window.scrollTo({ top: 0 });

  try {
    const node = await VIEWS[view].render();
    wrap.innerHTML = "";
    if (node) wrap.append(node);
  } catch (err) {
    console.error(err);
    wrap.innerHTML = "";
    wrap.append(el("div", { class: "card" }, el("div", { class: "card-body" },
      el("div", { class: "empty" },
        el("div", { class: "empty-ico" }, el("span", { html: icon("i-alert") })),
        el("h3", { text: "تعذّر تحميل الصفحة" }),
        el("p", { text: err.message }),
        el("button", { class: "btn btn-primary", text: "إعادة المحاولة", onclick: () => navigate(view, false) })))));
  }
}

function skeletonPage() {
  const page = el("div", { class: "page" });
  const stats = el("div", { class: "stats" });
  for (let i = 0; i < 4; i++) stats.append(el("div", { class: "skel skel-card" }));
  const list = el("div", { class: "task-list" });
  for (let i = 0; i < 4; i++) list.append(el("div", { class: "skel skel-row" }));
  page.append(stats, list);
  return page;
}

function emptyState(ic, title, message, action) {
  const node = el("div", { class: "empty" });
  node.innerHTML = `<div class="empty-ico">${icon(ic)}</div><h3>${esc(title)}</h3><p>${esc(message)}</p>`;
  if (action) node.append(el("button", { class: "btn btn-primary", html: icon("i-plus") + `<span>${esc(action.label)}</span>`, onclick: action.onClick }));
  return node;
}

function feedItem(a) {
  const meta = ACTION_META[a.action] || { icon: "i-info", tone: "gray", label: a.action };
  const node = el("div", { class: "feed-item" });
  node.innerHTML = `<div class="feed-ico t-${meta.tone}">${icon(meta.icon)}</div>
    <div class="feed-text"><div><b>${esc(a.actorName)}</b> — ${esc(a.details || meta.label)}</div>
    <div class="feed-time">${esc(fmtRelative(a.createdAt))}</div></div>`;
  return node;
}

// ═══════════════════════════════════════════════════════════
//  صفحة البدء والدعوات
// ═══════════════════════════════════════════════════════════

async function renderWelcome() {
  const page = el("div", { class: "page" });
  $("#page-sub").textContent = "أنشئ بيئة عمل أو اقبل دعوة للانضمام";

  const card = el("div", { class: "card" });
  const body = el("div", { class: "card-body stack" });
  body.append(el("div", { class: "notice notice-info", html: icon("i-info") +
    "<span>كل حساب في المنصّة يبدأ بحالته الخاصة. أنشئ بيئة عملك، ثم ادعُ زملاءك بأسماء المستخدمين.</span>" }));

  const actions = el("div", { class: "grid-2" });
  actions.append(
    el("div", { class: "block" },
      el("div", { class: "block-label", html: icon("i-layers") + "<span>بيئة جديدة</span>" }),
      el("p", { class: "small muted", style: { marginBottom: "12px" }, text: "أنشئ بيئة مستقلة تجمع فريقك وأعضاءه." }),
      el("button", { class: "btn btn-primary btn-block", html: icon("i-plus") + "<span>إنشاء بيئة عمل</span>", onclick: openWorkspaceForm })),
    el("div", { class: "block" },
      el("div", { class: "block-label", html: icon("i-mail") + "<span>دعوة واردة</span>" }),
      el("p", { class: "small muted", style: { marginBottom: "12px" }, text: "إذا دعاك أحدهم باسم المستخدم فستجد الدعوة هنا." }),
      el("button", { class: "btn btn-ghost btn-block", html: icon("i-bell") + "<span>عرض الدعوات</span>", onclick: () => navigate("invites") })),
  );
  body.append(actions);

  if (state.inviteList?.length) {
    body.append(el("div", { class: "block" },
      el("div", { class: "block-label", html: icon("i-bell") + `<span>لديك ${state.inviteList.length} دعوة بانتظار موافقتك</span>` }),
      inviteCard(state.inviteList[0])));
  }

  card.append(body);
  page.append(card);

  if (state.workspaces.length > 1) {
    const c2 = el("div", { class: "card" });
    c2.append(el("div", { class: "card-head" }, el("div", {}, el("h2", { text: "بيئات عملك" }))));
    const list = el("div", { class: "card-body stack" });
    for (const w of state.workspaces) {
      const row = el("button", { class: "task", type: "button", style: { textAlign: "start" }, onclick: () => switchWorkspace(w.id) });
      row.innerHTML = `
        <div class="task-head">
          <div style="width:38px;height:38px;border-radius:12px;display:grid;place-items:center;color:#fff;font-weight:750;background:${esc(w.avatarColor || "var(--brand)")}">${esc(initials(w.name))}</div>
          <div class="task-main">
            <div class="task-title">${esc(w.name)}</div>
            <div class="task-meta">
              <span class="role-tag role-${w.role}">${esc(ROLE_LABEL[w.role])}</span>
              <span class="chip-tag">${icon("i-users")}<span>${w.memberCount} عضو</span></span>
              ${w.pendingCount ? `<span class="chip-tag t-amber">${w.pendingCount} بانتظار الموافقة</span>` : ""}
            </div>
          </div>
          <span class="icon-btn">${icon("i-arrow-right")}</span>
        </div>`;
      list.append(row);
    }
    c2.append(list);
    page.append(c2);
  }
  return page;
}

function inviteCard(inv) {
  const card = el("div", { class: "invite-card" });
  const top = el("div", { class: "invite-top" });
  const badge = el("div", { class: "logo-md", text: initials(inv.workspace.name) });
  badge.style.background = inv.workspace.avatarColor || "var(--brand)";
  top.append(badge, el("div", { class: "invite-top-text" },
    el("strong", { text: inv.workspace.name }),
    el("span", { text: `${ROLE_LABEL[inv.role]} · ${inv.workspace.memberCount} عضو · ${fmtRelative(inv.invitedAt)}` })));
  card.append(top);

  const by = el("div", { class: "invite-by" });
  by.append(avatarEl(inv.inviter.fullName, inv.inviter.avatarColor, 30));
  by.append(el("div", { style: { flex: "1" } },
    el("div", { style: { fontWeight: "650", fontSize: "13.5px" }, text: inv.inviter.fullName }),
    el("div", { class: "small muted", text: `@${inv.inviter.username} — دعاك للانضمام` })));
  card.append(by);

  const acts = el("div", { class: "row" });
  acts.append(
    el("button", { class: "btn btn-success", style: { flex: "1" }, html: icon("i-check") + "<span>قبول والانضمام</span>",
      onclick: async (e) => {
        busy(e.currentTarget, true);
        try { await api(`/invites/${inv.id}/accept`, { method: "POST" }); closeModal(); toastOk(`أهلاً بك في ${inv.workspace.name}`); state.members = []; await boot(); }
        catch (err) { toastErr(err.message); busy(e.currentTarget, false); }
      } }),
    el("button", { class: "btn btn-ghost", style: { flex: "1" }, text: "رفض",
      onclick: async (e) => {
        busy(e.currentTarget, true);
        try { await api(`/invites/${inv.id}/decline`, { method: "POST" }); toastOk("تم رفض الدعوة"); await boot(); }
        catch (err) { toastErr(err.message); busy(e.currentTarget, false); }
      } }),
  );
  card.append(acts);
  inv.card = card;
  return card;
}

async function renderInvites() {
  const page = el("div", { class: "page" });
  await loadInvites();
  renderShell();
  $("#page-sub").textContent = `${state.inviteList.length} دعوة`;

  const card = el("div", { class: "card" });
  card.append(el("div", { class: "card-head" },
    el("div", {}, el("h2", { text: "الدعوات الواردة" }),
      el("p", { text: "الدعوات التي أُرسلت إلى اسم المستخدم الخاص بك" }))));
  const body = el("div", { class: "card-body stack" });
  if (!state.inviteList.length) {
    body.append(emptyState("i-mail", "لا توجد دعوات", "عندما يدعوك أحدهم إلى بيئة عمل ستجد الدعوة هنا."));
  } else {
    for (const inv of state.inviteList) body.append(inviteCard(inv));
  }
  card.append(body);
  page.append(card);
  return page;
}
// ═══════════════════════════════════════════════════════════
//  لوحة التحكم
// ═══════════════════════════════════════════════════════════

async function renderDashboard() {
  if (!state.workspace) return navigate("welcome", false);
  const [stats, tasks, todos, activity] = await Promise.all([
    api("/stats"), api("/tasks?limit=6"), api("/todos?view=open"), api("/activity?limit=8"),
  ]);
  if (state.isAdmin) await loadMembers();

  const t = stats.totals;
  const page = el("div", { class: "page" });
  $("#page-sub").textContent = state.isAdmin
    ? `ملخّص ${state.workspace.name}`
    : `${t.open} مهمة قيد التنفيذ · ${stats.todos.open} عنصر قائمة`;

  const cards = el("div", { class: "stats" });
  const addStat = (label, value, tone, ic, sub, view, filt) => {
    const node = el(view ? "button" : "div", {
      class: "stat", type: view ? "button" : null,
      onclick: view ? () => { if (filt) Object.assign(state.filter, filt); navigate(view); } : null,
    });
    node.innerHTML = `
      <div class="stat-top"><div class="stat-ico t-${tone}">${icon(ic)}</div><span class="stat-label">${esc(label)}</span></div>
      <div class="stat-value">${esc(String(value))}</div>
      ${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ""}`;
    return node;
  };

  cards.append(
    addStat("مهام مفتوحة", t.open, "brand", "i-task", t.new ? `${t.new} جديدة بانتظار القراءة` : "لا جديد", "tasks", { status: "all" }),
    addStat("منجز", t.done, "green", "i-check", `${t.completionRate}% من الإجمالي`, "done"),
    addStat("متأخرة", t.overdue, t.overdue ? "red" : "gray", "i-alert", t.dueToday ? `${t.dueToday} مستحقة اليوم` : "لا تأخير", "tasks", { when: "overdue" }),
    addStat("عناصر القائمة", stats.todos.open, "violet", "i-checklist", `${stats.todos.private} خاصة · ${stats.todos.sharedOpen} مشتركة`, "todos"),
  );
  if (state.isAdmin) cards.append(addStat("الأعضاء", `${t.membersActive}/${t.membersTotal}`, "blue", "i-users", "فعّال من الإجمالي", "members"));
  page.append(cards);

  const dist = el("div", { class: "card" });
  dist.append(el("div", { class: "card-head" }, el("div", {}, el("h2", { text: "توزيع المهمات" }), el("p", { text: "حسب حالة الإنجاز" }))));
  const distBody = el("div", { class: "card-body" });
  const buckets = [
    { label: "جديد", value: t.new, color: "var(--blue)" },
    { label: "مقروء", value: t.read, color: "var(--amber)" },
    { label: "منجز", value: t.done, color: "var(--green)" },
    { label: "ملغي", value: t.cancelled, color: "var(--text-3)" },
    { label: "متأخر", value: t.overdue, color: "var(--red)" },
  ].filter((b) => b.value > 0);
  if (!buckets.length) distBody.append(el("p", { class: "muted center small", text: "لا توجد مهمات بعد" }));
  else {
    const max = Math.max(...buckets.map((b) => b.value));
    const bar = el("div", { style: { display: "grid", gap: "9px" } });
    for (const b of buckets) {
      const row = el("div", { style: { display: "grid", gridTemplateColumns: "78px 1fr 46px", gap: "11px", alignItems: "center" } });
      row.innerHTML = `<span class="small" style="font-weight:650">${esc(b.label)}</span>
        <div class="bar"><i style="width:${Math.round((b.value / max) * 100)}%;background:${b.color}"></i></div>
        <span class="small mono center" style="font-weight:700">${b.value}</span>`;
      bar.append(row);
    }
    distBody.append(bar);
  }
  dist.append(distBody);

  let staff = null;
  if (state.isAdmin && state.members.length) {
    staff = el("div", { class: "card" });
    staff.append(el("div", { class: "card-head" },
      el("div", {}, el("h2", { text: "أداء الفريق" }), el("p", { text: "حسب المهام المنجزة" })),
      el("div", { class: "card-head-actions" },
        el("button", { class: "btn btn-ghost btn-sm", html: icon("i-chart") + "<span>التقارير</span>", onclick: () => navigate("reports") }))));
    const sb = el("div", { class: "card-body" });
    const sorted = state.members.filter((m) => m.status === "active").sort((a, b) => b.doneTasks - a.doneTasks).slice(0, 5);
    for (const m of sorted) {
      const line = el("div", { class: "row", style: { justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" } });
      line.innerHTML = `
        <div class="cell-user">
          <div class="avatar" style="background:${esc(m.avatarColor)}">${esc(initials(m.fullName))}</div>
          <div class="cell-user-text"><strong>${esc(m.fullName)}</strong><span>${esc(m.jobTitle || ROLE_LABEL[m.role])}</span></div>
        </div>
        <div style="display:flex;align-items:center;gap:9px;min-width:140px">
          <div class="bar" style="flex:1"><i style="width:${m.completionRate}%"></i></div>
          <span class="small mono" style="font-weight:700">${m.doneTasks}/${m.totalTasks}</span>
        </div>`;
      sb.append(line);
    }
    staff.append(sb);
  }

  if (staff) {
    const grid = el("div", { class: "grid-2" });
    grid.append(dist, staff);
    page.append(grid);
  } else page.append(dist);

  const recent = tasks.tasks.slice(0, 5);
  if (recent.length) {
    const c = el("div", { class: "card" });
    c.append(el("div", { class: "card-head" },
      el("div", {}, el("h2", { text: state.isAdmin ? "آخر المهمات" : "مهامي الأخيرة" }), el("p", { text: "أحدث 5 مهام" })),
      el("div", { class: "card-head-actions" },
        el("button", { class: "btn btn-ghost btn-sm", html: icon("i-eye-view") + "<span>الكل</span>", onclick: () => navigate("tasks") }))));
    const b = el("div", { class: "card-body" });
    const list = el("div", { class: "task-list" });
    recent.forEach((x) => list.append(taskCard(x)));
    b.append(list);
    c.append(b);
    page.append(c);
  }

  if (todos.todos.length) {
    const c = el("div", { class: "card" });
    c.append(el("div", { class: "card-head" },
      el("div", {}, el("h2", { text: "قوائم TODO" }), el("p", { text: "عناصر لم تُنجز بعد" })),
      el("div", { class: "card-head-actions" },
        el("button", { class: "btn btn-ghost btn-sm", html: icon("i-plus") + "<span>عنصر جديد</span>", onclick: () => openTodoForm() }))));
    const b = el("div", { class: "card-body" });
    b.append(todoList(todos.todos.slice(0, 6)));
    c.append(b);
    page.append(c);
  }

  const act = el("div", { class: "card" });
  act.append(el("div", { class: "card-head" },
    el("div", {}, el("h2", { text: "آخر الأحداث" })),
    el("div", { class: "card-head-actions" },
      el("button", { class: "btn btn-ghost btn-sm", html: icon("i-history") + "<span>السجل</span>", onclick: () => navigate("activity") }))));
  const ab = el("div", { class: "card-body" });
  if (activity.activity.length) {
    const feed = el("div", { class: "feed" });
    activity.activity.forEach((a) => feed.append(feedItem(a)));
    ab.append(feed);
  } else ab.append(el("p", { class: "muted center small", text: "لا يوجد نشاط" }));
  act.append(ab);
  page.append(act);

  return page;
}

// ═══════════════════════════════════════════════════════════
//  المهمات
// ═══════════════════════════════════════════════════════════

function taskQuery(extra = {}) {
  const f = state.filter;
  const p = new URLSearchParams();
  const merged = { status: f.status, priority: f.priority, when: f.when, q: f.q, sort: f.sort, assigneeId: f.assigneeId, scope: f.scope, ...extra };
  for (const [k, v] of Object.entries(merged)) {
    if (!v || v === "all") continue;
    if (k === "scope" && !state.isAdmin) continue;
    p.set(k, v);
  }
  return p.toString();
}

function findMemberColor(id) {
  return state.members.find((m) => m.userId === id)?.avatarColor || null;
}

function taskCard(task) {
  const st = STATUS[task.status] || STATUS.new;
  const pr = PRIORITY[task.priority] || PRIORITY.normal;
  const due = task.dueDate ? dueLabel(task.dueDate) : null;

  const node = el("div", {
    class: `task st-${task.status}` + (task.overdue ? " is-overdue" : ""),
    tabindex: "0", role: "button",
    onclick: (e) => { if (!e.target.closest("button,select,input")) openTask(task.id); },
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTask(task.id); } },
  });

  const head = el("div", { class: "task-head" });
  head.append(el("button", {
    class: "task-check" + (task.status === "done" ? " is-done" : ""),
    type: "button", title: task.status === "done" ? "إعادة فتح" : "تعليم كمنجز",
    html: icon("i-check"),
    onclick: async (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      btn.style.opacity = ".5";
      try {
        if (task.status === "done") await api(`/tasks/${task.id}`, { method: "PATCH", body: { reopen: true } });
        else await api(`/tasks/${task.id}`, { method: "PATCH", body: { markDone: true } });
        toastOk(task.status === "done" ? "أُعيد فتح المهمة" : "تم إنجاز المهمة");
        refreshCurrent();
      } catch (err) { toastErr(err.message); btn.style.opacity = "1"; }
    },
  }));

  const main = el("div", { class: "task-main" });
  main.append(el("div", { class: "task-title", text: task.title }));
  if (task.description) main.append(el("div", { class: "task-desc", text: task.description }));

  const meta = el("div", { class: "task-meta" });
  meta.append(el("span", { class: `chip-tag t-${st.tone}`, html: icon(st.icon) + `<span>${st.label}</span>` }));
  meta.append(el("span", { class: `chip-tag t-${pr.tone}`, text: pr.label }));

  if (state.isAdmin) {
    const chip = el("span", { class: "chip-person" });
    chip.append(avatarEl(task.assigneeName, findMemberColor(task.assigneeId)), el("span", { text: task.assigneeName }));
    meta.append(chip);
  } else if (task.creatorName && task.creatorName !== state.user.fullName) {
    meta.append(el("span", { class: "chip-tag", html: icon("i-user") + `<span>${esc(task.creatorName)}</span>` }));
  }
  if (due && !["done", "cancelled"].includes(task.status)) {
    meta.append(el("span", { class: `chip-tag t-${due.tone}`, html: icon("i-calendar") + `<span>${esc(due.text)}</span>` }));
  }
  if (task.completedAt) meta.append(el("span", { class: "chip-tag t-green", html: icon("i-check") + `<span>${esc(fmtRelative(task.completedAt))}</span>` }));
  main.append(meta);

  if (task.resultNote) {
    main.append(el("div", { class: "block", style: { marginTop: "11px", padding: "10px 13px" } },
      el("div", { class: "block-label", html: icon("i-check") + "<span>نتيجة الإنجاز</span>" }),
      el("div", { class: "block-text small", text: task.resultNote })));
  }

  const acts = el("div", { class: "task-actions" });
  if (task.status === "new" && task.assigneeId === state.user.id) {
    acts.append(el("button", { class: "btn btn-soft btn-sm", html: icon("i-eye-view") + "<span>تعليم كمقروء</span>", onclick: async (e) => {
      e.stopPropagation();
      const b = e.currentTarget; b.classList.add("is-busy");
      try { await api(`/tasks/${task.id}`, { method: "PATCH", body: { markRead: true } }); toastOk("تم التعليم كمقروء"); refreshCurrent(); }
      catch (err) { toastErr(err.message); b.classList.remove("is-busy"); }
    } }));
  }
  if (!["done", "cancelled"].includes(task.status)) {
    acts.append(el("button", { class: "btn btn-success btn-sm", html: icon("i-check") + "<span>إنجاز</span>",
      onclick: (e) => { e.stopPropagation(); openCompleteForm(task); } }));
  }
  acts.append(el("button", { class: "btn btn-ghost btn-sm", html: icon("i-eye-view") + "<span>التفاصيل</span>",
    onclick: (e) => { e.stopPropagation(); openTask(task.id); } }));

  node.append(head);
  node.append(acts);
  head.append(main);
  return node;
}

async function renderTasks() {
  if (!state.workspace) return navigate("welcome", false);
  const page = el("div", { class: "page" });
  if (state.isAdmin) await loadMembers();
  page.append(tasksToolbar());

  const holder = el("div");
  page.append(holder);

  const data = await api("/tasks?" + taskQuery());
  state.cache.tasks = data;

  const card = el("div", { class: "card" });
  const st = STATUS[state.filter.status];
  card.append(el("div", { class: "card-head" },
    el("div", {}, el("h2", { text: st ? `مهام ${st.label}` : state.isAdmin ? "كل المهمات" : "مهامي" }),
      el("p", { text: `${data.total} مهمة` })),
    el("div", { class: "card-head-actions" },
      el("button", { class: "btn btn-ghost btn-sm", html: icon("i-download") + "<span>CSV</span>", onclick: () => { window.location.href = "/api/export/tasks.csv"; } }),
      el("button", { class: "btn btn-ghost btn-sm", html: icon("i-print") + "<span>طباعة</span>", onclick: () => window.print() }),
      state.isAdmin ? el("button", { class: "btn btn-primary btn-sm", html: icon("i-plus") + "<span>مهمة جديدة</span>", onclick: () => openTaskForm() }) : null,
    )));

  const body = el("div", { class: "card-body" });
  if (!data.tasks.length) {
    body.append(emptyState("i-task", "لا توجد مهام", state.isAdmin ? "أسند أول مهمة لأحد الأعضاء." : "لا توجد مهام مسندة إليك.",
      state.isAdmin ? { label: "إنشاء مهمة", onClick: () => openTaskForm() } : null));
  } else {
    const list = el("div", { class: "task-list" });
    data.tasks.forEach((t) => list.append(taskCard(t)));
    body.append(list);
  }
  card.append(body);
  holder.append(card);
  return page;
}

function tasksToolbar() {
  const bar = el("div", { class: "toolbar" });

  const search = el("div", { class: "search-box grow" });
  search.innerHTML = icon("i-search");
  const input = el("input", { type: "search", placeholder: "ابحث في المهام…", value: state.filter.q });
  search.append(input);
  let timer;
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { state.filter.q = input.value; refreshCurrent(); }, 340); });
  bar.append(search);

  const mkSelect = (options, current, onChange) => {
    const s = el("select", { style: { width: "auto", minWidth: "128px" } });
    for (const [v, l] of options) {
      const o = el("option", { value: v, text: l });
      if (String(current) === String(v)) o.selected = true;
      s.append(o);
    }
    s.addEventListener("change", () => onChange(s.value));
    return s;
  };

  if (state.isAdmin) {
    bar.append(mkSelect([["all", "كل الأعضاء"], ["mine", "مهامّي"], ["created_by_me", "أنشأتها"]], state.filter.scope, (v) => { state.filter.scope = v; refreshCurrent(); }));

    const who = el("select", { style: { width: "auto", minWidth: "140px" } });
    who.append(el("option", { value: "", text: "كل الموظفين" }));
    for (const m of state.members.filter((x) => x.status === "active")) {
      const o = el("option", { value: String(m.userId), text: m.fullName });
      if (String(state.filter.assigneeId) === String(m.userId)) o.selected = true;
      who.append(o);
    }
    who.addEventListener("change", () => { state.filter.assigneeId = who.value; refreshCurrent(); });
    bar.append(who);
  }

  bar.append(mkSelect([["all", "كل الحالات"], ["new", "جديدة"], ["read", "مقروءة"], ["done", "منجزة"], ["cancelled", "ملغاة"]], state.filter.status, (v) => { state.filter.status = v; refreshCurrent(); }));
  bar.append(mkSelect([["all", "كل الأوقات"], ["today", "مستحقة اليوم"], ["week", "هذا الأسبوع"], ["overdue", "المتأخرة"], ["month", "آخر 30 يوم"]], state.filter.when, (v) => { state.filter.when = v; refreshCurrent(); }));
  bar.append(mkSelect([["newest", "الأحدث"], ["oldest", "الأقدم"], ["due", "الاستحقاق"], ["priority", "الأولوية"], ["title", "العنوان"]], state.filter.sort, (v) => { state.filter.sort = v; refreshCurrent(); }));

  bar.append(el("button", { class: "btn btn-ghost btn-sm", html: icon("i-refresh") + "<span>مسح</span>", onclick: () => {
    state.filter = { status: "all", priority: "all", when: "all", q: "", sort: "newest", assigneeId: "", scope: "all" };
    refreshCurrent();
  } }));

  if (state.isAdmin) bar.append(el("button", { class: "btn btn-primary", html: icon("i-plus") + "<span>مهمة جديدة</span>", onclick: () => openTaskForm() }));
  return bar;
}

async function openTask(id) {
  openModal({ title: "تفاصيل المهمة", body: el("div", { class: "skel", style: { height: "160px" } }), size: "lg", footer: '<button class="btn btn-ghost" data-close>إغلاق</button>' });

  let data;
  try { data = await api(`/tasks/${id}`); }
  catch (err) {
    $("#modal-body").innerHTML = "";
    $("#modal-body").append(emptyState("i-alert", "تعذّر التحميل", err.message));
    return;
  }

  const t = data.task;
  const isAdmin = state.isAdmin;
  const isOwner = t.assigneeId === state.user.id;
  const st = STATUS[t.status];
  const pr = PRIORITY[t.priority];

  const bodyNode = el("div", { class: "stack" });
  const head = el("div", { class: "block" });
  head.append(el("div", { class: "row", style: { marginBottom: "10px" } },
    el("span", { class: `chip-tag t-${st.tone}`, html: icon(st.icon) + `<span>${st.label}</span>` }),
    el("span", { class: `chip-tag t-${pr.tone}`, text: `أولوية ${pr.label}` }),
    t.overdue ? el("span", { class: "chip-tag t-red", html: icon("i-alert") + "<span>متأخرة</span>" }) : null));
  head.append(el("h2", { text: t.title, style: { fontSize: "19px", lineHeight: "1.5" } }));
  if (t.description) head.append(el("p", { class: "block-text", style: { marginTop: "10px" }, text: t.description }));
  bodyNode.append(head);

  const dl = el("dl", { class: "dl" });
  const addDl = (k, v) => { if (v) dl.append(el("dt", { text: k }), el("dd", { text: String(v) })); };
  addDl("الموظف المسؤول", t.assigneeName + (t.assigneeTitle ? ` (${t.assigneeTitle})` : ""));
  addDl("أُسندت بواسطة", t.creatorName);
  addDl("تاريخ الإسناد", fmtDateTime(t.assignedAt));
  addDl("تاريخ الاستحقاق", t.dueDate ? `${fmtDate(t.dueDate)}${t.overdue ? " (متأخرة)" : ""}` : null);
  addDl("تاريخ القراءة", t.readAt ? fmtDateTime(t.readAt) : null);
  addDl("تاريخ الإنجاز", t.completedAt ? fmtDateTime(t.completedAt) : null);
  if (t.progress > 0 && t.status !== "done") {
    dl.append(el("dt", { text: "نسبة الإنجاز" }),
      el("dd", {}, el("div", { class: "bar", style: { width: "150px" } }, el("i", { style: { width: t.progress + "%" } }))));
  }
  bodyNode.append(el("div", { class: "card" }, el("div", { class: "card-body" }, dl)));

  if (t.resultNote) bodyNode.append(el("div", { class: "block" },
    el("div", { class: "block-label", html: icon("i-check") + "<span>نتيجة الإنجاز</span>" }),
    el("div", { class: "block-text", text: t.resultNote })));
  if (t.managerNote) bodyNode.append(el("div", { class: "block", style: { borderInlineStart: "3px solid var(--brand)" } },
    el("div", { class: "block-label", html: icon("i-chat") + "<span>ملاحظة المشرف</span>" }),
    el("div", { class: "block-text", text: t.managerNote })));

  const notesCard = el("div", { class: "card" });
  notesCard.append(el("div", { class: "card-head" }, el("h2", { text: "التعليقات والمتابعة" })));
  const notesBody = el("div", { class: "card-body" });
  const listNode = el("div", { class: "notes" });
  if (data.notes.length) {
    for (const n of data.notes) {
      const node = el("div", { class: "note" });
      node.innerHTML = `<div class="note-head"><b>${esc(n.authorName)}</b>
        <span class="muted small" style="margin-inline-start:auto;font-weight:500">${esc(fmtRelative(n.createdAt))}</span></div>
        <div class="note-text">${esc(n.body)}</div>`;
      listNode.append(node);
    }
  } else notesBody.append(el("p", { class: "muted small center", text: "لا توجد تعليقات" }));
  notesBody.append(listNode);

  const noteForm = el("form", { class: "row", style: { marginTop: "13px", alignItems: "flex-end" }, onsubmit: async (e) => {
    e.preventDefault();
    const input = $("textarea", noteForm);
    const text = input.value.trim();
    if (!text) return;
    const btn = $("button", noteForm);
    busy(btn, true);
    try {
      const res = await api(`/tasks/${id}/notes`, { method: "POST", body: { body: text } });
      input.value = "";
      const node = el("div", { class: "note" });
      node.innerHTML = `<div class="note-head"><b>${esc(res.note.authorName)}</b>
        <span class="muted small" style="margin-inline-start:auto;font-weight:500">الآن</span></div>
        <div class="note-text">${esc(res.note.body)}</div>`;
      listNode.append(node);
      toastOk("أُضيف التعليق");
    } catch (err) { toastErr(err.message); } finally { busy(btn, false); }
  } });
  noteForm.append(el("div", { style: { flex: "1", minWidth: "180px" } },
    el("textarea", { placeholder: "أضف تعليقاً أو تحديثاً…", rows: "2", style: { minHeight: "58px" } })),
    el("button", { class: "btn btn-soft", type: "submit", html: icon("i-send") + "<span>إرسال</span>" }));
  notesBody.append(noteForm);
  notesCard.append(notesBody);
  bodyNode.append(notesCard);

  $("#modal-body").innerHTML = "";
  $("#modal-body").append(bodyNode);

  const foot = $("#modal-foot");
  foot.hidden = false;
  foot.innerHTML = "";
  foot.append(el("button", { class: "btn btn-ghost", text: "إغلاق", onclick: closeModal }));
  foot.append(el("button", { class: "btn btn-ghost btn-sm", html: icon("i-print") + "<span>طباعة</span>", onclick: () => window.print() }));

  if (isAdmin) {
    foot.append(el("button", {
      class: "btn btn-ghost btn-sm", html: icon("i-trash") + "<span>حذف</span>",
      onclick: async () => {
        if (!(await confirmDialog({ title: "حذف المهمة", message: `سيُحذف "${t.title}" مع تعليقاته نهائياً.`, confirmText: "حذف نهائي", danger: true, icon: "i-trash" }))) return;
        try { await api(`/tasks/${id}`, { method: "DELETE" }); closeModal(); toastOk("حُذفت المهمة"); refreshCurrent(); }
        catch (err) { toastErr(err.message); }
      },
    }));
    foot.append(el("button", { class: "btn btn-ghost", html: icon("i-edit") + "<span>تعديل</span>", onclick: () => openTaskForm(t) }));
  }

  if ((isOwner || isAdmin) && !["done", "cancelled"].includes(t.status)) {
    if (isOwner && t.status === "new") {
      foot.append(el("button", {
        class: "btn btn-soft", html: icon("i-eye-view") + "<span>تعليم كمقروء</span>",
        onclick: async (e) => {
          busy(e.currentTarget, true);
          try { await api(`/tasks/${id}`, { method: "PATCH", body: { markRead: true } }); closeModal(); toastOk("تم التعليم كمقروء"); refreshCurrent(); }
          catch (err) { toastErr(err.message); busy(e.currentTarget, false); }
        },
      }));
    }
    foot.append(el("button", { class: "btn btn-success", html: icon("i-check") + "<span>إنجاز</span>", onclick: () => openCompleteForm(t) }));
  }

  if (t.status === "done") {
    foot.append(el("button", {
      class: "btn btn-ghost", html: icon("i-refresh") + "<span>إعادة فتح</span>",
      onclick: async (e) => {
        busy(e.currentTarget, true);
        try { await api(`/tasks/${id}`, { method: "PATCH", body: { reopen: true } }); closeModal(); toastOk("أُعيد فتح المهمة"); refreshCurrent(); }
        catch (err) { toastErr(err.message); busy(e.currentTarget, false); }
      },
    }));
  }
}

function openCompleteForm(task) {
  const form = el("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault();
    const btn = $("[data-submit]", $("#modal-foot"));
    const fd = new FormData(form);
    busy(btn, true);
    try {
      await api(`/tasks/${task.id}`, { method: "PATCH", body: { markDone: true, resultNote: fd.get("resultNote") || "", progress: 100 } });
      closeModal();
      toastOk("تم إنجاز المهمة بنجاح");
      refreshCurrent();
    } catch (err) { showAlert(form, err.message); busy(btn, false); }
  } });

  form.append(el("div", { class: "notice notice-info", html: icon("i-check") +
    "<span>بتعليمها كمنجزة سيُسجَّل تاريخ الإنجاز في سجل الإنجاز.</span>" }));
  form.append(el("div", { class: "field" },
    el("label", { for: "cn-note", text: "وصف ما تم إنجازه" }),
    el("textarea", { id: "cn-note", name: "resultNote", rows: "4", maxlength: "2000", placeholder: "مثال: تم تسليم الملف للعميل واستلام إشعار الاستلام" }),
    el("small", { class: "hint", text: "اختياري لكنه يساعد المشرف على متابعة الإنجاز" })));

  openModal({
    title: "إنجاز المهمة", body: form, size: "sm",
    footer: `<button class="btn btn-ghost" data-close>إلغاء</button>
             <button class="btn btn-success" data-submit>تأكيد الإنجاز</button>`,
  });
  $("#modal-foot").querySelector("[data-submit]").addEventListener("click", (e) => { e.preventDefault(); form.requestSubmit(); });
}

async function openTaskForm(task = null) {
  if (!state.isAdmin) return toastErr("إنشاء المهام متاح للمشرفين فقط");
  const isEdit = !!task;
  const members = await loadMembers();
  const active = members.filter((m) => m.status === "active");

  if (!active.length) {
    return openModal({
      title: "مهمة جديدة", size: "sm",
      body: emptyState("i-users", "لا يوجد أعضاء فعّالون", "ادعُ أعضاء عبر أسماء المستخدمين أولاً.",
        { label: "إضافة عضو", onClick: () => { closeModal(); navigate("members"); } }),
      footer: '<button class="btn btn-ghost" data-close>إغلاق</button>',
    });
  }

  const form = el("form", { class: "stack" });
  form.append(el("div", { class: "field" },
    el("label", { for: "tf-title", text: "عنوان المهمة *" }),
    el("input", { id: "tf-title", name: "title", required: true, maxlength: "160", value: task?.title || "", placeholder: "مثال: تجهيز عرض الأسعار للعميل الجديد" })));
  form.append(el("div", { class: "field" },
    el("label", { for: "tf-desc", text: "التفاصيل والإضافات" }),
    el("textarea", { id: "tf-desc", name: "description", rows: "4", maxlength: "4000", text: task?.description || "", placeholder: "اشرح المطلوب بالتفصيل، المرفقات، والمخرجات المتوقعة…" })));

  const row1 = el("div", { class: "grid-2" });
  row1.append(el("div", { class: "field" },
    el("label", { for: "tf-pri", text: "الأولوية" }),
    (() => { const s = el("select", { id: "tf-pri", name: "priority" });
      for (const [v, m] of Object.entries(PRIORITY)) { const o = el("option", { value: v, text: m.label }); if ((task?.priority || "normal") === v) o.selected = true; s.append(o); } return s; })()));
  const dueDefault = new Date(Date.now() + (state.workspace?.taskDueDays || 7) * 86400000).toISOString().slice(0, 10);
  row1.append(el("div", { class: "field" },
    el("label", { for: "tf-due", text: "تاريخ الاستحقاق" }),
    el("input", { id: "tf-due", name: "dueDate", type: "date", value: task?.dueDate || dueDefault })));
  form.append(row1);

  if (isEdit) {
    form.append(el("div", { class: "field" },
      el("label", { for: "tf-who", text: "الموظف المسؤول" }),
      (() => { const s = el("select", { id: "tf-who", name: "assigneeId" });
        for (const m of active) { const o = el("option", { value: String(m.userId), text: `${m.fullName} (@${m.username})` }); if (task.assigneeId === m.userId) o.selected = true; s.append(o); }
        return s; })()));
  } else {
    form.append(el("div", { class: "field" },
      el("label", { for: "tf-who", text: "الموظف المسؤول * (يمكن اختيار أكثر من واحد)" }),
      (() => { const s = el("select", { id: "tf-who", name: "assigneeIds", multiple: true, size: "5" });
        for (const m of active) s.append(el("option", { value: String(m.userId), text: `${m.fullName} (@${m.username})` }));
        return s; })(),
      el("small", { class: "hint", text: "تُنشأ نسخة من المهمة لكل موظف محدّد" })));
  }

  form.append(el("div", { class: "field" },
    el("label", { for: "tf-note", text: "ملاحظة من المشرف (تظهر للموظف)" }),
    el("textarea", { id: "tf-note", name: "managerNote", rows: "2", maxlength: "2000", text: task?.managerNote || "", placeholder: "مثال: الأولوية عالية، يرجى التسليم قبل نهاية الأسبوع" })));

  openModal({
    title: isEdit ? "تعديل المهمة" : "مهمة جديدة", body: form, size: "lg",
    footer: `<button class="btn btn-ghost" data-close>إلغاء</button>
             <button class="btn btn-primary" data-submit>${isEdit ? "حفظ التعديلات" : "إسناد المهمة"}</button>`,
  });

  $("#modal-foot").querySelector("[data-submit]").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const fd = new FormData(form);
    if (!String(fd.get("title") || "").trim()) return showAlert(form, "عنوان المهمة مطلوب");
    busy(btn, true);
    try {
      if (isEdit) {
        const body = {
          title: fd.get("title"), description: fd.get("description"),
          priority: fd.get("priority"), dueDate: fd.get("dueDate") || null,
          managerNote: fd.get("managerNote"),
        };
        if (fd.get("assigneeId")) body.assigneeId = Number(fd.get("assigneeId"));
        await api(`/tasks/${task.id}`, { method: "PATCH", body });
        toastOk("حُفظت التعديلات");
      } else {
        const ids = [...$("#tf-who").selectedOptions].map((o) => Number(o.value));
        if (!ids.length) return showAlert(form, "اختر موظفاً واحداً على الأقل");
        const res = await api("/tasks", { method: "POST", body: {
          title: fd.get("title"), description: fd.get("description"),
          priority: fd.get("priority"), dueDate: fd.get("dueDate") || null,
          assigneeIds: ids, managerNote: fd.get("managerNote"),
        } });
        toastOk(res.created > 1 ? `أُسندت المهمة إلى ${res.created} أعضاء` : "أُسندت المهمة");
      }
      closeModal();
      refreshCurrent();
    } catch (err) { showAlert(form, err.message); busy(btn, false); }
  });
}

async function renderDone() {
  const page = el("div", { class: "page" });
  $("#page-sub").textContent = state.isAdmin ? "كل المهام التي أنجزها الأعضاء" : "المهام التي أنجزتها";
  if (state.isAdmin) await loadMembers();

  if (state.isAdmin) {
    const chips = el("div", { class: "chips" });
    chips.append(el("button", { class: "chip" + (!state.filter.assigneeId ? " is-active" : ""), text: "الكل",
      onclick: () => { state.filter.assigneeId = ""; refreshCurrent(); } }));
    for (const m of state.members.filter((x) => x.status === "active")) {
      chips.append(el("button", { class: "chip" + (String(state.filter.assigneeId) === String(m.userId) ? " is-active" : ""),
        text: m.fullName, onclick: () => { state.filter.assigneeId = String(m.userId); refreshCurrent(); } }));
    }
    page.append(chips);
  }

  const data = await api("/tasks?" + taskQuery({ status: "done" }));
  const card = el("div", { class: "card" });
  const who = state.members.find((m) => String(m.userId) === String(state.filter.assigneeId));
  card.append(el("div", { class: "card-head" },
    el("div", {}, el("h2", { text: who ? `إنجاز ${who.fullName}` : "سجل الإنجاز" }),
      el("p", { text: `${data.total} مهمة منجزة` })),
    el("div", { class: "card-head-actions" },
      el("button", { class: "btn btn-ghost btn-sm", html: icon("i-download") + "<span>CSV</span>", onclick: () => { window.location.href = "/api/export/tasks.csv?done=1"; } }),
      el("button", { class: "btn btn-ghost btn-sm", html: icon("i-print") + "<span>طباعة</span>", onclick: () => window.print() }))));

  const body = el("div", { class: "card-body" });
  if (!data.tasks.length) body.append(emptyState("i-checklist", "لا يوجد إنجاز بعد", "ستظهر هنا المهام المنجزة مع ملاحظات الإنجاز وتواريخها."));
  else { const list = el("div", { class: "task-list" }); data.tasks.forEach((t) => list.append(taskCard(t))); body.append(list); }
  card.append(body);
  page.append(card);
  return page;
}

// ═══════════════════════════════════════════════════════════
//  قوائم TODO — خاصة أو مرئية لبيئة العمل
// ═══════════════════════════════════════════════════════════

function todoItem(t) {
  const pri = TODO_PRIORITY[t.priority] || TODO_PRIORITY.normal;
  const node = el("div", { class: "todo" + (t.done ? " is-done" : "") });

  node.append(el("button", {
    class: "todo-box" + (t.done ? " is-done" : ""), type: "button",
    title: t.done ? "إعادة فتح" : "تعليم كمنجز", html: icon("i-check"),
    onclick: async (e) => {
      e.stopPropagation();
      try { await api(`/todos/${t.id}`, { method: "PATCH", body: { done: !t.done } }); refreshCurrent(); }
      catch (err) { toastErr(err.message); }
    },
  }));

  const main = el("div", { class: "todo-main" });
  main.append(el("div", { class: "todo-text", text: t.title }));
  if (t.description) main.append(el("div", { class: "todo-desc", text: t.description }));

  const meta = el("div", { class: "todo-meta" });
  meta.append(el("span", {
    class: "chip-tag " + (t.visibility === "workspace" ? "vis-shared" : "vis-private"),
    html: icon(t.visibility === "workspace" ? "i-globe" : "i-lock") +
      `<span>${t.visibility === "workspace" ? "مشتركة مع بيئة العمل" : "خاصة بي"}</span>`,
  }));
  if (t.priority !== "normal") meta.append(el("span", { class: `chip-tag t-${pri.tone}`, text: `أولوية ${pri.label}` }));
  if (t.dueDate) {
    const d = dueLabel(t.dueDate);
    if (d && !t.done) meta.append(el("span", { class: `chip-tag t-${d.tone}`, html: icon("i-calendar") + `<span>${esc(d.text)}</span>` }));
    else meta.append(el("span", { class: "chip-tag t-gray", html: icon("i-calendar") + `<span>${esc(fmtDate(t.dueDate))}</span>` }));
  }
  if (state.workspace && t.visibility === "workspace" && t.ownerId !== state.user.id) {
    meta.append(el("span", { class: "chip-tag", html: icon("i-user") + `<span>${esc(t.ownerName)}</span>` }));
  }
  main.append(meta);
  node.append(main);

  const acts = el("div", { class: "todo-actions" });
  const canEdit = t.ownerId === state.user.id || (state.isAdmin && t.visibility === "workspace");
  if (canEdit) {
    acts.append(el("button", { class: "icon-btn", title: "تعديل", html: icon("i-edit"), onclick: (e) => { e.stopPropagation(); openTodoForm(t); } }));
    acts.append(el("button", { class: "icon-btn", title: "تغيير المشاركة", html: icon(t.visibility === "workspace" ? "i-lock" : "i-globe"),
      onclick: async (e) => {
        e.stopPropagation();
        if (t.visibility !== "workspace" && !state.workspace) return toastErr("لا توجد بيئة عمل");
        try {
          await api(`/todos/${t.id}`, { method: "PATCH", body: { visibility: t.visibility === "workspace" ? "private" : "workspace" } });
          toastOk(t.visibility === "workspace" ? "أصبحت خاصة" : "أصبحت مشتركة مع بيئة العمل");
          refreshCurrent();
        } catch (err) { toastErr(err.message); }
      } }));
    acts.append(el("button", { class: "icon-btn is-danger", title: "حذف", html: icon("i-trash"),
      onclick: async (e) => {
        e.stopPropagation();
        if (!(await confirmDialog({ title: "حذف العنصر", message: `حذف "${t.title}" نهائياً؟`, confirmText: "حذف", danger: true, icon: "i-trash" }))) return;
        try { await api(`/todos/${t.id}`, { method: "DELETE" }); toastOk("حُذف العنصر"); refreshCurrent(); }
        catch (err) { toastErr(err.message); }
      } }));
  }
  node.append(acts);
  return node;
}

function todoList(items) {
  const list = el("div", { class: "todo-list" });
  items.forEach((t) => list.append(todoItem(t)));
  return list;
}

async function renderTodos() {
  if (!state.user) return el("div", { class: "card" }, el("div", { class: "card-body" },
    emptyState("i-lock", "غير مسجّل الدخول", "سجّل الدخول لعرض القوائم.")));
  const page = el("div", { class: "page" });
  const data = await api("/todos?view=" + state.todoView);
  const c = data.counts;
  $("#page-sub").textContent = `${c.open} مفتوح · ${c.done} منجز · ${c.private} خاص · ${c.shared} مشترك`;

  const chips = el("div", { class: "chips" });
  const views = [["all", "الكل", c.total], ["open", "المفتوحة", c.open], ["private", "خاصة بي", null],
                 ["shared", "مشتركة مع الفريق", null], ["done", "المنجزة", c.done]];
  for (const [v, label, n] of views) {
    chips.append(el("button", {
      class: "chip" + (state.todoView === v ? " is-active" : ""),
      onclick: () => { state.todoView = v; refreshCurrent(); },
    }, el("span", { text: label }), n !== null ? el("span", { class: "n", text: String(n) }) : null));
  }
  page.append(chips);

  if (c.total > 0) {
    const pct = Math.round((c.done / c.total) * 100);
    const prog = el("div", { class: "todo-progress" });
    prog.innerHTML = `<span class="small" style="font-weight:650">التقدّم</span>
      <div class="bar ${pct < 34 ? "is-vlow" : pct < 67 ? "is-low" : ""}"><i style="width:${pct}%"></i></div>
      <span class="small mono" style="font-weight:700">${pct}%</span>`;
    page.append(prog);
  }

  const card = el("div", { class: "card" });
  card.append(el("div", { class: "card-head" },
    el("div", {}, el("h2", { text: "القوائم" }), el("p", { text: "عناصر خاصة بك وأخرى مرئية لبيئة العمل" })),
    el("div", { class: "card-head-actions" },
      c.done > 0 ? el("button", { class: "btn btn-ghost btn-sm", html: icon("i-trash") + "<span>مسح المنجزة</span>", onclick: async () => {
        if (!(await confirmDialog({ title: "مسح المنجزة", message: "حذف جميع عناصر TODO التي أنجزتها؟", confirmText: "مسح", danger: true, icon: "i-trash" }))) return;
        try { const r = await api("/todos/clear-done", { method: "POST" }); toastOk(`حُذف ${r.deleted} عنصر`); refreshCurrent(); }
        catch (err) { toastErr(err.message); }
      } }) : null,
      el("button", { class: "btn btn-primary btn-sm", html: icon("i-plus") + "<span>عنصر جديد</span>", onclick: () => openTodoForm() }))));

  const body = el("div", { class: "card-body" });
  if (!data.todos.length) {
    const msgs = {
      all: ["لا توجد قوائم بعد", "أنشئ أول عنصر TODO خاص بك أو شاركه مع بيئة العمل."],
      open: ["لا توجد عناصر مفتوحة", "كل شيء منجز — عمل رائع!"],
      private: ["لا توجد قوائم خاصة", "القوائم الخاصة لا يراها أحد سواك."],
      shared: ["لا توجد قوائم مشتركة", "القوائم المشتركة يراها كل أعضاء بيئة العمل."],
      done: ["لم تُنجز أي عنصر بعد", "علّم العناصر المنجزة لتظهر هنا."],
    }[state.todoView];
    body.append(emptyState("i-checklist", msgs[0], msgs[1], { label: "عنصر جديد", onClick: () => openTodoForm() }));
  } else body.append(todoList(data.todos));

  card.append(body);
  page.append(card);
  return page;
}

function openTodoForm(todo = null) {
  const isEdit = !!todo;
  const form = el("form", { class: "stack" });

  form.append(el("div", { class: "field" },
    el("label", { for: "td-title", text: "العنوان *" }),
    el("input", { id: "td-title", name: "title", required: true, maxlength: "200", value: todo?.title || "", placeholder: "مثال: مراجعة تقرير المبيعات الشهري" })));

  form.append(el("div", { class: "field" },
    el("label", { for: "td-desc", text: "التفاصيل" }),
    el("textarea", { id: "td-desc", name: "description", rows: "3", maxlength: "2000", text: todo?.description || "" })));

  const visField = el("div", { class: "field" });
  visField.append(el("label", { text: "نوع القائمة" }));
  const visBox = el("div", { class: "stack", style: { gap: "9px" } });
  const curVis = todo?.visibility || "private";

  const mkRadio = (value, title, desc, ic, disabled) => {
    const input = el("input", { type: "radio", name: "visibility", value, checked: curVis === value, disabled: disabled || false,
      style: { width: "18px", height: "18px", accentColor: "var(--brand)", flex: "none" } });
    const box = el("label", {
      style: { display: "flex", gap: "11px", alignItems: "flex-start", padding: "13px 15px",
               border: "1.5px solid " + (curVis === value ? "var(--brand)" : "var(--border)"),
               borderRadius: "var(--r)", cursor: disabled ? "not-allowed" : "pointer",
               background: disabled ? "var(--surface-3)" : "var(--surface-2)", opacity: disabled ? ".55" : "1" },
    });
    const icWrap = el("div", { class: "stat-ico " + (value === "workspace" ? "t-violet" : "t-gray"),
      style: { width: "32px", height: "32px", flex: "none" }, html: icon(ic) });
    box.append(input, icWrap, el("div", {},
      el("div", { style: { fontWeight: "650", fontSize: "14px" }, text: title }),
      el("div", { class: "small muted", text: desc })));
    if (!disabled) {
      input.addEventListener("change", () => {
        $$("input[name=visibility]", visBox).forEach((r) => {
          r.parentElement.style.borderColor = r.checked ? "var(--brand)" : "var(--border)";
        });
      });
    }
    visBox.append(box);
  };

  mkRadio("private", "خاصة", "لا يراها أحد سواك — حتى في نفس بيئة العمل", "i-lock");
  mkRadio("workspace", "عامة",
    state.workspace ? `يراها كل أعضاء بيئة العمل «${state.workspace.name}»` : "تتطلب بيئة عمل",
    "i-globe", !state.workspace);
  visField.append(visBox);
  form.append(visField);

  const row = el("div", { class: "grid-2" });
  row.append(el("div", { class: "field" },
    el("label", { for: "td-pri", text: "الأولوية" }),
    (() => { const s = el("select", { id: "td-pri", name: "priority" });
      for (const [v, m] of Object.entries(TODO_PRIORITY)) { const o = el("option", { value: v, text: m.label }); if ((todo?.priority || "normal") === v) o.selected = true; s.append(o); }
      return s; })()));
  row.append(el("div", { class: "field" },
    el("label", { for: "td-due", text: "تاريخ الاستحقاق" }),
    el("input", { id: "td-due", name: "dueDate", type: "date", value: todo?.dueDate || "" })));
  form.append(row);

  if (isEdit) {
    form.append(el("div", { class: "notice notice-info", html: icon("i-info") +
      `<span>الحالة: <b>${todo.done ? "منجز" : "مفتوح"}</b> · ${todo.visibility === "workspace" ? "مشتركة" : "خاصة"}</span>` }));
  }

  openModal({
    title: isEdit ? "تعديل العنصر" : "عنصر TODO جديد", body: form, size: "sm",
    footer: `<button class="btn btn-ghost" data-close>إلغاء</button>
             <button class="btn btn-primary" data-submit>${isEdit ? "حفظ" : "إضافة"}</button>`,
  });

  $("#modal-foot").querySelector("[data-submit]").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const fd = new FormData(form);
    busy(btn, true);
    try {
      const body = {
        title: fd.get("title"), description: fd.get("description"),
        priority: fd.get("priority"), dueDate: fd.get("dueDate") || null,
        visibility: fd.get("visibility") || "private",
      };
      if (isEdit) await api(`/todos/${todo.id}`, { method: "PATCH", body });
      else await api("/todos", { method: "POST", body });
      closeModal();
      toastOk(isEdit ? "حُفظ العنصر" : body.visibility === "workspace" ? "أُضيف كقائمة مشتركة لبيئة العمل" : "أُضيف كقائمة خاصة بك");
      refreshCurrent();
    } catch (err) { showAlert(form, err.message); busy(btn, false); }
  });
}

// ═══════════════════════════════════════════════════════════
//  الأعضاء والدعوات
// ═══════════════════════════════════════════════════════════

async function renderMembers() {
  if (!state.isAdmin) {
    return el("div", { class: "card" }, el("div", { class: "card-body" },
      emptyState("i-lock", "غير مصرّح", "هذه الصفحة متاحة للمشرفين وصاحب بيئة العمل فقط.")));
  }
  const page = el("div", { class: "page" });
  const members = await loadMembers(true);
  renderShell();

  const active = members.filter((m) => m.status === "active");
  const pending = members.filter((m) => m.status === "pending");
  $("#page-sub").textContent = `${active.length} عضو فعّال · ${pending.length} بانتظار الموافقة`;

  const stats = el("div", { class: "stats" });
  const mk = (label, value, tone, ic, sub) => {
    const n = el("div", { class: "stat" });
    n.innerHTML = `<div class="stat-top"><div class="stat-ico t-${tone}">${icon(ic)}</div><span class="stat-label">${esc(label)}</span></div>
      <div class="stat-value">${esc(String(value))}</div><div class="stat-sub">${esc(sub)}</div>`;
    return n;
  };
  stats.append(
    mk("أعضاء فعّالون", active.length, "brand", "i-users", `من ${members.length} إجمالاً`),
    mk("بانتظار الموافقة", pending.length, pending.length ? "amber" : "gray", "i-mail", "دعوات لم تُقبل بعد"),
    mk("إجمالي المهمات", active.reduce((s, m) => s + m.totalTasks, 0), "violet", "i-task", "على كل الأعضاء"),
    mk("منجز", active.reduce((s, m) => s + m.doneTasks, 0), "green", "i-check", "مهمة منجزة"),
    mk("متأخر", active.reduce((s, m) => s + m.overdueTasks, 0), "red", "i-alert", "مهمة متأخرة"),
  );
  page.append(stats);

  const inviteCardNode = el("div", { class: "card" });
  inviteCardNode.append(el("div", { class: "card-head" },
    el("div", {}, el("h2", { text: "دعوة عضو جديد" }), el("p", { text: "أدخل اسم المستخدم — الدعوة تنتظر موافقته" })),
    el("div", { class: "card-head-actions" },
      el("button", { class: "btn btn-primary btn-sm", html: icon("i-user-plus") + "<span>دعوة</span>", onclick: () => openInviteForm() }))));
  const ib = el("div", { class: "card-body" });
  ib.append(el("div", { class: "notice notice-info", html: icon("i-info") +
    "<span>على العضو أن يكون لديه حساب مسجّل مسبقاً في المنصّة. تُرسَل له الدعوة فيظهر لها إشعار، ويقبلها من حسابه، وعندها يصبح عضواً في بيئة العمل.</span>" }));
  inviteCardNode.append(ib);
  page.append(inviteCardNode);

  const card = el("div", { class: "card" });
  card.append(el("div", { class: "card-head" },
    el("div", {}, el("h2", { text: "أعضاء بيئة العمل" })),
    el("div", { class: "card-head-actions" },
      el("button", { class: "btn btn-ghost btn-sm", html: icon("i-download") + "<span>CSV</span>", onclick: () => { window.location.href = "/api/reports.csv"; } }))));

  if (!members.length) {
    card.append(el("div", { class: "card-body" }, emptyState("i-users", "لا يوجد أعضاء", "ادعُ أول عضو باسم المستخدم.",
      { label: "دعوة عضو", onClick: () => openInviteForm() })));
  } else {
    const body = el("div", { class: "card-body" });
    const list = el("div", { class: "task-list" });
    members.forEach((m) => list.append(memberCard(m)));
    body.append(list);
    card.append(body);
  }
  page.append(card);
  return page;
}

function memberCard(m) {
  const node = el("div", { class: "task st-" + (m.status === "pending" ? "read" : "done") });

  const main = el("div", { class: "task-main" });
  const headRow = el("div", { class: "row", style: { alignItems: "center", gap: "11px" } });
  headRow.append(avatarEl(m.fullName, m.avatarColor, 40));
  const txt = el("div", { style: { flex: "1", minWidth: "0" } });
  txt.innerHTML = `<div style="font-weight:700">${esc(m.fullName)}</div>
    <div class="small muted"><span class="mono">@${esc(m.username)}</span>${m.jobTitle ? " · " + esc(m.jobTitle) : ""}</div>`;
  headRow.append(txt);
  headRow.append(el("span", { class: "role-tag role-" + m.role, text: ROLE_LABEL[m.role] }));
  headRow.append(m.status === "pending"
    ? el("span", { class: "chip-tag t-amber", html: icon("i-clock") + "<span>بانتظار موافقته</span>" })
    : el("span", { class: "chip-tag t-green", text: "فعّال" }));
  main.append(headRow);

  if (m.status === "pending") {
    main.append(el("div", { class: "block", style: { marginTop: "11px", padding: "10px 13px" } },
      el("div", { class: "block-label", html: icon("i-info") + "<span>حالة الدعوة</span>" }),
      el("div", { class: "block-text small", text: `دعا ${m.invitedBy || "مشرف"} العضو ${m.fullName} — بانتظار موافقته هو على الانضمام.` })));
  } else {
    const meta = el("div", { class: "task-meta", style: { marginTop: "11px" } });
    meta.append(
      el("span", { class: "chip-tag", html: icon("i-task") + `<span>${m.totalTasks} مهمة</span>` }),
      el("span", { class: "chip-tag t-blue", html: icon("i-bell") + `<span>${m.newTasks} جديد</span>` }),
      el("span", { class: "chip-tag t-green", html: icon("i-check") + `<span>${m.doneTasks} منجز</span>` }),
      m.overdueTasks ? el("span", { class: "chip-tag t-red", html: icon("i-alert") + `<span>${m.overdueTasks} متأخر</span>` }) : null,
      el("span", { class: "chip-tag", html: icon("i-clock") + `<span>${m.hasLoggedIn ? esc(fmtRelative(m.lastLoginAt)) : "لم يدخل بعد"}</span>` }),
    );
    main.append(meta);
    main.append(el("div", { class: "progress" }, el("i", { style: { width: m.completionRate + "%" } })));
  }
  node.append(main);

  const acts = el("div", { class: "task-actions" });
  if (m.status === "active") {
    acts.append(el("button", { class: "btn btn-ghost btn-sm", html: icon("i-task") + "<span>مهامّه</span>",
      onclick: () => { state.filter.assigneeId = String(m.userId); state.filter.scope = "all"; state.filter.status = "all"; navigate("tasks"); } }));
    if (m.role !== "owner") {
      if (state.isOwner) {
        acts.append(el("button", { class: "btn btn-ghost btn-sm", html: icon("i-users") +
          `<span>${m.role === "admin" ? "إزالة الإشراف" : "ترقية لمشرف"}</span>`,
          onclick: async () => {
            try {
              await api(`/members/${m.id}`, { method: "PATCH", body: { role: m.role === "admin" ? "member" : "admin" } });
              toastOk(m.role === "admin" ? "أُزيل الإشراف" : "تُرقي إلى مشرف");
              state.members = []; refreshCurrent();
            } catch (err) { toastErr(err.message); }
          } }));
      }
      acts.append(el("button", { class: "btn btn-danger btn-sm", html: icon("i-trash") + "<span>إزالة</span>",
        onclick: async () => {
          if (!(await confirmDialog({ title: `إزالة ${m.fullName}`,
            message: `سيخرج ${m.fullName} من بيئة العمل. يبقى له حسابه وسجلّه الكامل في المنصّة.`,
            confirmText: "إزالة", danger: true, icon: "i-trash" }))) return;
          try { await api(`/members/${m.id}`, { method: "DELETE" }); toastOk("أُزيل العضو"); state.members = []; refreshCurrent(); }
          catch (err) { toastErr(err.message); }
        } }));
    }
  }
  if (acts.children.length) node.append(acts);
  return node;
}

function openInviteForm() {
  const form = el("form", { class: "stack" });
  form.append(el("div", { class: "notice notice-info", html: icon("i-user-plus") +
    "<span>أدخل اسم المستخدم المسجّل للعضو. سيظهر له إشعار ويقبل الدعوة من حسابه.</span>" }));
  form.append(el("div", { class: "field" },
    el("label", { for: "iv-user", text: "اسم المستخدم *" }),
    el("input", { id: "iv-user", name: "username", required: true, pattern: "[a-z0-9._\\-]{3,32}", dir: "ltr",
      placeholder: "username", autocapitalize: "none", spellcheck: "false" })));
  form.append(el("div", { class: "field" },
    el("label", { for: "iv-title", text: "المسمى الوظيفي (اختياري)" }),
    el("input", { id: "iv-title", name: "jobTitle", maxlength: "80", placeholder: "مثال: مسؤولة تسويق" })));
  form.append(el("div", { class: "field" },
    el("label", { for: "iv-role", text: "الرتبة" }),
    (() => {
      const s = el("select", { id: "iv-role", name: "role" });
      s.append(el("option", { value: "member", text: "موظف — يرى مهامه فقط" }));
      if (state.isOwner) s.append(el("option", { value: "admin", text: "مشرف — يدير المهام والأعضاء" }));
      return s;
    })()));

  openModal({
    title: "دعوة عضو جديد", body: form, size: "sm",
    footer: `<button class="btn btn-ghost" data-close>إلغاء</button>
             <button class="btn btn-primary" data-submit>إرسال الدعوة</button>`,
  });

  $("#modal-foot").querySelector("[data-submit]").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const fd = new FormData(form);
    busy(btn, true);
    try {
      const res = await api("/members", { method: "POST", body: {
        username: String(fd.get("username") || "").trim().toLowerCase(),
        jobTitle: fd.get("jobTitle"), role: fd.get("role") || "member",
      } });
      closeModal();
      toastOk(res.message || "أُرسلت الدعوة");
      state.members = [];
      refreshCurrent();
    } catch (err) { showAlert(form, err.message); busy(btn, false); }
  });
}

// ═══════════════════════════════════════════════════════════
//  التقارير والنشاط
// ═══════════════════════════════════════════════════════════

async function renderReports() {
  const [data, stats] = await Promise.all([api("/reports"), api("/stats")]);
  const rows = data.reports;
  const page = el("div", { class: "page" });
  $("#page-sub").textContent = `أداء ${rows.length} عضو في ${state.workspace.name}`;

  const total = rows.reduce((s, r) => s + r.total, 0);
  const done = rows.reduce((s, r) => s + r.done, 0);
  const overdue = rows.reduce((s, r) => s + r.overdue, 0);
  const avgRate = rows.length ? Math.round(rows.reduce((s, r) => s + r.completionRate, 0) / rows.length) : 0;
  const withAvg = rows.filter((r) => r.avgDays != null);
  const meanDays = withAvg.length ? Math.round((withAvg.reduce((s, r) => s + r.avgDays, 0) / withAvg.length) * 10) / 10 : null;

  const cards = el("div", { class: "stats" });
  const mk = (label, value, tone, ic, sub) => {
    const n = el("div", { class: "stat" });
    n.innerHTML = `<div class="stat-top"><div class="stat-ico t-${tone}">${icon(ic)}</div><span class="stat-label">${esc(label)}</span></div>
      <div class="stat-value">${esc(String(value))}</div><div class="stat-sub">${esc(sub)}</div>`;
    return n;
  };
  cards.append(
    mk("متوسط نسبة الإنجاز", avgRate + "%", "green", "i-chart", "عبر جميع الأعضاء"),
    mk("إجمالي المنجز", done, "brand", "i-check", `من ${total} مهمة`),
    mk("متوسط مدة الإنجاز", meanDays != null ? meanDays + " يوم" : "—", "violet", "i-clock", "من الإسناد إلى الإنجاز"),
    mk("مهام متأخرة", overdue, overdue ? "red" : "gray", "i-alert", overdue ? "تحتاج متابعة" : "لا تأخير"),
  );
  page.append(cards);

  const card = el("div", { class: "card" });
  card.append(el("div", { class: "card-head" },
    el("div", {}, el("h2", { text: "أداء الأعضاء" }), el("p", { text: "مرتّبة تنازلياً حسب المهام المنجزة" })),
    el("div", { class: "card-head-actions" },
      el("button", { class: "btn btn-ghost btn-sm", html: icon("i-download") + "<span>تصدير CSV</span>", onclick: () => { window.location.href = "/api/reports.csv"; } }),
      el("button", { class: "btn btn-ghost btn-sm", html: icon("i-print") + "<span>طباعة</span>", onclick: () => window.print() }))));

  if (!rows.length) {
    card.append(el("div", { class: "card-body" }, emptyState("i-chart", "لا توجد بيانات", "ادعُ أعضاء وأسند لهم مهاماً ليظهر التقرير.")));
  } else {
    const wrap = el("div", { class: "table-wrap" });
    const table = el("table", { class: "tbl" });
    table.innerHTML = `<thead><tr><th>العضو</th><th>الرتبة</th><th>الإجمالي</th><th>جديد</th><th>مقروء</th>
      <th>منجز</th><th>متأخر</th><th>الالتزام بالوقت</th><th>متوسط المدة</th><th>نسبة الإنجاز</th><th></th></tr></thead>`;
    const tbody = el("tbody");
    for (const r of rows) {
      const tr = el("tr");
      tr.innerHTML = `
        <td><div class="cell-user">
          <div class="avatar" style="background:${esc(r.avatarColor)}">${esc(initials(r.fullName))}</div>
          <div class="cell-user-text"><strong>${esc(r.fullName)}</strong><span style="font-family:inherit">${esc(r.jobTitle || "@" + r.username)}</span></div>
        </div></td>
        <td><span class="role-tag role-${r.role}">${esc(ROLE_LABEL[r.role])}</span></td>
        <td class="num">${r.total}</td><td class="num">${r.new}</td><td class="num">${r.read}</td>
        <td class="num" style="color:var(--green);font-weight:700">${r.done}</td>
        <td class="num">${r.overdue ? `<span style="color:var(--red);font-weight:700">${r.overdue}</span>` : 0}</td>
        <td class="small">${r.onTimeRate}%</td>
        <td class="num small">${r.avgDays != null ? r.avgDays + " يوم" : "—"}</td>
        <td></td><td class="actions"></td>`;
      const rate = el("td");
      rate.innerHTML = `<div class="row" style="gap:8px;flex-wrap:nowrap">
        <div class="bar ${r.completionRate < 34 ? "is-vlow" : r.completionRate < 67 ? "is-low" : ""}"><i style="width:${r.completionRate}%"></i></div>
        <span class="num small">${r.completionRate}%</span></div>`;
      tr.children[9].replaceWith(rate);
      const act = el("td", { class: "actions" });
      act.append(el("button", { class: "icon-btn", title: "مهامّه", html: icon("i-task"),
        onclick: () => { state.filter.assigneeId = String(r.userId); state.filter.scope = "all"; state.filter.status = "all"; navigate("tasks"); } }));
      tr.lastChild.replaceWith(act);
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
    card.append(wrap);
  }
  page.append(card);
  return page;
}

async function renderActivity() {
  const data = await api("/activity?limit=150");
  const page = el("div", { class: "page" });
  const card = el("div", { class: "card" });
  card.append(el("div", { class: "card-head" },
    el("div", {}, el("h2", { text: "سجل النشاط" }), el("p", { text: "آخر 150 حدثاً" })),
    el("div", { class: "card-head-actions" },
      el("button", { class: "btn btn-ghost btn-sm", html: icon("i-refresh") + "<span>تحديث</span>", onclick: () => refreshCurrent() }))));
  const body = el("div", { class: "card-body" });
  if (!data.activity.length) body.append(emptyState("i-history", "لا يوجد نشاط", "ستُسجَّل هنا كل العمليات."));
  else {
    const feed = el("div", { class: "feed" });
    for (const a of data.activity) {
      const meta = ACTION_META[a.action] || { icon: "i-info", tone: "gray", label: a.action };
      const node = el("div", { class: "feed-item" });
      node.innerHTML = `<div class="feed-ico t-${meta.tone}">${icon(meta.icon)}</div>
        <div class="feed-text">
          <div class="row" style="gap:7px"><span class="chip-tag t-${meta.tone}">${esc(meta.label)}</span><b>${esc(a.actorName)}</b></div>
          <div style="margin-top:3px;color:var(--text-2)">${esc(a.details || "—")}</div>
          <div class="feed-time">${esc(fmtDateTime(a.createdAt))} · ${esc(fmtRelative(a.createdAt))}</div>
        </div>`;
      feed.append(node);
    }
    body.append(feed);
  }
  card.append(body);
  page.append(card);
  return page;
}

// ═══════════════════════════════════════════════════════════
//  الإعدادات والملف الشخصي
// ═══════════════════════════════════════════════════════════

async function renderSettings() {
  const page = el("div", { class: "page" });
  if (!state.user || !state.workspace) {
    return el("div", { class: "card" }, el("div", { class: "card-body" },
      emptyState("i-lock", "لا توجد بيئة نشطة", "اختر بيئة عمل أو أنشئ واحدة أولاً.")));
  }

  const form = el("form", { class: "card-body stack", onsubmit: async (e) => {
    e.preventDefault();
    const btn = $("button[type=submit]", form);
    const fd = new FormData(form);
    busy(btn, true);
    try {
      const r = await api(`/workspaces/${state.workspace.id}`, { method: "PATCH", body: {
        name: fd.get("name"), tagline: fd.get("tagline"), taskDueDays: Number(fd.get("taskDueDays") || 7),
      } });
      state.workspace = { ...state.workspace, ...r.workspace };
      renderShell();
      toastOk("حُفظت إعدادات بيئة العمل");
    } catch (err) { showAlert(form, err.message); } finally { busy(btn, false); }
  } });

  form.append(el("div", { class: "field" }, el("label", { for: "st-name", text: "اسم بيئة العمل" }),
    el("input", { id: "st-name", name: "name", maxlength: "80", value: state.workspace.name })));
  form.append(el("div", { class: "field" }, el("label", { for: "st-tag", text: "الوصف المختصر" }),
    el("input", { id: "st-tag", name: "tagline", maxlength: "120", value: state.workspace.tagline || "" })));
  form.append(el("div", { class: "field", style: { maxWidth: "260px" } },
    el("label", { for: "st-days", text: "المهلة الافتراضية للمهمة (بالأيام)" }),
    el("input", { id: "st-days", name: "taskDueDays", type: "number", min: "1", max: "365", value: state.workspace.taskDueDays || 7 })));
  form.append(el("button", { class: "btn btn-primary", type: "submit", html: icon("i-check") + "<span>حفظ</span>" }));

  const card = el("div", { class: "card" });
  card.append(el("div", { class: "card-head" }, el("div", {},
    el("h2", { text: "إعدادات بيئة العمل" }),
    el("p", { text: "التخصيص المشترك لكل أعضاء هذه البيئة" }))));
  card.append(form);
  page.append(card);

  const info = el("div", { class: "card" });
  info.append(el("div", { class: "card-head" }, el("div", {}, el("h2", { text: "معلومات النظام" }))));
  const dl = el("dl", { class: "dl card-body" });
  const add = (k, v) => dl.append(el("dt", { text: k }), el("dd", { class: "mono", text: String(v) }));
  add("المنصّة", "CheckWork v2.0.0");
  add("البنية", "Cloudflare Pages + Workers + D1");
  add("المنطقة", "الشرق الأوسط (WEUR)");
  add("كلمات المرور", "PBKDF2-SHA256 (100,000 دورة)");
  add("الجلسات", "JWT موقّع (HS256) + جدول جلسات");
  add("التحقق من الطلبات", "Origin + Double-Submit CSRF");
  info.append(dl);
  page.append(info);

  const sec = el("div", { class: "card" });
  sec.append(el("div", { class: "card-head" }, el("div", {}, el("h2", { text: "الأمان والحساب" }))));
  const sb = el("div", { class: "card-body stack" });
  sb.append(el("div", { class: "notice notice-info", html: icon("i-shield") +
    "<span>كلمات المرور مشفّرة ولا يمكن استرجاعها. عند تغيير كلمة المرور تُنهى كل جلساتك الحالية تلقائياً.</span>" }));
  sb.append(el("div", { class: "row" },
    el("button", { class: "btn btn-ghost", html: icon("i-clock") + "<span>جلساتي</span>", onclick: showSessions }),
    el("button", { class: "btn btn-ghost", html: icon("i-key") + "<span>تغيير كلمة المرور</span>", onclick: openPasswordForm })));
  sec.append(sb);
  page.append(sec);

  if (state.isOwner) {
    const danger = el("div", { class: "card" });
    danger.append(el("div", { class: "card-head" }, el("div", {}, el("h2", { text: "منطقة الخطر" }))));
    const db = el("div", { class: "card-body" });
    db.append(el("div", { class: "notice notice-warn", style: { marginBottom: "13px" }, html: icon("i-alert") +
      "<span>حذف بيئة العمل يزيل كل مهامها وأعضائها نهائياً. ملف حسابك يبقى مستقلاً.</span>" }));
    db.append(el("button", { class: "btn btn-danger", html: icon("i-trash") + "<span>حذف بيئة العمل</span>",
      onclick: async () => {
        if (!(await confirmDialog({ title: "حذف بيئة العمل", message: `سيُحذف "${state.workspace.name}" مع كل مهامه وأعضائه نهائياً.`, confirmText: "حذف نهائي", danger: true, icon: "i-trash" }))) return;
        try { await api(`/workspaces/${state.workspace.id}`, { method: "DELETE" }); toastOk("حُذفت بيئة العمل"); state.members = []; await boot(); }
        catch (err) { toastErr(err.message); }
      } }));
    danger.append(db);
    page.append(danger);
  }
  return page;
}

async function showSessions() {
  openModal({ title: "جلساتي النشطة", body: el("div", { class: "skel", style: { height: "120px" } }), size: "sm", footer: '<button class="btn btn-ghost" data-close>إغلاق</button>' });
  try {
    const data = await api("/auth/sessions");
    const node = el("div", { class: "stack" });
    for (const s of data.sessions) {
      const box = el("div", { class: "block" });
      box.innerHTML = `<div class="row" style="gap:8px;margin-bottom:5px">
          <b>${s.current ? "الجلسة الحالية" : "جلسة أخرى"}</b>${s.revokedAt ? '<span class="chip-tag t-gray">منتهية</span>' : ""}</div>
        <div class="small muted">${esc(String(s.userAgent).slice(0, 90) || "غير معروف")}</div>
        <div class="small muted mono" style="margin-top:3px">${esc(s.ip)} · بدأت ${esc(fmtRelative(s.createdAt))} · تنتهي ${esc(fmtDate(s.expiresAt))}</div>`;
      node.append(box);
    }
    $("#modal-body").innerHTML = "";
    $("#modal-body").append(node);
  } catch (err) {
    $("#modal-body").innerHTML = "";
    $("#modal-body").append(emptyState("i-alert", "خطأ", err.message));
  }
}

function openPasswordForm() {
  const form = el("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault();
    const btn = $("[data-submit]", $("#modal-foot"));
    const fd = new FormData(form);
    if (fd.get("next") !== fd.get("confirm")) return showAlert(form, "كلمتا المرور غير متطابقتين");
    busy(btn, true);
    try {
      await api("/auth/password", { method: "POST", body: { currentPassword: fd.get("current"), newPassword: fd.get("next") } });
      closeModal();
      toastOk("تم تغيير كلمة المرور — سجّل الدخول من جديد");
      setTimeout(async () => { await api("/auth/logout", { method: "POST" }).catch(() => {}); location.reload(); }, 1000);
    } catch (err) { showAlert(form, err.message); busy(btn, false); }
  } });

  form.append(el("div", { class: "field" }, el("label", { for: "pw-cur", text: "كلمة المرور الحالية" }),
    el("input", { id: "pw-cur", name: "current", type: "password", required: true, dir: "ltr", autocomplete: "current-password" })));
  form.append(el("div", { class: "field" }, el("label", { for: "pw-new", text: "كلمة المرور الجديدة" }),
    el("input", { id: "pw-new", name: "next", type: "password", required: true, minlength: "6", dir: "ltr", autocomplete: "new-password" }),
    el("small", { class: "hint", text: "6 أحرف على الأقل" })));
  form.append(el("div", { class: "field" }, el("label", { for: "pw-cnf", text: "تأكيد كلمة المرور الجديدة" }),
    el("input", { id: "pw-cnf", name: "confirm", type: "password", required: true, minlength: "6", dir: "ltr", autocomplete: "new-password" })));

  openModal({
    title: "تغيير كلمة المرور", body: form, size: "sm",
    footer: `<button class="btn btn-ghost" data-close>إلغاء</button>
             <button class="btn btn-primary" data-submit>تغيير</button>`,
  });
  $("#modal-foot").querySelector("[data-submit]").addEventListener("click", (e) => { e.preventDefault(); form.requestSubmit(); });
}

async function renderProfile() {
  const u = state.user;
  if (!u) return el("div", { class: "card" }, el("div", { class: "card-body" },
    emptyState("i-lock", "غير مسجّل الدخول", "سجّل الدخول لعرض ملفك.")));
  const page = el("div", { class: "page" });

  const head = el("div", { class: "card" });
  const hb = el("div", { class: "card-body row", style: { gap: "16px" } });
  const av = avatarEl(u.fullName, u.avatarColor, 64);
  av.style.fontSize = "24px"; av.style.borderRadius = "20px";
  const info = el("div", { style: { flex: "1", minWidth: "0" } });
  info.innerHTML = `<div style="font-size:19px;font-weight:750">${esc(u.fullName)}</div>
    <div class="small muted">${esc(u.jobTitle || "عضو")} · <span class="mono">@${esc(u.username)}</span></div>
    <div class="row" style="gap:7px;margin-top:8px">
      ${state.workspace ? `<span class="chip-tag role-${state.membership?.role}">${esc(ROLE_LABEL[state.membership?.role])} في ${esc(state.workspace.name)}</span>` : ""}
      <span class="chip-tag">${esc(fmtRelative(u.lastLoginAt))}</span>
    </div>`;
  hb.append(av, info);
  head.append(hb);
  page.append(head);

  const form = el("form", { class: "stack", onsubmit: async (e) => {
    e.preventDefault();
    const btn = $("button[type=submit]", form);
    const fd = new FormData(form);
    busy(btn, true);
    try {
      const r = await api("/auth/profile", { method: "PATCH", body: {
        fullName: fd.get("fullName"), jobTitle: fd.get("jobTitle"),
        phone: fd.get("phone"), email: fd.get("email"), bio: fd.get("bio"),
      } });
      state.user = r.user;
      renderShell();
      toastOk("حُفظت البيانات");
    } catch (err) { showAlert(form, err.message); } finally { busy(btn, false); }
  } });

  form.append(el("div", { class: "grid-2" },
    el("div", { class: "field" }, el("label", { for: "pf-name", text: "الاسم الكامل" }),
      el("input", { id: "pf-name", name: "fullName", required: true, minlength: "2", maxlength: "80", value: u.fullName })),
    el("div", { class: "field" }, el("label", { for: "pf-title", text: "المسمى الوظيفي" }),
      el("input", { id: "pf-title", name: "jobTitle", maxlength: "80", value: u.jobTitle || "" }))));
  form.append(el("div", { class: "grid-2" },
    el("div", { class: "field" }, el("label", { for: "pf-phone", text: "الهاتف" }),
      el("input", { id: "pf-phone", name: "phone", type: "tel", maxlength: "30", dir: "ltr", value: u.phone || "" })),
    el("div", { class: "field" }, el("label", { for: "pf-email", text: "البريد الإلكتروني" }),
      el("input", { id: "pf-email", name: "email", type: "email", maxlength: "120", dir: "ltr", value: u.email || "" }))));
  form.append(el("div", { class: "field" }, el("label", { for: "pf-bio", text: "نبذة (تظهر لأعضاء بيئاتك)" }),
    el("textarea", { id: "pf-bio", name: "bio", rows: "2", maxlength: "300", text: u.bio || "" })));
  form.append(el("div", { class: "row" },
    el("button", { class: "btn btn-primary", type: "submit", html: icon("i-check") + "<span>حفظ</span>" }),
    el("button", { class: "btn btn-ghost", type: "button", html: icon("i-key") + "<span>تغيير كلمة المرور</span>", onclick: openPasswordForm })));

  const card = el("div", { class: "card" });
  card.append(el("div", { class: "card-head" }, el("div", {}, el("h2", { text: "بياناتي" }))));
  card.append(el("div", { class: "card-body" }, form));
  page.append(card);

  if (state.workspaces.length) {
    const c = el("div", { class: "card" });
    c.append(el("div", { class: "card-head" },
      el("div", {}, el("h2", { text: "بيئات العمل" }), el("p", { text: "أنت عضو في" })),
      el("div", { class: "card-head-actions" },
        el("button", { class: "btn btn-primary btn-sm", html: icon("i-plus") + "<span>بيئة جديدة</span>", onclick: openWorkspaceForm }))));
    const b = el("div", { class: "card-body" });
    const list = el("div", { class: "task-list" });
    for (const w of state.workspaces) {
      const node = el("div", { class: "task" });
      const row = el("div", { class: "task-head" });
      const badge = el("div", { text: initials(w.name) });
      badge.style.cssText = `width:40px;height:40px;border-radius:12px;display:grid;place-items:center;color:#fff;font-weight:750;background:${w.avatarColor || "var(--brand)"}`;
      row.append(badge);
      const main = el("div", { class: "task-main" });
      main.append(el("div", { class: "task-title", text: w.name }));
      const meta = el("div", { class: "task-meta" });
      meta.append(el("span", { class: "role-tag role-" + w.role, text: ROLE_LABEL[w.role] }),
        el("span", { class: "chip-tag", html: icon("i-users") + `<span>${w.memberCount} عضو</span>` }),
        w.pendingCount ? el("span", { class: "chip-tag t-amber", text: `${w.pendingCount} بانتظار` }) : null);
      main.append(meta);
      row.append(main);
      if (w.id !== state.workspace?.id) row.append(el("button", { class: "btn btn-soft btn-sm", text: "تبديل", onclick: () => switchWorkspace(w.id) }));
      else row.append(el("span", { class: "chip-tag t-green", text: "نشطة" }));
      node.append(row);
      list.append(node);
    }
    b.append(list);
    c.append(b);
    page.append(c);
  }
  return page;
}

// ═══════════════════════════════════════════════════════════
//  أدوات وتهيئة عامة
// ═══════════════════════════════════════════════════════════

async function refreshCurrent() {
  const view = state.view;
  try {
    const me = await api("/auth/me");
    state.badges = me.badges || {};
    state.invites = me.invites || 0;
    if (["members", "tasks", "dashboard", "reports", "done"].includes(view)) await loadMembers();
    renderShell();
  } catch { /* تجاهل */ }
  await navigate(view, false);
}

/** يعكس رابط الصفحة الحالي في الحالة وينتقل إن اختلف */
function syncFromHash() {
  const v = location.hash.replace(/^#\/?/, "") || (state.workspace ? "dashboard" : "welcome");
  if (state.user && v !== state.view) navigate(v, false);
}

const openSidebar = () => { $("#app").classList.add("sb-open"); $("#sb-backdrop").hidden = false; };
const closeSidebar = () => { $("#app").classList.remove("sb-open"); $("#sb-backdrop").hidden = true; };

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem("cw-theme", theme); } catch { /* تجاهل */ }
}

function bindShell() {
  $("#btn-menu").addEventListener("click", openSidebar);
  $("#sb-backdrop").addEventListener("click", closeSidebar);
  $("#sb-close").addEventListener("click", closeSidebar);

  $("#btn-theme").addEventListener("click", () => {
    applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });

  $("#btn-ws").addEventListener("click", (e) => { e.stopPropagation(); toggleWsMenu(); });
  document.addEventListener("click", (e) => {
    const menu = $("#ws-menu");
    if (!menu.hidden && !menu.contains(e.target) && !$("#btn-ws").contains(e.target)) {
      menu.hidden = true;
      $("#btn-ws").setAttribute("aria-expanded", "false");
    }
  });

  $("#btn-profile").addEventListener("click", () => navigate("profile"));

  $("#btn-logout").addEventListener("click", async () => {
    if (!(await confirmDialog({ title: "تسجيل الخروج", message: "هل تريد تسجيل الخروج؟", confirmText: "خروج", icon: "i-logout" }))) return;
    try { await api("/auth/logout", { method: "POST" }); } catch { /* تجاهل */ }
    location.reload();
  });

  modalRoot().addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeModal(); });

  // شبكة أمان: أي نافذة فارغة عالقة تُغلق تلقائياً
  setInterval(purgeStaleModals, 1200);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!modalRoot().hidden) closeModal();
      $("#ws-menu").hidden = true;
    }
    if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
      e.preventDefault();
      $(".search-box input")?.focus();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "k" && state.workspace && modalRoot().hidden) {
      e.preventDefault();
      state.isAdmin ? openTaskForm() : openTodoForm();
    }
  });

  window.addEventListener("popstate", (e) => {
    // إن كنا قد دفعنا حالة عند فتح نافذة ⇒ الرجوع يعني «أغلق النافذة»
    if (!modalRoot().hidden && e.state?.cwModal) return;
    if (!modalRoot().hidden) { closeModal(true); return; }
    syncFromHash();
  });
  // تغيير الرابط مباشرة (رابط مُشارَك أو لصق في شريط العنوان) يجب أن ينقل بين الصفحات
  window.addEventListener("hashchange", () => syncFromHash());

  window.addEventListener("resize", () => { if (window.innerWidth > 900) closeSidebar(); });

  setInterval(async () => {
    if (!state.user || $("#app").hidden) return;
    try {
      const me = await api("/auth/me");
      state.badges = me.badges || {};
      state.invites = me.invites || 0;
      renderShell();
    } catch { /* تجاهل */ }
  }, 60000);
}

function applyStoredTheme() {
  let theme;
  try { theme = localStorage.getItem("cw-theme"); } catch { /* تجاهل */ }
  if (!theme) theme = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  applyTheme(theme);
}

// ═══════════════════════════════════════════════════════════
//  البداية
// ═══════════════════════════════════════════════════════════

$("#app-version").textContent = "v2.0.0";
applyStoredTheme();
bindAuth();
bindShell();
boot();
