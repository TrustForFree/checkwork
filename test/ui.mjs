// ═══════════════════════════════════════════════════════════
//  فحص تشغيل الواجهة فعلياً (jsdom) — يتأكد من عدم وجود أخطاء
//  في وقت التشغيل، ومن exhibURE دورة التسجيل ← الدخول ←
//  لوحة التحكم ← القوائم ← المهمات.
//
//  BASE=https://checkwork-buy.pages.dev node test/ui.mjs
// ═══════════════════════════════════════════════════════════

import { JSDOM, VirtualConsole } from "jsdom";

const BASE = (process.env.BASE || "http://localhost:8788").replace(/\/+$/, "");
const S = Date.now().toString(36);
const USER = `ui_${S}`;
const PASS = "UiTestPass!1";

let pass = 0, fail = 0;
const failures = [];
const C = {
  g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`,
  d: (s) => `\x1b[90m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`, c: (s) => `\x1b[36m${s}\x1b[0m`,
};
const ok = (n, x = "") => { pass++; console.log(`  ${C.g("✓")} ${n}${x ? C.d("  " + x) : ""}`); };
const no = (n, d = "") => { fail++; failures.push(n + " — " + d); console.log(`  ${C.r("✗")} ${n}\n      ${C.r(d)}`); };
const step = (n) => console.log(`\n${C.b(C.c("▌ " + n))}`);

const errors = [];

async function run() {
  console.log(C.b("\n╔══════════════════════════════════════════════════════════════╗"));
  console.log(C.b("║   CheckWork — فحص تشغيل الواجهة (jsdom)                       ║"));
  console.log(C.b("╚══════════════════════════════════════════════════════════════╝"));
  console.log(`  ${C.d(BASE)}`);

  // ── تحميل الصفحة الحقيقية ──
  step("1) تحميل الصفحة وتشغيل app.js");

  // نحاكي متصفحاً: نحفظ كوكيز استجابة المستند الأول
  const jar = new Map();
  const firstRes = await fetch(BASE + "/");
  for (const sc of firstRes.headers.getSetCookie?.() || []) {
    const [pair] = sc.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  const html = await firstRes.text();

  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push("jsdomError: " + (e.message || e)));
  vc.on("error", (...a) => errors.push("console.error: " + a.map(String).join(" ")));

  const dom = new JSDOM(html, {
    url: BASE + "/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    resources: undefined,      // نحمّل app.js يدوياً أدناه
  });

  const { window } = dom;

  // jsdom لا ينفّذ هذه الـ APIs
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.scrollTo = () => {};
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));

  const realFetch = globalThis.fetch.bind(globalThis);
  window.fetch = async (url, init = {}) => {
    const abs = String(url).startsWith("http") ? String(url) : BASE + url;
    const h = { ...(init.headers || {}) };
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (init.body && !h["content-type"]) h["content-type"] = "application/json";
    const res = await realFetch(abs, { ...init, headers: h });
    for (const sc of res.headers.getSetCookie?.() || []) {
      const [pair] = sc.split(";");
      const i = pair.indexOf("=");
      const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
      if (/max-age=0/i.test(sc)) jar.delete(k); else jar.set(k, v);
    }
    return res;
  };
  // نستعمل jar في الكوكيز المحلّية ليعمل التحقق المزدوج
  Object.defineProperty(window.document, "cookie", {
    get: () => [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
    configurable: true,
  });

  // تحميل app.js
  const appJs = await (await fetch(BASE + "/js/app.js")).text();
  // jsdom لا ينفّذ scripts من نوع module ⇒ نحمّلها كسكربت عادي
  if (/^\s*(import|export)\s/m.test(appJs)) throw new Error("app.js يحتوي صيغة ESM غير مدعومة هنا");
  const scriptEl = window.document.createElement("script");
  scriptEl.textContent = appJs;
  window.document.body.appendChild(scriptEl);

  await new Promise((r) => setTimeout(r, 900));

  const $ = (s) => window.document.querySelector(s);
  const $$ = (s) => [...window.document.querySelectorAll(s)];

  if (errors.length === 0) ok("app.js يُحمَّل دون أخطاء وقت التشغيل");
  else no("app.js يُحمَّل دون أخطاء وقت التشغيل", errors.slice(0, 3).join(" | "));

  // شاشة الدخول
  // شاشة التحميل تُزال تلقائياً بعد الإقلاع (سلوك صحيح)
  if ($("#splash") === null && $("#auth-page") && !$("#auth-page").hidden) ok("شاشة التحميل أُزيلت بعد الإقلاع");
  else no("شاشة التحميل", `splash=${!!$("#splash")} auth=${!$("#auth-page").hidden}`);

  // انتظار انتهاء الإقلاع
  for (let i = 0; i < 40 && $("#auth-page").hidden; i++) await new Promise((r) => setTimeout(r, 250));
  const authVisible = !$("#auth-page").hidden;
  if (authVisible) ok("شاشة الدخول/التسجيل ظهرت بعد الإقلاع");
  else no("شاشة الدخول/التسجيل ظهرت", `أخطاء: ${errors.slice(0, 2).join(" | ")}`);

  // ── التسجيل عبر النموذج ──
  step("2) التسجيل الذاتي عبر النموذج");

  const regTab = $("#tab-register");
  regTab.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  if (!$("#form-register").hidden) ok("التبديل إلى تبويب «حساب جديد»");
  else no("التبديل إلى تبويب «حساب جديد»", "النموذج مخفي");

  const rg = $("#form-register");
  if (!$("#rg-name")) throw new Error("نموذج التسجيل غير موجود");
  $("#rg-name").value = "مستخدم الواجهة";
  $("#rg-user").value = USER;
  $("#rg-pass").value = PASS;
  $("#rg-pass2").value = PASS;
  rg.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));

  for (let i = 0; i < 60 && $("#app").hidden; i++) await new Promise((r) => setTimeout(r, 250));
  if (!$("#app").hidden) {
    ok("التسجيل نجح وانتقل التطبيق إلى لوحة التحكم");
  } else {
    const alert = $("#form-register [data-error]");
    no("التسجيل نجح وانتقل التطبيق", `رسالة النموذج: ${alert && !alert.hidden ? alert.textContent : "(لا رسالة)"} | أخطاء: ${errors.slice(0, 2).join(" | ")}`);
  }

  // ── الواجهة بعد الدخول ──
  step("3) فحص عناصر الواجهة بعد الدخول");

  const wsName = $("#ws-name")?.textContent || "";
  if (wsName.trim()) ok("اسم بيئة العمل ظاهر في المبدّل", wsName);
  else no("اسم بيئة العمل ظاهر في المبدّل", "فارغ");

  const navItems = $$(".sb-item").map((b) => b.dataset.view);
  for (const v of ["dashboard", "tasks", "todos", "members", "reports"]) {
    if (navItems.includes(v)) ok(`عنصر تنقل: ${v}`);
    else no(`عنصر تنقل: ${v}`, `الموجود: ${navItems.join(", ")}`);
  }

  if ($("#btn-ws")) ok("زر مبدّل بيئات العمل موجود");
  else no("زر مبدّل بيئات العمل موجود", "مفقود");

  // لوحة التحكم
  for (let i = 0; i < 40 && !$$("#page-wrap .stat").length; i++) await new Promise((r) => setTimeout(r, 250));
  const statCount = $$("#page-wrap .stat").length;
  if (statCount >= 4) ok("لوحة التحكم عرضت بطاقات الإحصاء", `${statCount} بطاقة`);
  else no("لوحة التحكم عرضت بطاقات", `${statCount}`);

  // ── التنقل بين الصفحات ──
  step("4) التنقل بين صفحات التطبيق");

  for (const [view, marker] of [
    ["todos", ".todo, .empty"],
    ["members", ".task, .empty, .stat"],
    ["reports", ".stat"],
    ["settings", ".card"],
    ["activity", ".feed, .empty"],
    ["profile", ".card"],
  ]) {
    errors.length = 0;
    window.location.hash = "#/" + view;
    const btn = $$(".sb-item").find((b) => b.dataset.view === view);
    if (btn) btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    else window.history.replaceState(null, "", "#/" + view);

    await new Promise((r) => setTimeout(r, 1100));
    const wrap = $("#page-wrap");
    const hasContent = wrap.querySelector(marker.split(", ")[0]) !== null || $$(".skel").length === 0 && wrap.children.length > 0;
    const titleOk = $("#page-title").textContent.trim().length > 0;
    if (hasContent && titleOk && errors.length === 0) ok(`الصفحة «${view}» تُعرض بلا أخطاء`, $("#page-title").textContent);
    else no(`الصفحة «${view}» تُعرض`, `أخطاء: ${errors.slice(0, 2).join(" | ")}`);
  }

  // ── إنشاء عنصر TODO عبر الواجهة ──
  step("5) إنشاء قائمة TODO عبر نافذة منبثقة");

  errors.length = 0;
  const todoBtn = $$(".sb-item").find((b) => b.dataset.view === "todos");
  todoBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1200));

  // زر «عنصر جديد» داخل بطاقة القوائم
  const addBtn = $$("#page-wrap button").find((b) => b.textContent.includes("عنصر جديد"));
  if (addBtn) {
    addBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    if (!$("#modal-root").hidden) ok("نافذة «عنصر TODO جديد» فُتحت");
    else no("نافذة عنصر TODO فُتحت", "modal-root مخفي");

    const title = $("#td-title");
    if (title) {
      title.value = "عنصر من اختبار الواجهة";
      // اختيار «عامة»
      const sharedRadio = $$('input[name=visibility]').find((r) => r.value === "workspace");
      if (sharedRadio) sharedRadio.checked = true;
      const submit = $("#modal-foot [data-submit]");
      submit.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 1800));

      const list = $$("#page-wrap .todo").map((t) => t.textContent);
      if (list.some((x) => x.includes("عنصر من اختبار الواجهة"))) ok("العنصر ظهر في القائمة");
      else no("العنصر ظهر في القائمة", JSON.stringify(list).slice(0, 160));

      const vis = $$("#page-wrap .todo").some((t) => t.textContent.includes("مشتركة مع بيئة العمل"));
      if (vis) ok("التصنيف «مشتركة مع بيئة العمل» ظاهر");
      else no("التصنيف «مشتركة» ظاهر", "غير موجود");
    } else no("حقل عنوان العنصر موجود", "مفقود");
  } else no("زر «عنصر جديد» موجود", "مفقود");

  // ── إنشاء مهمة عبر الواجهة ──
  step("6) إنشاء مهمة عبر نافذة منبثقة");

  errors.length = 0;
  window.location.hash = "#/tasks";
  await new Promise((r) => setTimeout(r, 1400));
  const newTask = $$("#page-wrap button").find((b) => b.textContent.includes("مهمة جديدة"));
  if (newTask) {
    newTask.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    const t = $("#tf-title");
    if (t) {
      t.value = "مهمة من اختبار الواجهة";
      const d = $("#tf-desc");
      if (d) d.value = "وصف تفصيلي للمهمة";
      const sel = $("#tf-who");
      if (sel && sel.options.length) {
        sel.selectedIndex = 0;
        $$("#modal-foot [data-submit]")[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 2000));
        const cards = $$("#page-wrap .task-title").map((x) => x.textContent);
        if (cards.some((c) => c.includes("مهمة من اختبار الواجهة"))) ok("المهمة ظهرت في القائمة");
        else no("المهمة ظهرت في القائمة", JSON.stringify(cards).slice(0, 160));
      } else no("قائمة الموظفين في نموذج المهمة", "لا خيارات");
    } else no("حقل عنوان المهمة موجود", "مفقود");
  } else no("زر «مهمة جديدة» موجود", "مفقود");

  // ── نافذة التفاصيل ──
  step("7) فتح تفاصيل المهمة");

  errors.length = 0;
  const card = $$("#page-wrap .task").find((t) => t.textContent.includes("مهمة من اختبار الواجهة"));
  if (card) {
    card.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 1400));
    const modalTitle = $("#modal-title").textContent;
    const body = $("#modal-body").textContent;
    if ($("#modal-root").hidden === false && body.includes("مهمة من اختبار الواجهة")) ok("نافذة التفاصيل فُتحت وتعرض المهمة", modalTitle);
    else no("نافذة التفاصيل", `modal=${!$("#modal-root").hidden} body=${body.slice(0, 100)}`);

    if ($("#modal-body").querySelector(".timeline, .dl, .block")) ok("التفاصيل تحتوي بيانات المهمة");
    else no("التفاصيل تحتوي بيانات المهمة", "فارغة");

    // إغلاق
    $(".modal-head [data-close]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    if ($("#modal-root").hidden) ok("إغلاق النافذة يعمل");
    else no("إغلاق النافذة يعمل", "لم تُغلق");
  } else no("العثور على بطاقة المهمة", "غير موجودة");

  // ── الوضع الليلي ──
  step("8) تبديل المظهر (RTL) وقائمة بيئات العمل");

  const before = window.document.documentElement.getAttribute("data-theme");
  $("#btn-theme").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const after = window.document.documentElement.getAttribute("data-theme");
  if (before !== after) ok("تبديل المظهر يعمل", `${before} → ${after}`);
  else no("تبديل المظهر", "لم يتغير");

  $("#btn-ws").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  const wsItems = $$("#ws-menu .ws-item").length;
  if (wsItems >= 2) ok("قائمة بيئات العمل تُعرض", `${wsItems} عنصر`);
  else no("قائمة بيئات العمل تُعرض", `${wsItems} عنصر`);

  // ── تسجيل الخروج ──
  step("9) تسجيل الخروج");

  errors.length = 0;
  $("#btn-logout").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 500));
  if (!$("#modal-root").hidden) {
    const yes = $$("#modal-foot [data-act]").find((b) => b.dataset.act === "yes");
    if (yes) yes.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

    // إعادة تحميل الصفحة لا تعمل في jsdom ⇒ نتحقق من إبطال الجلسة عبر الـ API
    let me = null;
    for (let i = 0; i < 20; i++) {
      me = await realFetch(BASE + "/api/auth/me", { headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } });
      if (me.status === 401) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (me?.status === 401) ok("الجلسة أُبطلت بعد تسجيل الخروج");
    else no("الجلسة أُبطلت بعد تسجيل الخروج", `HTTP ${me?.status} | كوكي: ${[...jar.keys()].join(",")}`);
  } else no("نافذة تأكيد الخروج", "مخفية");

  // ── النتيجة ──
  console.log(`\n${C.b("╔══════════════════════════════════════════════════════════════╗")}`);
  const total = pass + fail;
  console.log(C.b(`║   النتيجة: ${C.g(pass + " / " + total + " ناجح")}   ${fail ? C.r(fail + " فاشل") : C.d("0 فاشل")}${" ".repeat(Math.max(0, 34 - String(total).length - String(fail).length))}║`));
  console.log(C.b("╚══════════════════════════════════════════════════════════════╝"));
  if (fail) {
    console.log(C.r("\nالفاشلة:"));
    for (const f of failures) console.log("  • " + f);
  }
  const realErrors = errors.filter((e) => !/Not implemented|Could not parse CSS/i.test(e));
  if (realErrors.length) console.log(C.r("\nأخطاء وقت التشغيل المتبقية:\n" + realErrors.slice(0, 10).join("\n")));
  console.log();
  process.exit(fail || realErrors.length ? 1 : 0);
}

run().catch((e) => {
  console.error(C.r("\n✗ خطأ: " + (e?.stack || e)));
  process.exit(2);
});