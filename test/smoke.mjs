// ═══════════════════════════════════════════════════════════
//  CheckWork v2 — اختبار شامل للنشر
//  BASE=https://checkwork-buy.pages.dev node test/smoke.mjs
// ═══════════════════════════════════════════════════════════

const BASE = (process.env.BASE || "http://localhost:8788").replace(/\/+$/, "");
const CLEAN = process.env.CLEAN !== "0";

let pass = 0, fail = 0;
const failures = [];

const C = {
  g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`, d: (s) => `\x1b[90m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`, c: (s) => `\x1b[36m${s}\x1b[0m`,
};

const ok = (n, x = "") => { pass++; console.log(`  ${C.g("✓")} ${n}${x ? C.d("  " + x) : ""}`); };
const no = (n, d = "") => { fail++; failures.push(n + " — " + d); console.log(`  ${C.r("✗")} ${n}\n      ${C.r(d)}`); };
const step = (n) => console.log(`\n${C.b(C.c("▌ " + n))}`);
const info = (m) => console.log(`    ${C.d(m)}`);

// ─────────── إعادة المحاولة عند فشل الشبكة ───────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await sleep(350 * (i + 1));
    }
  }
  throw lastErr;
}

// ─────────── عميل ───────────
function makeClient(label = "") {
  const jar = new Map();
  const csrf = { token: null };

  async function raw(path, { method = "GET", body, headers = {} } = {}) {
    return withRetry(() => rawOnce(path, { method, body, headers }));
  }

  async function rawOnce(path, { method = "GET", body, headers = {} } = {}) {
    const h = { ...headers };
    if (method !== "GET" && method !== "HEAD" && !("x-csrf-token" in h)) {
      if (csrf.token) h["x-csrf-token"] = csrf.token;
    }
    if (body !== undefined) h["content-type"] = "application/json";
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

    const res = await fetch(BASE + "/api" + path, {
      method, headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });

    for (const rawCookie of res.headers.getSetCookie?.() || []) {
      const [pair] = rawCookie.split(";");
      const i = pair.indexOf("=");
      const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
      if (/max-age=0/i.test(rawCookie)) jar.delete(k); else jar.set(k, v);
      if (k === "cw_csrf") csrf.token = v;
    }

    const ct = res.headers.get("content-type") || "";
    let data;
    if (ct.includes("application/json")) data = await res.json().catch(() => ({}));
    else data = await res.text();

    return {
      status: res.status, data, headers: res.headers,
      text: typeof data === "string" ? data : JSON.stringify(data),
    };
  }

  async function site(path, headers = {}) {
    return withRetry(() => siteOnce(path, headers));
  }

  async function siteOnce(path, headers = {}) {
    const res = await fetch(BASE + path, { headers, redirect: "manual" });
    for (const rawCookie of res.headers.getSetCookie?.() || []) {
      const [pair] = rawCookie.split(";");
      const i = pair.indexOf("=");
      const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
      if (/max-age=0/i.test(rawCookie)) jar.delete(k); else jar.set(k, v);
      if (k === "cw_csrf") csrf.token = v;
    }
    const ct = res.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await res.json().catch(() => ({})) : await res.text();
    return { status: res.status, data, headers: res.headers, text: typeof data === "string" ? data : JSON.stringify(data) };
  }

  return {
    label, jar, csrf, raw, site,
    get: (p) => raw(p),
    post: (p, b) => raw(p, { method: "POST", body: b ?? {} }),
    patch: (p, b) => raw(p, { method: "PATCH", body: b ?? {} }),
    put: (p, b) => raw(p, { method: "PUT", body: b ?? {} }),
    del: (p, headers = {}) => raw(p, { method: "DELETE", headers }),
    prime: () => this.get(""),
    has: (n) => jar.has(n),
    async register(username, password, fullName, workspaceName) {
      await site("");
      return this.post("/auth/register", { username, password, fullName, workspaceName });
    },
    async login(username, password) {
      await site("");
      return this.post("/auth/login", { username, password });
    },
  };
}

const S = Date.now().toString(36);
const OWNER_U = `own_${S}`;
const MEMBER_U = `mem_${S}`;
const OUTSIDER_U = `out_${S}`;
const P1 = "OwnerPass!1";
const P2 = "MemberPass!1";
const P3 = "Outsider!1";

const owner = makeClient("owner");
const member = makeClient("member");
const outsider = makeClient("outsider");

let wsId = null, ownerWs2 = null;
let memId = null;
let taskId = null, memTaskId = null;
let privateTodoId = null, sharedTodoId = null;

async function run() {
  console.log(C.b("\n╔══════════════════════════════════════════════════════════════╗"));
  console.log(C.b("║   CheckWork v2 — اختبار شامل للنشر                              ║"));
  console.log(C.b("╚══════════════════════════════════════════════════════════════╝"));
  info(`الهدف: ${BASE}`);

  // ═══ 1) الصحة والملفات ═══
  step("1) فحص الخدمة والملفات وترويسات الأمان");

  const h = await owner.get("/health");
  if (h.status === 200 && h.data.ok && h.data.db) ok("نقطة فحص الصحة", `db=${h.data.db} users=${h.data.users} workspaces=${h.data.workspaces}`);
  else { no("نقطة فحص الصحة", JSON.stringify(h.data)); return; }

  for (const [p, label] of [["", "الصفحة الرئيسية"], ["/css/app.css", "ملف CSS"], ["/js/app.js", "ملف JS"],
                            ["/manifest.webmanifest", "بيان PWA"], ["/icons/favicon.svg", "الأيقونة"],
                            ["/#/todos", "مسار SPA"]]) {
    const r = await owner.site(p);
    if (r.status === 200) ok(`تحميل ${label}`);
    else no(`تحميل ${label}`, `HTTP ${r.status}`);
  }

  const html = await owner.site("");
  for (const needle of ['dir="rtl"', 'lang="ar"', "form-login", "form-register", "auth-tabs", "/js/app.js"]) {
    if (String(html.data).includes(needle)) ok(`الصفحة تحتوي ${needle}`);
    else no(`الصفحة تحتوي ${needle}`, "مفقود");
  }

  for (const hh of ["x-content-type-options", "x-frame-options", "content-security-policy", "referrer-policy", "permissions-policy"]) {
    if (html.headers.get(hh)) ok(`ترويسة ${hh}`);
    else no(`ترويسة ${hh}`, "مفقودة");
  }

  // ═══ 2) CSRF ═══
  step("2) حماية CSRF");
  if (owner.csrf.token) ok("كوكي رمز CSRF صدر مع الصفحة");
  else no("كوكي رمز CSRF", "مفقود");

  const noCsrf = await owner.raw("/auth/login", { method: "POST", body: { username: "x", password: "y" }, headers: { "x-csrf-token": "" } });
  if (noCsrf.status === 403) ok("رفض طلب برمز CSRF فارغ");
  else no("رفض طلب برمز CSRF فارغ", `HTTP ${noCsrf.status}`);

  const wrongCsrf = await owner.raw("/auth/login", { method: "POST", body: {}, headers: { "x-csrf-token": "bad" } });
  if (wrongCsrf.status === 403) ok("رفض طلب برمز CSRF خاطئ");
  else no("رفض طلب برمز CSRF خاطئ", `HTTP ${wrongCsrf.status}`);

  const crossOrigin = await owner.raw("/auth/login", {
    method: "POST", body: {}, headers: { "origin": "https://evil.example.com" },
  });
  if (crossOrigin.status === 403) ok("رفض طلب من أصل خارجي");
  else no("رفض طلب من أصل خارجي", `HTTP ${crossOrigin.status}`);

  // ═══ 3) التسجيل الذاتي ═══
  step("3) التسجيل الذاتي (بدون موافقة أحد)");

  const reg = await owner.register(OWNER_U, P1, "مالك الاختبار", "بيئة الاختبار");
  if (reg.status === 200 && reg.data.user?.username === OWNER_U) ok("تسجيل حساب جديد", `@${OWNER_U}`);
  else { no("تسجيل حساب جديد", `${reg.status} ${reg.text?.slice(0, 170)}`); return; }

  if (owner.has("cw_session")) ok("الجلسة أُنشئت تلقائياً بعد التسجيل");
  else no("الجلسة أُنشئت تلقائياً بعد التسجيل", "لا كوكي");

  wsId = reg.data.workspace?.id;
  if (wsId) ok("أُنشئت بيئة عمل خاصة تلقائياً", `id=${wsId} name=${reg.data.workspace.name}`);
  else no("أُنشئت بيئة عمل خاصة تلقائياً", JSON.stringify(reg.data.workspace));

  const me = await owner.get("/auth/me");
  if (me.status === 200 && me.data.isOwner === true && me.data.user.role === undefined) ok("الدور: صاحب بيئة العمل", `isAdmin=${me.data.isAdmin}`);
  else no("الدور: صاحب بيئة العمل", JSON.stringify({ isOwner: me.data?.isOwner, isAdmin: me.data?.isAdmin }));

  // فحص توفّر اسم المستخدم
  const avail = await owner.get(`/auth/check-username?username=${OWNER_U}`);
  if (avail.data.available === false) ok("فحص توفّر اسم المستخدم: محجوز");
  else no("فحص توفّر اسم المستخدم", JSON.stringify(avail.data));
  const free = await owner.get(`/auth/check-username?username=free_${S}`);
  if (free.data.available === true) ok("فحص توفّر اسم المستخدم: متاح");
  else no("فحص توفّر اسم المستخدم: متاح", JSON.stringify(free.data));

  // ═══ 4) التحقق من المدخلات عند التسجيل ═══
  step("4) التحقق من صحة المدخلات (تسجيل ودخول)");

  const regCases = [
    ["اسم مستخدم مكرر", () => owner.register(OWNER_U, P1, "مكرر"), [409]],
    ["اسم مستخدم بأحرف كبيرة/عربية", () => owner.register("أحمد", P1, "ع"), [400]],
    ["اسم مستخدم قصير", () => owner.register("ab", P1, "س"), [400]],
    ["كلمة مرور قصيرة", () => owner.register(`x_${S}`, "123", "س"), [400]],
    ["اسم فارغ", () => owner.register(`y_${S}`, P1, ""), [400]],
    ["اسم طويل جداً", () => owner.register(`z_${S}`, P1, "ا".repeat(200)), [400]],
  ];
  for (const [label, fn, exp] of regCases) {
    const r = await fn().catch((e) => ({ status: -1, text: e.message }));
    if (exp.includes(r.status)) ok(`رفض: ${label}`, `HTTP ${r.status}`);
    else no(`رفض: ${label}`, `توقع ${exp} ـ ${r.status} ${String(r.text).slice(0, 110)}`);
  }

  const wrongPw = await owner.login(OWNER_U, "خطأ-كلمة- المرور");
  if (wrongPw.status === 401) ok("رفض دخول بكلمة مرور خاطئة");
  else no("رفض دخول بكلمة مرور خاطئة", `HTTP ${wrongPw.status}`);

  const ghost = await owner.login("لا-يوجد-هذا", "ببببب");
  if (ghost.status === 401 && wrongPw.status === 401) ok("رسالة موحّدة (منع استlisting الحسابات)");
  else no("رسالة موحّدة", `${ghost.status}/${wrongPw.status}`);

  // ═══ 5) تسجيل بقية الحسابات ═══
  step("5) تسجيل حسابات أخرى ((member و outsider))");

  const regM = await member.register(MEMBER_U, P2, "عضو الاختبار", "بيئة العضو");
  if (regM.status === 200) ok("تسجيل حساب العضو", `@${MEMBER_U}`);
  else no("تسجيل حساب العضو", `${regM.status} ${regM.text?.slice(0, 140)}`);

  const regO = await outsider.register(OUTSIDER_U, P3, "غير عضو", "بيئة الغريب");
  if (regO.status === 200) ok("تسجيل حساب غير العضو", `@${OUTSIDER_U}`);
  else no("تسجيل حساب غير العضو", `${regO.status}`);

  // ═══ 6) بيئات العمل ═══
  step("6) بيئات العمل — كل مستخدم يبني بيئته ويديرها");

  const wsList = await owner.get("/workspaces");
  if (wsList.status === 200 && wsList.data.workspaces.length >= 1) ok("جلب بيئات العمل", `${wsList.data.workspaces.length} بيئة`);
  else no("جلب بيئات العمل", `${wsList.status}`);

  const newWs = await owner.post("/workspaces", { name: "مشروع ثانٍ", tagline: "بيئة مستقلة" });
  if (newWs.status === 200 && newWs.data.workspace.role === "owner") ok("إنشاء بيئة عمل ثانية");
  else no("إنشاء بيئة عمل ثانية", `${newWs.status} ${newWs.text?.slice(0, 140)}`);
  ownerWs2 = newWs.data.workspace?.id;

  const afterCreate = await owner.get("/workspaces");
  if (afterCreate.data.workspaces.length >= 2) ok("التبديل إلى البيئة الجديدة تلقائياً");
  else no("التبديل إلى البيئة الجديدة تلقائياً", `${afterCreate.data.workspaces.length}`);

  const sw = await owner.post(`/workspaces/${wsId}/switch`, {});
  if (sw.status === 200) ok("الرجوع للبيئة الأصلية");
  else no("الرجوع للبيئة الأصلية", `${sw.status}`);

  const swBad = await owner.post(`/workspaces/99999999/switch`, {});
  if (swBad.status === 403) ok("منع التبديل لبيئة غير عضو فيها");
  else no("منع التبديل لبيئة غير عضو فيها", `HTTP ${swBad.status}`);

  // ═══ 7) الدعوة عبر اسم المستخدم ═══
  step("7) دعوة العضو عبر username — والموافقة عليه");

  const invGhost = await owner.post("/members", { username: `ghost_${S}` });
  if (invGhost.status === 404) ok("رفض دعوة حساب غير مسجّل");
  else no("رفض دعوة حساب غير مسجّل", `HTTP ${invGhost.status}`);

  const invSelf = await owner.post("/members", { username: OWNER_U });
  if (invSelf.status === 400) ok("رفض دعوة النفس");
  else no("رفض دعوة النفس", `HTTP ${invSelf.status}`);

  const inv = await owner.post("/members", { username: MEMBER_U, role: "member", jobTitle: "موظف تنفيذ" });
  if (inv.status === 200 && inv.data.pending === true) ok("إرسال الدعوة", inv.data.message || "");
  else no("إرسال الدعوة", `${inv.status} ${inv.text?.slice(0, 150)}`);

  const invAgain = await owner.post("/members", { username: MEMBER_U });
  if (invAgain.status === 409) ok("منع تكرار الدعوة");
  else no("منع تكرار الدعوة", `HTTP ${invAgain.status}`);

  const memListPending = await owner.get("/members");
  if (memListPending.status === 200 && memListPending.data.members.some((m) => m.status === "pending")) ok("العضو يظهر كـ«بانتظار الموافقة»");
  else no("العضو يظهر كـ«بانتظار الموافقة»", JSON.stringify(memListPending.data?.members?.map((m) => m.status)));

  // العضو يرى الدعوة
  const memInvites = await member.get("/invites");
  if (memInvites.status === 200 && memInvites.data.invites.length === 1) ok("العضو يرى الدعوة الواردة", memInvites.data.invites[0].workspace.name);
  else no("العضو يرى الدعوة الواردة", `${memInvites.status} ${memInvites.data?.invites?.length}`);

  // العضو في بيئته الخاصة فقط؛ لا يصل إلى بيئة غيره
  const crossWsTasks = await member.get("/tasks");
  if (crossWsTasks.status === 200 && crossWsTasks.data.tasks.length === 0) ok("العضو غير المنضم لا يرى مهام بيئته الخاصة");
  else no("العضو غير المنضم لا يرى مهام بيئته الخاصة", `${crossWsTasks.status} ${crossWsTasks.data?.tasks?.length}`);

  const earlyMemberList = await owner.get("/members");
  if (!earlyMemberList.data.members.some((m) => m.username === MEMBER_U && m.status === "active")) ok("العضو غير فعّال في بيئة المالك قبل الموافقة");
  else no("العضو غير فعّال قبل الموافقة", "نشط بالفعل");

  // الموافقة
  const accept = await member.post(`/invites/${memInvites.data.invites[0].id}/accept`, {});
  if (accept.status === 200) ok("العضو قبل الدعوة وأصبح عضواً", `البيئة: ${accept.data.workspace.name}`);
  else no("العضو قبل الدعوة", `${accept.status} ${accept.text?.slice(0, 140)}`);

  const memberMe = await member.get("/auth/me");
  if (memberMe.data.isOwner === false && memberMe.data.isAdmin === false && memberMe.data.workspace?.id === wsId) ok("العضو became عضواً بصلاحية موظف");
  else no("العضو أصبح عضواً بصلاحية موظف", JSON.stringify({ o: memberMe.data?.isOwner, a: memberMe.data?.isAdmin, w: memberMe.data?.workspace?.id }));

  const acceptAgain = await member.post(`/invites/${memInvites.data.invites[0].id}/accept`, {});
  if (acceptAgain.status === 404) ok("لا يمكن قبول الدعوة مرتين");
  else no("لا يمكن قبول الدعوة مرتين", `HTTP ${acceptAgain.status}`);

  // المجموعات独立的
  const outsiderMembers = await outsider.get("/members");
  if (outsiderMembers.status === 200 && outsiderMembers.data.members.length === 1) ok("عزل الأعضاء بين البيئات", "الخارجي يرى عضوه فقط");
  else no("عزل الأعضاء بين البيئات", `${outsiderMembers.data?.members?.length}`);

  // ═══ 8) دورة حياة المهمة ═══
  step("8) دورة حياة المهمة (إسناد ← قراءة ← إنجاز)");

  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const past = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);

  const ownerMembers = await owner.get("/members");
  const memberRow = ownerMembers.data.members.find((m) => m.username === MEMBER_U);
  memId = memberRow?.userId;
  if (memId) ok("جلب معرّف العضو", `userId=${memId}`);
  else { no("جلب معرّف العضو", "غير موجود"); return; }

  const noAssignee = await owner.post("/tasks", { title: "بلا مسؤول", assigneeIds: [] });
  if (noAssignee.status === 400) ok("رفض مهمة بلا مسؤول");
  else no("رفض مهمة بلا مسؤول", `HTTP ${noAssignee.status}`);

  const badAssignee = await owner.post("/tasks", { title: "مسؤول غير عضو", assigneeIds: [99999999] });
  if (badAssignee.status === 400) ok("رفض إسناد لغير عضو في البيئة");
  else no("رفض إسناد لغير عضو في البيئة", `HTTP ${badAssignee.status}`);

  const t1 = await owner.post("/tasks", {
    title: "تجهيز عرض الأسعار", description: "إعداد العرض مع التسعير النهائي", priority: "high", dueDate: tomorrow,
    assigneeIds: [memId], managerNote: "أولوية عالية",
  });
  if (t1.status === 200 && t1.data.created === 1) { taskId = t1.data.tasks[0].id; ok("إسناد مهمة للعضو", `id=${taskId}`); }
  else no("إسناد مهمة للعضو", `${t1.status} ${t1.text?.slice(0, 150)}`);

  const t2 = await owner.post("/tasks", { title: "مهمة متأخرة", description: "مطلوبة أمس", priority: "urgent", dueDate: past, assigneeIds: [memId] });
  if (t2.status === 200) { memTaskId = t2.data.tasks[0].id; ok("إسناد مهمة متأخرة"); }
  else no("إسناد مهمة متأخرة", `${t2.status}`);

  const selfAssign = await owner.post("/tasks", { title: "مهمة لنفسي", assigneeIds: [(await owner.get("/auth/me")).data.user.id] });
  if (selfAssign.status === 200) ok("صاحب البيئة عضو في بيئته ويستطيع إسناد مهام لنفسه");
  else no("صاحب البيئة يستطيع إسناد مهام لنفسه", `${selfAssign.status}`);

  // العضو يرى مهامه فقط
  const memTasks = await member.get("/tasks");
  if (memTasks.status === 200 && memTasks.data.tasks.length === 2 && memTasks.data.tasks.every((t) => t.assigneeId === memberMe.data.user.id)) {
    ok("العضو يرى مهامه فقط", `${memTasks.data.tasks.length} مهمة`);
  } else no("العضو يرى مهامه فقط", `${memTasks.status} ${memTasks.data?.tasks?.length}`);

  const ownerAll = await owner.get("/tasks?scope=all");
  if (ownerAll.status === 200 && ownerAll.data.tasks.length >= 3) ok("المشرف يرى كل مهام البيئة", `${ownerAll.data.tasks.length}`);
  else no("المشرف يرى كل مهام البيئة", `${ownerAll.status} ${ownerAll.data?.tasks?.length}`);

  const overdue = (memTasks.data.tasks || []).filter((t) => t.overdue);
  if (overdue.length === 1) ok("رصد المهمة المتأخرة");
  else no("رصد المهمة المتأخرة", `${overdue.length}`);

  // عزل المهام عن بيئات أخرى
  const outsiderTasks = await outsider.get("/tasks");
  if (outsiderTasks.status === 200 && outsiderTasks.data.tasks.length === 0) ok("عزل المهام بين البيئات");
  else no("عزل المهام بين البيئات", `${outsiderTasks.data?.tasks?.length}`);

  // تعليم كمقروء
  const rd = await member.patch(`/tasks/${taskId}`, { markRead: true });
  if (rd.status === 200 && rd.data.task.status === "read" && rd.data.task.readAt) ok("العضو يعلّم المهمة كمقروءة", `readAt=${rd.data.task.readAt}`);
  else no("العضو يعلّم المهمة كمقروءة", `${rd.status} ${rd.data?.task?.status}`);

  // عزل بين الأعضاء
  const otherOwnerTask = (await owner.get("/tasks?scope=all")).data.tasks.find((t) => t.assigneeId !== memberMe.data.user.id);
  if (otherOwnerTask) {
    const cross = await member.patch(`/tasks/${otherOwnerTask.id}`, { markDone: true });
    if (cross.status === 403) ok("منع الموظف من تعديل مهمة موظف آخر");
    else no("منع الموظف من تعديل مهمة موظف آخر", `HTTP ${cross.status}`);

    const crossView = await member.get(`/tasks/${otherOwnerTask.id}`);
    if (crossView.status === 403) ok("منع الموظف من عرض مهمة موظف آخر");
    else no("منع الموظف من عرض مهمة موظف آخر", `HTTP ${crossView.status}`);

    const crossNote = await member.post(`/tasks/${otherOwnerTask.id}/notes`, { body: "تطفّل" });
    if (crossNote.status === 403) ok("منع الموظف من التعليق على مهمة غيره");
    else no("منع الموظف من التعليق على مهمة غيره", `HTTP ${crossNote.status}`);
  }

  // الإنجاز
  const done = await member.patch(`/tasks/${taskId}`, { markDone: true, resultNote: "تم التسليم واستلام إشعار الاستلام.", progress: 100 });
  if (done.status === 200 && done.data.task.status === "done" && done.data.task.completedAt) ok("إنجاز المهمة وتسجيل التاريخ");
  else no("إنجاز المهمة وتسجيل التاريخ", `${done.status} ${done.data?.task?.status}`);
  if (done.data.task?.progress === 100) ok("نسبة الإنجاز 100%");
  else no("نسبة الإنجاز 100%", done.data.task?.progress);

  const ownerDone = await owner.get("/tasks?status=done");
  if (ownerDone.data.tasks.some((t) => t.id === taskId)) ok("المشرف يرى المهمة في سجل الإنجاز");
  else no("المشرف يرى المهمة في سجل الإنجاز", `${ownerDone.data?.tasks?.length}`);

  const ownerDetail = await owner.get(`/tasks/${taskId}`);
  if (ownerDetail.data.task?.resultNote?.includes("إشعار الاستلام")) ok("المشرف يرى ملاحظة إنجاز الموظف");
  else no("المشرف يرى ملاحظة إنجاز الموظف", ownerDetail.data.task?.resultNote);
  if (ownerDetail.data.task?.managerNote === "أولوية عالية") ok("الموظف يرى ملاحظة المشرف");
  else no("الموظف يرى ملاحظة المشرف", ownerDetail.data.task?.managerNote);

  const stats = await owner.get("/stats");
  if (stats.status === 200 && stats.data.totals.done >= 1) ok("الإحصاءات تعكس الإنجاز", `done=${stats.data.totals.done} rate=${stats.data.totals.completionRate}%`);
  else no("الإحصاءات تعكس الإنجاز", JSON.stringify(stats.data?.totals));

  // إعادة الفتح
  const reopen = await owner.patch(`/tasks/${taskId}`, { reopen: true });
  if (reopen.data.task?.status === "read" && !reopen.data.task.completedAt) ok("إعادة الفتح تمسح تاريخ الإنجاز");
  else no("إعادة الفتح تمسح تاريخ الإنجاز", JSON.stringify(reopen.data?.task?.status));
  await member.patch(`/tasks/${taskId}`, { markDone: true, resultNote: "تم التسليم النهائي." });

  // التعليقات
  const n1 = await member.post(`/tasks/${taskId}/notes`, { body: "هل نحتاج مراجعة قانونية؟" });
  if (n1.status === 200) ok("تعليق من الموظف");
  else no("تعليق من الموظف", `${n1.status}`);
  const n2 = await owner.post(`/tasks/${taskId}/notes`, { body: "نعم، راجع مع القانون." });
  if (n2.status === 200) ok("رد من المشرف");
  else no("رد من المشرف", `${n2.status}`);
  const notes = await owner.get(`/tasks/${taskId}`);
  if (notes.data.notes?.length === 2) ok("قراءة التعليقات", `${notes.data.notes.length}`);
  else no("قراءة التعليقات", notes.data.notes?.length);
  const emptyNote = await owner.post(`/tasks/${taskId}/notes`, { body: "   " });
  if (emptyNote.status === 400) ok("رفض تعليق فارغ");
  else no("رفض تعليق فارغ", `HTTP ${emptyNote.status}`);

  // إعادة الإسناد
  const ownerUid = (await owner.get("/auth/me")).data.user.id;
  const reassign = await owner.patch(`/tasks/${taskId}`, { assigneeId: ownerUid });
  if (reassign.status === 200 && reassign.data.task.assigneeId === ownerUid) ok("إعادة إسناد المهمة");
  else no("إعادة إسناد المهمة", `${reassign.status}`);
  const afterReassign = await member.patch(`/tasks/${taskId}`, { markDone: true });
  if (afterReassign.status === 403) ok("الصلاحية سُحبت من الموظف السابق");
  else no("الصلاحية سُحبت من الموظف السابق", `HTTP ${afterReassign.status}`);
  await owner.patch(`/tasks/${taskId}`, { assigneeId: memId });

  // حذف
  const eDel = await member.del(`/tasks/${taskId}`);
  if (eDel.status === 403) ok("منع الموظف من حذف مهمة");
  else no("منع الموظف من حذف مهمة", `HTTP ${eDel.status}`);
  const mDel = await owner.del(`/tasks/${memTaskId}`);
  if (mDel.status === 200) ok("حذف المهمة بواسطة المشرف");
  else no("حذف المهمة بواسطة المشرف", `${mDel.status}`);
  const gone = await owner.get(`/tasks/${memTaskId}`);
  if (gone.status === 404) ok("المهمة المحذوفة لم تعد موجودة");
  else no("المهمة المحذوفة لم تعد موجودة", `HTTP ${gone.status}`);

  // ═══ 9) قوائم TODO ═══
  step("9) قوائم TODO — خاصة و مرئية لبيئة العمل");

  const tdo1 = await member.post("/todos", { title: "عنصر خاص", description: "لا يراه أحد", visibility: "private" });
  if (tdo1.status === 200 && tdo1.data.todo.visibility === "private") { privateTodoId = tdo1.data.todo.id; ok("إنشاء قائمة خاصة"); }
  else no("إنشاء قائمة خاصة", `${tdo1.status} ${tdo1.text?.slice(0, 140)}`);

  const tdo2 = await member.post("/todos", { title: "عنصر عام", description: "يراه كل الأعضاء", visibility: "workspace", priority: "high" });
  if (tdo2.status === 200 && tdo2.data.todo.visibility === "workspace") { sharedTodoId = tdo2.data.todo.id; ok("إنشاء قائمة عامة (مرئية لبيئة العمل)"); }
  else no("إنشاء قائمة عامة", `${tdo2.status} ${tdo2.text?.slice(0, 140)}`);

  // المشرف يرى العامة ولا يرى الخاصة
  const ownerTodos = await owner.get("/todos");
  const ownerTitles = (ownerTodos.data.todos || []).map((t) => t.title);
  if (ownerTitles.includes("عنصر عام") && !ownerTitles.includes("عنصر خاص")) ok("المشرف يرى العامة ولا يرى الخاصة");
  else no("المشرف يرى العامة ولا يرى الخاصة", JSON.stringify(ownerTitles));

  // العضو يرى قائمته (خاصة + عامة)
  const memTodos = await member.get("/todos");
  const memTitles = (memTodos.data.todos || []).map((t) => t.title);
  if (memTitles.includes("عنصر خاص") && memTitles.includes("عنصر عام")) ok("العضو يرى قائمته الخاصة والعامة");
  else no("العضو يرى قائمته الخاصة والعامة", JSON.stringify(memTitles));

  // الغريب لا يرى شيئاً
  const outsiderTodos = await outsider.get("/todos");
  if (outsiderTodos.status === 200 && outsiderTodos.data.todos.length === 0) ok("الغريب لا يرى أي قائمة");
  else no("الغريب لا يرى أي قائمة", `${outsiderTodos.data?.todos?.length}`);

  // تصفية حسب النوع
  const privView = await member.get("/todos?view=private");
  if (privView.data.todos.length === 1 && privView.data.todos[0].title === "عنصر خاص") ok("تصفية: الخاصة فقط");
  else no("تصفية: الخاصة فقط", JSON.stringify(privView.data.todos.map((t) => t.title)));
  const sharedView = await member.get("/todos?view=shared");
  if (sharedView.data.todos.length === 1 && sharedView.data.todos[0].title === "عنصر عام") ok("تصفية: المشتركة فقط");
  else no("تصفية: المشتركة فقط", JSON.stringify(sharedView.data.todos.map((t) => t.title)));

  const counts = await member.get("/todos");
  if (counts.data.counts.private === 1 && counts.data.counts.shared === 1) ok("عدّادات القوائم", JSON.stringify(counts.data.counts));
  else no("عدّادات القوائم", JSON.stringify(counts.data.counts));

  // الإنجاز
  const markDone = await member.patch(`/todos/${sharedTodoId}`, { done: true });
  if (markDone.status === 200 && markDone.data.todo.done === true && markDone.data.todo.completedAt) ok("تعليم عنصر TODO كمنجز");
  else no("تعليم عنصر TODO كمنجز", `${markDone.status} ${markDone.data?.todo?.done}`);
  const undone = await member.patch(`/todos/${sharedTodoId}`, { done: false });
  if (undone.data.todo?.done === false && !undone.data.todo.completedAt) ok("إلغاء الإنجاز");
  else no("إلغاء الإنجاز", JSON.stringify(undone.data?.todo));

  // تبديل المشاركة
  const toShared = await member.patch(`/todos/${privateTodoId}`, { visibility: "workspace" });
  if (toShared.data.todo?.visibility === "workspace") ok("تحويل قائمة خاصة ← عامة");
  else no("تحويل قائمة خاصة ← عامة", toShared.data.todo?.visibility);
  const toPrivate = await member.patch(`/todos/${privateTodoId}`, { visibility: "private" });
  if (toPrivate.data.todo?.visibility === "private") ok("تحويل قائمة عامة ← خاصة");
  else no("تحويل قائمة عامة ← خاصة", toPrivate.data.todo?.visibility);

  // حراسة التعديل
  const outsiderEdit = await outsider.patch(`/todos/${sharedTodoId}`, { done: true });
  if (outsiderEdit.status === 403) ok("منع تعديل قائمة شخص آخر");
  else no("منع تعديل قائمة شخص آخر", `HTTP ${outsiderEdit.status}`);
  const outsiderDel = await outsider.del(`/todos/${sharedTodoId}`);
  if (outsiderDel.status === 403) ok("منع حذف قائمة شخص آخر");
  else no("منع حذف قائمة شخص آخر", `HTTP ${outsiderDel.status}`);
  const outsiderView = await outsider.get(`/todos/${sharedTodoId}`);
  if (outsiderView.status === 403 || outsiderView.status === 404) ok("منع عرض قائمة بيئة أخرى", `HTTP ${outsiderView.status}`);
  else no("منع عرض قائمة بيئة أخرى", `HTTP ${outsiderView.status}`);

  // المشرف يعدّل قائمة عامة
  const adminEdit = await owner.patch(`/todos/${sharedTodoId}`, { title: "عنصر عام (معدّل من المشرف)" });
  if (adminEdit.status === 200) ok("المشرف يعدّل قائمة عامة");
  else no("المشرف يعدّل قائمة عامة", `HTTP ${adminEdit.status}`);
  const adminEditPrivate = await owner.patch(`/todos/${privateTodoId}`, { title: "اختراق" });
  if (adminEditPrivate.status === 403) ok("المشرف لا يعدّل القوائم الخاصة");
  else no("المشرف لا يعدّل القوائم الخاصة", `HTTP ${adminEditPrivate.status}`);

  // مسح المنجزة
  await member.patch(`/todos/${sharedTodoId}`, { done: true });
  const cleared = await member.post("/todos/clear-done", {});
  if (cleared.status === 200 && cleared.data.deleted >= 1) ok("مسح العناصر المنجزة", `حُذف ${cleared.data.deleted}`);
  else no("مسح العناصر المنجزة", JSON.stringify(cleared.data));

  // التحقق من مدخلات TODO
  const badTodo = await member.post("/todos", { title: "" });
  if (badTodo.status === 400) ok("رفض عنوان TODO فارغ");
  else no("رفض عنوان TODO فارغ", `HTTP ${badTodo.status}`);

  // ═══ 10) صلاحيات الأدوار ═══
  step("10) صلاحيات الأدوار (owner / admin / member)");

  const memberRoles = [
    ["إنشاء مهمة", () => member.post("/tasks", { title: "x", assigneeIds: [memId] })],
    ["عرض التقارير", () => member.get("/reports")],
    ["إدارة الأعضاء", () => member.post("/members", { username: OUTSIDER_U })],
    ["تعديل الإعدادات", () => member.patch(`/workspaces/${wsId}`, { name: "اختراق" })],
    ["دعوة عضو", () => member.post("/members", { username: OUTSIDER_U })],
    ["تصدير تقرير", () => member.get("/reports.csv")],
  ];
  for (const [label, fn] of memberRoles) {
    const r = await fn().catch((e) => ({ status: -1, text: e.message }));
    if (r.status === 403) ok(`منع الموظف: ${label}`, `HTTP 403`);
    else no(`منع الموظف: ${label}`, `HTTP ${r.status}`);
  }

  // ترقية العضو إلى مشرف
  const promote = await owner.patch(`/members/${memberRow.id}`, { role: "admin" });
  if (promote.status === 200) ok("ترقية العضو إلى مشرف");
  else no("ترقية العضو إلى مشرف", `${promote.status} ${promote.text?.slice(0, 140)}`);

  const memAfterPromo = await member.get("/auth/me");
  if (memAfterPromo.data.isAdmin === true) ok("العضو أصبح مشرفاً بعد الترقية");
  else no("العضو أصبح مشرفاً بعد الترقية", `isAdmin=${memAfterPromo.data?.isAdmin}`);

  const ownerSeesAll = await owner.get("/tasks?scope=all");
  const memCanSeeAll = await member.get("/tasks?scope=all");
  if (memCanSeeAll.status === 200 && memCanSeeAll.data.total === ownerSeesAll.data.total && memCanSeeAll.data.total > 0) {
    ok("المشرف يرى كل مهام البيئة", `${memCanSeeAll.data.total} مهمة (مثل المالك)`);
  } else no("المشرف يرى كل مهام البيئة", `المشرف=${memCanSeeAll.data?.total} المالك=${ownerSeesAll.data?.total} HTTP=${memCanSeeAll.status}`);

  const demote = await member.patch(`/members/${(await owner.get("/members")).data.members.find((m) => m.username === OWNER_U)?.id}`, { role: "member" });
  if (demote.status === 403) ok("المشرف العادي لا يستطيع تغيير رتبة صاحب البيئة");
  else no("المشرف العادي لا يستطيع تغيير رتبة صاحب البيئة", `HTTP ${demote.status}`);

  const demoteSelf = await member.patch(`/members/${memberRow.id}`, { role: "member" });
  if (demoteSelf.status === 200) ok("إعادة رتبة المشرف إلى موظف");
  else no("إعادة رتبة المشرف إلى موظف", `${demoteSelf.status}`);

  // ═══ 11) دعوات جديدة: رفض ودعوة ثانية ═══
  step("11) دعوات جديدة: الغريب يُدعى ويرفض ثم يُدعى ويلاً بيئته الخاصة");

  const inv2 = await owner.post("/members", { username: OUTSIDER_U });
  if (inv2.status === 200) ok("إرسال دعوة ثانية للغريب");
  else no("إرسال دعوة ثانية للغريب", `${inv2.status}`);

  const outInvites = await outsider.get("/invites");
  if (outInvites.data.invites?.length === 1) ok("الغريب يرى الدعوة");
  else no("الغريب يرى الدعوة", `${outInvites.data?.invites?.length}`);

  const decline = await outsider.post(`/invites/${outInvites.data.invites[0].id}/decline`, {});
  if (decline.status === 200) ok("رفض الدعوة");
  else no("رفض الدعوة", `${decline.status}`);

  const afterDecline = await outsider.get("/invites");
  if (afterDecline.data.invites.length === 0) ok("الدعوة المرفوضة اختفت");
  else no("الدعوة المرفوضة اختفت", `${afterDecline.data.invites.length}`);

  const reInvite = await owner.post("/members", { username: OUTSIDER_U });
  if (reInvite.status === 200) ok("إعادة الدعوة بعد الرفض تعمل");
  else no("إعادة الدعوة بعد الرفض تعمل", `${reInvite.status} ${reInvite.text?.slice(0, 130)}`);

  const outInvites2 = await outsider.get("/invites");
  await outsider.post(`/invites/${outInvites2.data.invites[0].id}/accept`, {});
  const outMe = await outsider.get("/auth/me");
  if (outMe.data.workspace?.id === wsId) ok("الغريب قبل وانضم");
  else no("الغبير قبل وانضم", JSON.stringify(outMe.data?.workspace?.id));

  // ═══ 12) التصفية والبحث ═══
  step("12) التصفية والبحث والترتيب");

  const filters = [
    ["/tasks?status=done", (t) => t.status === "done", "تصفية: منجز"],
    ["/tasks?status=new", (t) => t.status === "new", "تصفية: جديد"],
    ["/tasks?priority=high", (t) => t.priority === "high", "تصفية: أولوية عالية"],
    ["/tasks?q=عرض", (t) => JSON.stringify(t).includes("عرض"), "بحث نصي"],
    ["/tasks?sort=due", () => true, "ترتيب حسب الاستحقاق"],
    [`/tasks?assigneeId=${memId}`, (t) => t.assigneeId === memId, "تصفية حسب العضو"],
    ["/todos?q=خاص", (t) => JSON.stringify(t).includes("خاص"), "بحث في القوائم"],
  ];
  for (const [url, pred, label] of filters) {
    const r = await owner.get(url);
    const list = r.data?.tasks || r.data?.todos;
    if (r.status === 200 && Array.isArray(list) && list.every(pred)) ok(label, `${list.length} نتيجة`);
    else no(label, `${r.status} ${list?.length} — ${list?.filter((t) => !pred(t)).length} خاطئة`);
  }

  // ═══ 13) التقارير والتصدير ═══
  step("13) التقارير وتصدير CSV");

  const rep = await owner.get("/reports");
  if (rep.status === 200 && rep.data.reports.length >= 2) ok("تقرير أداء الأعضاء", `${rep.data.reports.length} صف`);
  else no("تقرير أداء الأعضاء", `${rep.status} ${rep.data?.reports?.length}`);
  if (rep.data?.reports?.every((r) => typeof r.completionRate === "number" && typeof r.onTimeRate === "number")) ok("حقول التقرير");
  else no("حقول التقرير", "ناقصة");

  const csv = await owner.raw("/export/tasks.csv");
  if (csv.status === 200 && String(csv.data).includes("المهمة")) ok("تصدير CSV للمهمات");
  else no("تصدير CSV للمهمات", `${csv.status}`);
  // Response.text() يحذف BOM، لذا نفحص البايتات الخام
  const csvBytes = new Uint8Array(await (await fetch(BASE + "/api/export/tasks.csv", {
    headers: { cookie: [...owner.jar].map(([k, v]) => `${k}=${v}`).join("; ") },
  })).arrayBuffer());
  if (csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf) ok("CSV يبدأ بعلامة BOM لدعم العربية في Excel");
  else no("CSV يبدأ بعلامة BOM", `البايتات: ${[...csvBytes.slice(0, 4)].map((b) => b.toString(16)).join(" ")}`);

  const rcsv = await owner.raw("/reports.csv");
  if (rcsv.status === 200 && String(rcsv.data).includes("العضو")) ok("تصدير CSV للتقارير");
  else no("تصدير CSV للتقارير", `${rcsv.status}`);

  const ecsv = await member.raw("/export/tasks.csv");
  if (ecsv.status === 200) ok("الموظف يصدّر مهامه فقط");
  else no("الموظف يصدّر مهامه فقط", `${ecsv.status}`);

  // ═══ 14) الإعدادات ═══
  step("14) إعدادات بيئة العمل");

  const s1 = await owner.patch(`/workspaces/${wsId}`, { name: "بيئة الاختبار المعدّلة", taskDueDays: "10" });
  if (s1.status === 200 && s1.data.workspace.name === "بيئة الاختبار المعدّلة") ok("تعديل اسم البيئة والمهلة");
  else no("تعديل اسم البيئة والمهلة", `${s1.status}`);

  const s2 = await owner.patch(`/workspaces/${wsId}`, { name: "بيئة الاختبار", taskDueDays: "7" });
  if (s2.status === 200) ok("استعادة الإعدادات");
  else no("استعادة الإعدادات", `${s2.status}`);

  const badDays = await owner.patch(`/workspaces/${wsId}`, { taskDueDays: "999" });
  if (badDays.status === 400) ok("رفض مهلة خارج النطاق");
  else no("رفض مهلة خارج النطاق", `HTTP ${badDays.status}`);

  // ═══ 15) الملف الشخصي وكلمة المرور ═══
  step("15) الملف الشخصي وكلمة المرور");

  const pf = await member.patch("/auth/profile", { fullName: "العضو المعدّل", jobTitle: "أخصائي", bio: "نبذة" });
  if (pf.status === 200 && pf.data.user.fullName === "العضو المعدّل") ok("تحديث الملف الشخصي");
  else no("تحديث الملف الشخصي", `${pf.status}`);

  const wrongCur = await member.post("/auth/password", { currentPassword: "خطأ", newPassword: "BrandNew!9" });
  if (wrongCur.status === 400) ok("رفض تغيير كلمة المرور بكلمة حالية خاطئة");
  else no("رفض تغيير كلمة المرور بكلمة حالية خاطئة", `HTTP ${wrongCur.status}`);

  const same = await member.post("/auth/password", { currentPassword: P2, newPassword: P2 });
  if (same.status === 400) ok("رفض كلمة مرور جديدة مطابقة");
  else no("رفض كلمة مرور جديدة مطابقة", `HTTP ${same.status}`);

  const P2NEW = "MemberNew!2026";
  const ch = await member.post("/auth/password", { currentPassword: P2, newPassword: P2NEW });
  if (ch.status === 200 && ch.data.reauth === true) ok("تغيير كلمة المرور");
  else no("تغيير كلمة المرور", `${ch.status} ${ch.text?.slice(0, 140)}`);

  const revoked = await member.get("/auth/me");
  if (revoked.status === 401) ok("الجلسات أُبطلت بعد تغيير كلمة المرور");
  else no("الجلسات أُبطلت بعد تغيير كلمة المرور", `HTTP ${revoked.status}`);

  const relog = await member.login(MEMBER_U, P2NEW);
  if (relog.status === 200) ok("الدخول بكلمة المرور الجديدة");
  else no("الدخول بكلمة المرور الجديدة", `${relog.status}`);

  const oldPw = await member.login(MEMBER_U, P2);
  if (oldPw.status === 401) ok("كلمة المرور القديمة لم تعد تعمل");
  else no("كلمة المرور القديمة لم تعد تعمل", `HTTP ${oldPw.status}`);

  await member.login(MEMBER_U, P2NEW);

  // ═══ 16) الخروج ═══
  step("16) تسجيل الخروج");

  const out = await outsider.post("/auth/logout");
  if (out.status === 200) ok("تسجيل الخروج");
  else no("تسجيل الخروج", `${out.status}`);
  const afterOut = await outsider.get("/auth/me");
  if (afterOut.status === 401) ok("الجلسة مُبطلة بعد الخروج");
  else no("الجلسة مُبطلة بعد الخروج", `HTTP ${afterOut.status}`);

  // ═══ 17) الحماية من التخمين ═══
  step("17) قفل الحساب بعد محاولات فاشلة");

  const lockU = `lock_${S}`;
  const lockP = "LockMe!1234";
  // عميل منفصل حتى لا تُستبدل جلسة المالك
  const lockClient = makeClient();
  const lockReg = await lockClient.register(lockU, lockP, "حساب القفل");
  if (lockReg.status === 200) ok("تسجيل حساب القفل"); else no("تسجيل حساب القفل", `HTTP ${lockReg.status}`);

  let locked = false;
  const codes = [];
  for (let i = 1; i <= 9; i++) {
    const t = makeClient();
    await t.site("");
    const r = await t.post("/auth/login", { username: lockU, password: `wrong-${i}` });
    codes.push(r.status);
    if (r.status === 429) { locked = true; info(`قُفل الحساب عند المحاولة ${i} — ${codes.join(",")}`); break; }
  }
  if (locked) ok("قفل الحساب بعد محاولات فاشلة");
  else no("قفل الحساب بعد محاولات فاشلة", `الحالات: ${codes.join(",")}`);

  if (locked) {
    const goodButLocked = await makeClient().login(lockU, lockP).catch(() => null);
    if (goodButLocked?.status === 429) ok("منع الدخول حتى بكلمة صحيحة أثناء القفل");
    else if (goodButLocked) no("منع الدخول أثناء القفل", `HTTP ${goodButLocked.status}`);
  }

  // ═══ 18) إزالة عضو ═══
  step("18) إزالة عضو من البيئة");

  const outMe2 = await outsider.login(OUTSIDER_U, P3);
  const ownerRowId = (await owner.get("/members")).data.members.find((m) => m.username === OWNER_U)?.id;
  const removeOwner = ownerRowId ? await owner.del(`/members/${ownerRowId}`) : { status: -1, text: "لم يُعثر على صف العضو" };
  if (removeOwner.status === 403) ok("منع إزالة صاحب البيئة");
  else no("منع إزالة صاحب البيئة", `HTTP ${removeOwner.status} ${String(removeOwner.text || "").slice(0, 120)}`);

  const outMemberRow = (await owner.get("/members")).data.members.find((m) => m.username === OUTSIDER_U);
  if (!outMemberRow) no("العثور على صف العضو المُزال", "مفقود");
  const rm = outMemberRow ? await owner.del(`/members/${outMemberRow.id}`) : { status: -1, text: "لا صف" };
  if (rm.status === 200) ok("إزالة العضو من البيئة");
  else no("إزالة العضو من البيئة", `HTTP ${rm.status} ${String(rm.text || "").slice(0, 120)}`);
  await outsider.login(OUTSIDER_U, P3);
  const outWs = await outsider.get("/workspaces");
  const personal = outWs.data.workspaces.find((w) => w.name === "بيئة الغريب");
  if (personal && personal.role === "owner" && !outWs.data.workspaces.some((w) => w.id === wsId)) {
    ok("حساب الغريب بقي مستقلاً وبيئته الخاصة سليمة", personal.name);
  } else no("حساب الغريب بقي مستقلاً", JSON.stringify(outWs.data.workspaces.map((w) => w.name)));

  // ═══ 19) سجل النشاط ═══
  step("19) سجل النشاط");

  const act = await owner.get("/activity?limit=150");
  if (act.status === 200 && act.data.activity.length >= 15) ok("جلب سجل النشاط", `${act.data.activity.length} حدث`);
  else no("جلب سجل النشاط", `HTTP ${act.status} العدد=${act.data?.activity?.length} ${String(act.text || "").slice(0, 100)}`);

  const actions = new Set((act.data?.activity || []).map((a) => a.action));
  for (const a of ["register", "login", "member_invite", "invite_accept", "task_create", "todo_create"]) {
    if (actions.has(a)) ok(`تسجيل الحدث: ${a}`);
    else no(`تسجيل الحدث: ${a}`, "غير مسجّل");
  }
  if (!(act.data?.activity || []).some((a) => String(a.details).includes("pbkdf2") || String(a.details).includes(lockP))) {
    ok("عدم تسريب كلمات المرور في سجل النشاط");
  } else no("عدم تسريب كلمات المرور في سجل النشاط", "تسرّب!");

  // ═══ 20) حذف بيئة ═══
  step("20) حذف بيئة العمل");

  // مستخدم جديد لديه بيئة واحدة فقط ⇒ يُمنع من حذفها
  const solo = makeClient();
  const soloReg = await solo.register(`solo_${S}`, "SoloPass!1", "مستخدم وحيد", "البيئة الوحيدة");
  if (soloReg.status === 200) {
    const soloWsId = soloReg.data.workspace.id;
    const delSolo = await solo.del(`/workspaces/${soloWsId}`);
    if (delSolo.status === 400) ok("منع حذف البيئة الوحيدة");
    else no("منع حذف البيئة الوحيدة", `HTTP ${delSolo.status} ${String(delSolo.text || "").slice(0, 110)}`);

    // بعد إنشاء بيئة ثانية يصبح الحذف ممكناً
    const second = await solo.post("/workspaces", { name: "ثانية" });
    if (second.status === 200) {
      const delSolo2 = await solo.del(`/workspaces/${soloWsId}`);
      if (delSolo2.status === 200) ok("يُسمح بالحذف بعد وجود بيئة أخرى", `حُذفت ${delSolo2.data.deletedTasks} مهمة`);
      else no("يُسمح بالحذف بعد وجود بيئة أخرى", `HTTP ${delSolo2.status} ${String(delSolo2.text || "").slice(0, 110)}`);
    } else no("إنشاء بيئة ثانية لمستخدم واحد", `HTTP ${second.status}`);
  } else no("تسجيل المستخدم الوحيد", `HTTP ${soloReg.status}`);

  if (CLEAN && ownerWs2) {
    const delWs2 = await owner.del(`/workspaces/${ownerWs2}`);
    if (delWs2.status === 200) ok("حذف البيئة الثانية", `حُذفت ${delWs2.data.deletedTasks} مهمة`);
    else info(`تعذّر حذف البيئة الثانية (HTTP ${delWs2.status}) ${String(delWs2.text || "").slice(0, 100)}`);
  }

  // ═══ النتيجة ═══
  console.log(`\n${C.b("╔══════════════════════════════════════════════════════════════╗")}`);
  const total = pass + fail;
  console.log(C.b(`║   النتيجة: ${C.g(pass + " / " + total + " ناجح")}   ${fail ? C.r(fail + " فاشل") : C.d("0 فاشل")}${" ".repeat(Math.max(0, 34 - String(total).length - String(fail).length))}║`));
  console.log(C.b("╚══════════════════════════════════════════════════════════════╝"));
  if (fail) {
    console.log(C.r("\nالاختبارات الفاشلة:"));
    for (const f of failures) console.log("  • " + f);
  }
  console.log();
  process.exit(fail ? 1 : 0);
}

run().catch((e) => {
  console.error(C.r("\n✗ خطأ غير متوقع:\n" + (e?.stack || e)));
  process.exit(2);
});