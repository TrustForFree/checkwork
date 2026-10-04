// ==========================================================
//  api.js — واجهة البرمجة التطبيقات
//  CheckWork: تسجيل ذاتي + بيئات عمل + مهمات + قوائم TODO
// ==========================================================

import {
  readJson, HttpError, nowIso, normUsername, cleanText, normPassword,
  normPriority, normStatus, normDate, toInt, isOverdue, fmtDate, csvEscape,
} from "./util.js";
import {
  hashPassword, verifyPassword, generatePassword, PBKDF2_ITERATIONS,
  createSession, revokeSession, revokeAllSessions,
  readCookie, verifyJwt, cookieHeader, isAdmin, isOwner,
} from "./auth.js";
import { logActivity, publicUser, publicWorkspace, publicTask, publicTodo } from "./db.js";

const todayStr = () => new Date().toISOString().slice(0, 10);
const sp = (req) => new URL(req.url).searchParams;
const randomHex = (bytes) => {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
};

// ══════════════════════════════════════════════════════════
//  جدول المسارات:  route(method, path, [guard,] handler)
// ══════════════════════════════════════════════════════════

const routes = [];

function route(method, pattern, ...fns) {
  const guard = fns.length > 1 ? fns[0] : null;
  const handler = fns[fns.length - 1];
  const keys = [];
  const regex = new RegExp(
    "^" + pattern.split("/").map((seg) => {
      if (seg.startsWith(":")) { keys.push(seg.slice(1)); return "/([^/]+)"; }
      return seg ? "/" + seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
    }).join("") + "/?$"
  );
  routes.push({ method, regex, keys, guard, handler });
}

// ══════════════════════════════════════════════════════════
//  الصحة والتسجيل والدخول
// ══════════════════════════════════════════════════════════

route("GET", "/api/health", async (ctx) => {
  let dbOk = false, users = 0, workspaces = 0;
  try {
    const r = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
    const w = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM workspaces").first();
    dbOk = true; users = r.n; workspaces = w.n;
  } catch { dbOk = false; }
  return {
    ok: dbOk, service: "checkwork", version: "2.0.0", db: dbOk,
    users, workspaces, time: nowIso(),
  };
});

/** التسجيل الذاتي — كل مستخدم يُنشئ بيئته الخاصة تلقائياً */
route("POST", "/api/auth/register", async (ctx) => {
  const b = await readJson(ctx.req);
  const username = normUsername(b.username);
  const password = normPassword(b.password, { min: 6 });
  const fullName = cleanText(b.fullName, { min: 2, max: 80, field: "الاسم الكامل", required: true });

  if (await ctx.env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first()) {
    throw new HttpError(409, "اسم المستخدم محجوز، اختر اسماً آخر");
  }

  // لا نكشف إن كان الاسم مستخدماً مسبقاً بشكل مختلف — الخطأ موحّد
  const wsName = cleanText(b.workspaceName, { max: 80, field: "اسم بيئة العمل" }) || `بيئة ${fullName.split(/\s+/)[0]}`;
  const wsTagline = cleanText(b.workspaceTagline, { max: 120, field: "وصف بيئة العمل" });
  const now = nowIso();
  const color = pickColor(username);

  // إنشاء المستخدم وبيئته الخاصة في معاملة واحدة (D1 batch)
  const slug = "ws-" + randomHex(6);
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `INSERT INTO users (username, password_hash, full_name, job_title, phone, email,
                          avatar_color, is_active, must_change_password, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
    ).bind(
      username, await hashPassword(password), fullName,
      cleanText(b.jobTitle, { max: 80, field: "المسمى الوظيفي" }),
      cleanText(b.phone, { max: 30, field: "الهاتف" }),
      cleanText(b.email, { max: 120, field: "البريد" }),
      color, now, now
    ),
    ctx.env.DB.prepare(
      `INSERT INTO workspaces (slug, name, tagline, owner_id, avatar_color, is_personal, created_at, updated_at)
       VALUES (?, ?, ?, (SELECT id FROM users WHERE username = ?), ?, 1, ?, ?)`
    ).bind(slug, wsName, wsTagline, username, color, now, now),
    ctx.env.DB.prepare(
      `INSERT INTO members (workspace_id, user_id, role, status, invited_by, invited_at, approved_at)
       VALUES ((SELECT id FROM workspaces WHERE slug = ?),
               (SELECT id FROM users WHERE username = ?),
               'owner', 'active',
               (SELECT id FROM users WHERE username = ?), ?, ?)`
    ).bind(slug, username, username, now, now),
  ]);

  const user = await ctx.env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
  const userId = { id: user.id, workspaceId: (await ctx.env.DB.prepare("SELECT id FROM workspaces WHERE slug = ?").bind(slug).first()).id };
  await logActivity(ctx.env, {
    workspaceId: userId.workspaceId, entity: "user", entityId: user.id, actorId: user.id,
    action: "register", details: `تسجيل حساب جديد ${username}`,
  });

  const { token, expiresAt, maxAge } = await createSession(ctx.env, user, ctx.req, userId.workspaceId);
  ctx.setSessionCookie(token, { maxAge, expires: expiresAt });

  return {
    ok: true,
    user: publicUser(user),
    workspace: { id: userId.workspaceId, name: wsName, role: "owner" },
  };
});

route("POST", "/api/auth/login", async (ctx) => {
  const b = await readJson(ctx.req);
  const username = String(b.username ?? "").trim().toLowerCase();
  const password = String(b.password ?? "");
  if (!username || !password) throw new HttpError(400, "أدخل اسم المستخدم وكلمة المرور");

  const maxAttempts = Number(ctx.env.LOGIN_MAX_ATTEMPTS || 6);
  const lockMinutes = Number(ctx.env.LOGIN_LOCK_MINUTES || 10);
  const invalid = () => new HttpError(401, "اسم المستخدم أو كلمة المرور غير صحيحة");

  const user = await ctx.env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();

  if (!user) {
    await verifyPassword(password, `pbkdf2$${PBKDF2_ITERATIONS}$${randomHex(16)}$${randomHex(32)}`);
    throw invalid();
  }
  if (user.locked_until && !isPast(user.locked_until)) {
    const mins = Math.max(1, Math.ceil((Date.parse(user.locked_until + "Z") - Date.now()) / 60000));
    throw new HttpError(429, `الحساب مقفل مؤقتاً. أعد المحاولة بعد ${mins} دقيقة`);
  }
  if (!user.is_active) throw new HttpError(403, "الحساب غير مُفعّل. راجع مالك بيئة العمل");

  if (!(await verifyPassword(password, user.password_hash))) {
    const attempts = user.failed_attempts + 1;
    const lock = attempts >= maxAttempts ? sqlTime(Date.now() + lockMinutes * 60000) : null;
    await ctx.env.DB.prepare(
      "UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?"
    ).bind(lock ? 0 : attempts, lock, user.id).run();
    await logActivity(ctx.env, { entity: "auth", actorId: user.id, action: "login_failed", details: `محاولة فاشلة لـ ${username}` });
    throw invalid();
  }

  await ctx.env.DB.prepare(
    "UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?"
  ).bind(user.id).run();

  //Pick the best default workspace: personal (own) first, then most recent active
  const ws = await ctx.env.DB.prepare(
    `SELECT m.workspace_id FROM members m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = ? AND m.status = 'active'
      ORDER BY CASE WHEN w.owner_id = m.user_id THEN 0 ELSE 1 END, m.approved_at DESC LIMIT 1`
  ).bind(user.id).first();

  const { token, expiresAt, maxAge } = await createSession(ctx.env, user, ctx.req, ws?.workspace_id ?? null);
  ctx.setSessionCookie(token, { maxAge, expires: expiresAt });
  await logActivity(ctx.env, { entity: "auth", actorId: user.id, action: "login", details: "تسجيل دخول ناجح" });

  const fresh = await ctx.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first();
  return { ok: true, user: publicUser(fresh), workspaceId: ws?.workspace_id ?? null };
});

route("POST", "/api/auth/logout", async (ctx) => {
  const raw = readCookie(ctx.req) || (ctx.req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (raw) {
    const p = await verifyJwt(raw, ctx.env.SESSION_SECRET);
    if (p?.sid) await revokeSession(ctx.env, p.sid);
  }
  ctx.clearSessionCookie();
  return { ok: true };
});

route("GET", "/api/auth/me", needAuth, async (ctx) => ({
  ok: true,
  user: publicUser(ctx.user),
  workspace: publicWorkspace(ctx.user.workspace),
  membership: ctx.user.membership,
  isAdmin: isAdmin(ctx.user),
  isOwner: isOwner(ctx.user),
  badges: await badgesOf(ctx.env, ctx.user),
  invites: await pendingInviteCount(ctx.env, ctx.user.id),
}));

route("POST", "/api/auth/password", needAuth, async (ctx) => {
  const b = await readJson(ctx.req);
  const current = String(b.currentPassword ?? "");
  const next = normPassword(b.newPassword, { min: 6 });

  const row = await ctx.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(ctx.user.id).first();
  if (!(await verifyPassword(current, row.password_hash))) throw new HttpError(400, "كلمة المرور الحالية غير صحيحة");
  if (current === next) throw new HttpError(400, "كلمة المرور الجديدة مطابقة للحالية");

  await ctx.env.DB.prepare(
    `UPDATE users SET password_hash = ?, must_change_password = 0,
            token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?`
  ).bind(await hashPassword(next), ctx.user.id).run();

  await revokeAllSessions(ctx.env, ctx.user.id);
  await logActivity(ctx.env, {
    workspaceId: ctx.user.wid, entity: "user", entityId: ctx.user.id,
    actorId: ctx.user.id, action: "password_change", details: "تغيير كلمة المرور",
  });
  return { ok: true, reauth: true };
});

route("PATCH", "/api/auth/profile", needAuth, async (ctx) => {
  const b = await readJson(ctx.req);
  const fullName = cleanText(b.fullName, { min: 2, max: 80, field: "الاسم الكامل", required: true });
  await ctx.env.DB.prepare(
    `UPDATE users SET full_name = ?, job_title = ?, phone = ?, email = ?, bio = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).bind(
    fullName,
    cleanText(b.jobTitle, { max: 80, field: "المسمى الوظيفي" }),
    cleanText(b.phone, { max: 30, field: "الهاتف" }),
    cleanText(b.email, { max: 120, field: "البريد" }),
    cleanText(b.bio, { max: 300, field: "نبذة" }),
    ctx.user.id
  ).run();

  const fresh = await ctx.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(ctx.user.id).first();
  return { ok: true, user: publicUser(fresh) };
});

route("GET", "/api/auth/sessions", needAuth, async (ctx) => {
  const { results } = await ctx.env.DB.prepare(
    `SELECT id, user_agent, ip, created_at, expires_at, revoked_at
       FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
  ).bind(ctx.user.id).all();
  return {
    ok: true,
    sessions: results.map((s) => ({
      id: s.id, userAgent: s.user_agent, ip: s.ip, createdAt: s.created_at,
      expiresAt: s.expires_at, revokedAt: s.revoked_at, current: s.id === ctx.user.sid,
    })),
  };
});

/** فحص توفّر اسم المستخدم أثناء التسجيل */
route("GET", "/api/auth/check-username", async (ctx) => {
  const username = normUsername(sp(ctx.req).get("username") || "");
  const found = await ctx.env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  return { ok: true, available: !found };
});

// ══════════════════════════════════════════════════════════
//  بيئات العمل
// ══════════════════════════════════════════════════════════

route("GET", "/api/workspaces", needAuth, async (ctx) => {
  const { results } = await ctx.env.DB.prepare(
    `SELECT w.*, m.role, m.status,
            (SELECT COUNT(*) FROM members mm WHERE mm.workspace_id = w.id AND mm.status='active') AS member_count,
            (SELECT COUNT(*) FROM members mm WHERE mm.workspace_id = w.id AND mm.status='pending') AS pending_count,
            (SELECT COUNT(*) FROM todos t WHERE t.workspace_id = w.id AND t.visibility='workspace' AND t.owner_id != ? AND t.done = 0) AS shared_todos
       FROM members m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = ? AND m.status = 'active'
      ORDER BY CASE WHEN w.owner_id = m.user_id THEN 0 ELSE 1 END, m.approved_at DESC`
  ).bind(ctx.user.id, ctx.user.id).all();

  return {
    ok: true,
    workspaces: results.map((r) => ({ ...publicWorkspace(r), sharedTodos: r.shared_todos })),
  };
});

route("POST", "/api/workspaces", needAuth, async (ctx) => {
  const b = await readJson(ctx.req);
  const name = cleanText(b.name, { min: 2, max: 80, field: "اسم بيئة العمل", required: true });
  const tagline = cleanText(b.tagline, { max: 120, field: "الوصف" });
  const now = nowIso();
  const color = pickColor(name + Date.now());

  const slug = "ws-" + randomHex(6);
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      `INSERT INTO workspaces (slug, name, tagline, owner_id, avatar_color, is_personal, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    ).bind(slug, name, tagline, ctx.user.id, color, now, now),
    ctx.env.DB.prepare(
      `INSERT INTO members (workspace_id, user_id, role, status, invited_by, invited_at, approved_at)
       VALUES ((SELECT id FROM workspaces WHERE slug = ?), ?, 'owner', 'active', ?, ?, ?)`
    ).bind(slug, ctx.user.id, ctx.user.id, now, now),
  ]);
  const wsId = (await ctx.env.DB.prepare("SELECT id FROM workspaces WHERE slug = ?").bind(slug).first()).id;

  await logActivity(ctx.env, {
    workspaceId: wsId, entity: "workspace", entityId: wsId, actorId: ctx.user.id,
    action: "workspace_create", details: `إنشاء بيئة عمل «${name}»`,
  });

  // تبديل الجلسة إلى البيئة الجديدة
  await ctx.switchWorkspace(wsId);

  const ws = await ctx.env.DB.prepare("SELECT * FROM workspaces WHERE id = ?").bind(wsId).first();
  return { ok: true, workspace: { ...publicWorkspace(ws), role: "owner" } };
});

route("PATCH", "/api/workspaces/:id", needAdmin, async (ctx) => {
  const id = toInt(ctx.params.id, "بيئة العمل", { max: 1e9 });
  const ws = await ctx.env.DB.prepare("SELECT * FROM workspaces WHERE id = ?").bind(id).first();
  if (!ws) throw new HttpError(404, "بيئة العمل غير موجودة");

  const b = await readJson(ctx.req);
  const sets = [], vals = [];
  if (b.name !== undefined) { sets.push("name = ?"); vals.push(cleanText(b.name, { min: 2, max: 80, field: "الاسم", required: true })); }
  if (b.tagline !== undefined) { sets.push("tagline = ?"); vals.push(cleanText(b.tagline, { max: 120, field: "الوصف" })); }
  if (b.taskDueDays !== undefined) { sets.push("task_due_days = ?"); vals.push(toInt(b.taskDueDays, "المهلة", { min: 1, max: 365 })); }
  if (b.avatarColor !== undefined) { sets.push("avatar_color = ?"); vals.push(/^#[0-9a-fA-F]{6}$/.test(b.avatarColor) ? b.avatarColor : ws.avatar_color); }
  if (!sets.length) throw new HttpError(400, "لا توجد تغييرات");

  sets.push("updated_at = datetime('now')");
  await ctx.env.DB.prepare(`UPDATE workspaces SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
  await logActivity(ctx.env, { workspaceId: id, entity: "workspace", entityId: id, actorId: ctx.user.id, action: "workspace_update", details: "تعديل بيانات بيئة العمل" });

  const fresh = await ctx.env.DB.prepare("SELECT * FROM workspaces WHERE id = ?").bind(id).first();
  return { ok: true, workspace: publicWorkspace(fresh) };
});

route("POST", "/api/workspaces/:id/switch", needAuth, async (ctx) => {
  const id = toInt(ctx.params.id, "بيئة العمل", { max: 1e9 });
  const m = await ctx.env.DB.prepare(
    "SELECT status FROM members WHERE workspace_id = ? AND user_id = ?"
  ).bind(id, ctx.user.id).first();
  if (!m) throw new HttpError(403, "لست عضواً في هذه البيئة");
  if (m.status !== "active") throw new HttpError(403, "لم توافق على دعوة هذه البيئة بعد");

  await ctx.switchWorkspace(id);
  const ws = await ctx.env.DB.prepare("SELECT * FROM workspaces WHERE id = ?").bind(id).first();
  return { ok: true, workspace: publicWorkspace(ws) };
});

route("DELETE", "/api/workspaces/:id", needOwner, async (ctx) => {
  const id = toInt(ctx.params.id, "بيئة العمل", { max: 1e9 });
  const ws = await ctx.env.DB.prepare("SELECT * FROM workspaces WHERE id = ?").bind(id).first();
  if (!ws) throw new HttpError(404, "بيئة العمل غير موجودة");

  const { n } = await ctx.env.DB.prepare("SELECT COUNT(*) AS n FROM workspaces WHERE owner_id = ?").bind(ctx.user.id).first();
  if (n <= 1) throw new HttpError(400, "لا يمكنك حذف بيئتك الوحيدة. احذف حسابك بدل ذلك");

  const { t } = await ctx.env.DB.prepare("SELECT COUNT(*) AS t FROM tasks WHERE workspace_id = ?").bind(id).first();
  await ctx.env.DB.prepare("DELETE FROM workspaces WHERE id = ?").bind(id).run();
  await logActivity(ctx.env, { entity: "workspace", entityId: id, actorId: ctx.user.id, action: "workspace_delete", details: `حذف بيئة «${ws.name}» (${t} مهمة)` });
  return { ok: true, deletedTasks: t };
});

// ══════════════════════════════════════════════════════════
//  الأعضاء والدعوات
// ══════════════════════════════════════════════════════════

route("GET", "/api/members", needAuth, async (ctx) => {
  const { results } = await ctx.env.DB.prepare(
    `SELECT m.id, m.role, m.status, m.job_title, m.invited_at, m.approved_at,
            u.id AS user_id, u.username, u.full_name, u.job_title, u.avatar_color,
            u.is_active, u.last_login_at, u.bio,
            inv.full_name AS inviter_name,
            (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.workspace_id = m.workspace_id) AS total_c,
            (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.workspace_id = m.workspace_id AND t.status='new') AS new_c,
            (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.workspace_id = m.workspace_id AND t.status='done') AS done_c,
            (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id AND t.workspace_id = m.workspace_id
                AND t.due_date IS NOT NULL AND t.due_date < date('now')
                AND t.status NOT IN ('done','cancelled')) AS overdue_c
       FROM members m JOIN users u ON u.id = m.user_id
       LEFT JOIN users inv ON inv.id = m.invited_by
      WHERE m.workspace_id = ?
      ORDER BY (m.status='pending') DESC,
               CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
               u.full_name COLLATE NOCASE`
  ).bind(ctx.user.wid).all();

  return {
    ok: true,
    members: results.map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: r.username,
      fullName: r.full_name,
      jobTitle: r.job_title || r.member_title || "",
      avatarColor: r.avatar_color || "#4f7cff",
      bio: r.bio || "",
      role: r.role,
      status: r.status,
      isActive: !!r.is_active,
      invitedBy: r.inviter_name || null,
      invitedAt: r.invited_at,
      approvedAt: r.approved_at,
      lastLoginAt: r.last_login_at,
      hasLoggedIn: !!r.last_login_at,
      totalTasks: r.total_c,
      newTasks: r.new_c,
      doneTasks: r.done_c,
      overdueTasks: r.overdue_c,
      openTasks: r.total_c - r.done_c,
      completionRate: r.total_c ? Math.round((r.done_c / r.total_c) * 100) : 0,
    })),
  };
});

/** إضافة عضو عبر اسم المستخدم → دعوة تنتظر موافقته */
route("POST", "/api/members", needAdmin, async (ctx) => {
  const b = await readJson(ctx.req);
  const username = normUsername(b.username);
  const role = ["admin", "member"].includes(b.role) ? b.role : "member";

  if (role === "admin" && !isOwner(ctx.user)) {
    throw new HttpError(403, "ترقية الأعضاء إلى مشرف متاحة لصاحب بيئة العمل فقط");
  }

  const target = await ctx.env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
  if (!target) throw new HttpError(404, "لا يوجد حساب بهذا اسم المستخدم. يجب أن يسجّل أولاً ثم تقبل دعوته");
  if (!target.is_active) throw new HttpError(400, "هذا الحساب غير مُفعّل");
  if (target.id === ctx.user.id) throw new HttpError(400, "أنت عضو في هذه البيئة بالفعل");

  const existing = await ctx.env.DB.prepare(
    "SELECT id, status FROM members WHERE workspace_id = ? AND user_id = ?"
  ).bind(ctx.user.wid, target.id).first();

  if (existing?.status === "active") throw new HttpError(409, `${target.full_name} عضو بالفعل في هذه البيئة`);
  if (existing?.status === "pending") throw new HttpError(409, "الدعوة مُرسلة بالفعل وبانتظار موافقة المستخدم");

  const ws = ctx.user.workspace;
  const now = nowIso();

  if (existing) {
    await ctx.env.DB.prepare(
      "UPDATE members SET status='pending', role=?, invited_by=?, invited_at=?, approved_at=NULL, job_title=? WHERE id=?"
    ).bind(role, ctx.user.id, now, cleanText(b.jobTitle, { max: 80, field: "المسمى" }), existing.id).run();
  } else {
    await ctx.env.DB.prepare(
      `INSERT INTO members (workspace_id, user_id, role, status, job_title, invited_by, invited_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?)`
    ).bind(ctx.user.wid, target.id, role, cleanText(b.jobTitle, { max: 80, field: "المسمى" }), ctx.user.id, now).run();
  }

  await logActivity(ctx.env, {
    workspaceId: ctx.user.wid, entity: "member", entityId: target.id, actorId: ctx.user.id,
    action: "member_invite", details: `دعوة ${target.full_name} (${username}) بصفته ${role === "admin" ? "مشرف" : "موظف"}`,
  });

  return {
    ok: true,
    pending: true,
    member: { userId: target.id, username: target.username, fullName: target.full_name, role, status: "pending" },
    message: `أُرسلت الدعوة إلى ${target.full_name} — عليه قبولها من حسابه`,
  };
});

/** الدعوات الواردة إليّ */
route("GET", "/api/invites", needAuth, async (ctx) => {
  const { results } = await ctx.env.DB.prepare(
    `SELECT m.id, m.role, m.invited_at, m.job_title,
            w.id AS workspace_id, w.name AS workspace_name, w.tagline, w.avatar_color AS ws_color,
            inv.full_name AS inviter_name, inv.username AS inviter_username, inv.avatar_color AS inviter_color,
            (SELECT COUNT(*) FROM members mm WHERE mm.workspace_id = w.id AND mm.status='active') AS active_members
       FROM members m
       JOIN workspaces w ON w.id = m.workspace_id
       LEFT JOIN users inv ON inv.id = m.invited_by
      WHERE m.user_id = ? AND m.status = 'pending'
      ORDER BY m.invited_at DESC`
  ).bind(ctx.user.id).all();

  return {
    ok: true,
    invites: results.map((r) => ({
      id: r.id,
      role: r.role,
      invitedAt: r.invited_at,
      jobTitle: r.job_title || "",
      workspace: {
        id: r.workspace_id, name: r.workspace_name, tagline: r.tagline,
        avatarColor: r.ws_color, memberCount: r.active_members,
      },
      inviter: { fullName: r.inviter_name || "مشرف", username: r.inviter_username, avatarColor: r.inviter_color || "#4f7cff" },
    })),
  };
});

route("POST", "/api/invites/:id/accept", needAuth, async (ctx) => {
  const id = toInt(ctx.params.id, "الدعوة", { max: 1e9 });
  const inv = await ctx.env.DB.prepare(
    `SELECT m.*, w.name AS ws_name FROM members m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.id = ? AND m.user_id = ? AND m.status = 'pending'`
  ).bind(id, ctx.user.id).first();
  if (!inv) throw new HttpError(404, "الدعوة غير موجودة أو تمت معالجتها");

  const now = nowIso();
  await ctx.env.DB.prepare("UPDATE members SET status='active', approved_at=? WHERE id=?").bind(now, id).run();
  await logActivity(ctx.env, {
    workspaceId: inv.workspace_id, entity: "member", entityId: ctx.user.id, actorId: ctx.user.id,
    action: "invite_accept", details: `${ctx.user.full_name} قبل الدعوة إلى «${inv.ws_name}»`,
  });
  await ctx.switchWorkspace(inv.workspace_id);

  const ws = await ctx.env.DB.prepare("SELECT * FROM workspaces WHERE id = ?").bind(inv.workspace_id).first();
  return { ok: true, workspace: publicWorkspace(ws), role: inv.role };
});

route("POST", "/api/invites/:id/decline", needAuth, async (ctx) => {
  const id = toInt(ctx.params.id, "الدعوة", { max: 1e9 });
  const inv = await ctx.env.DB.prepare(
    `SELECT m.*, w.name AS ws_name FROM members m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.id = ? AND m.user_id = ? AND m.status = 'pending'`
  ).bind(id, ctx.user.id).first();
  if (!inv) throw new HttpError(404, "الدعوة غير موجودة أو تمت معالجتها");

  await ctx.env.DB.prepare("UPDATE members SET status='declined' WHERE id = ?").bind(id).run();
  await logActivity(ctx.env, {
    workspaceId: inv.workspace_id, entity: "member", entityId: ctx.user.id, actorId: ctx.user.id,
    action: "invite_decline", details: `${ctx.user.full_name} رفض الدعوة إلى «${inv.ws_name}»`,
  });
  return { ok: true };
});

route("PATCH", "/api/members/:id", needAdmin, async (ctx) => {
  const id = toInt(ctx.params.id, "العضو", { max: 1e9 });
  const m = await ctx.env.DB.prepare("SELECT * FROM members WHERE id = ? AND workspace_id = ?").bind(id, ctx.user.wid).first();
  if (!m) throw new HttpError(404, "العضو غير موجود");
  if (m.role === "owner") throw new HttpError(403, "لا يمكن تعديل صلاحيات صاحب بيئة العمل");

  const b = await readJson(ctx.req);
  const sets = [], vals = [];

  if (b.role !== undefined) {
    const role = ["admin", "member"].includes(b.role) ? b.role : null;
    if (!role) throw new HttpError(400, "الرتبة غير صحيحة");
    if (role === "admin" && !isOwner(ctx.user)) throw new HttpError(403, "الترقية للمشرف متاحة لصاحب البيئة فقط");
    sets.push("role = ?"); vals.push(role);
  }
  if (b.jobTitle !== undefined) { sets.push("job_title = ?"); vals.push(cleanText(b.jobTitle, { max: 80, field: "المسمى" })); }
  if (!sets.length) throw new HttpError(400, "لا توجد تغييرات");

  sets.push("approved_at = datetime('now')");
  await ctx.env.DB.prepare(`UPDATE members SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();
  await logActivity(ctx.env, {
    workspaceId: ctx.user.wid, entity: "member", entityId: m.user_id, actorId: ctx.user.id,
    action: "member_update", details: `تعديل صلاحيات العضو #${m.user_id}`,
  });
  return { ok: true };
});

route("DELETE", "/api/members/:id", needAdmin, async (ctx) => {
  const id = toInt(ctx.params.id, "العضو", { max: 1e9 });
  const m = await ctx.env.DB.prepare(
    `SELECT m.*, u.full_name FROM members m JOIN users u ON u.id = m.user_id
      WHERE m.id = ? AND m.workspace_id = ?`
  ).bind(id, ctx.user.wid).first();
  if (!m) throw new HttpError(404, "العضو غير موجود");
  if (m.role === "owner") throw new HttpError(403, "لا يمكن إزالة صاحب بيئة العمل");

  // إيقاف العضو فقط: ننقله خارج البيئة مع الاحتفاظ بسجلاته
  const { t } = await ctx.env.DB.prepare("SELECT COUNT(*) AS t FROM tasks WHERE workspace_id = ? AND assignee_id = ?").bind(ctx.user.wid, m.user_id).first();

  if ((ctx.req.headers.get("x-keep-tasks") || "") === "1") {
    await ctx.env.DB.prepare("UPDATE tasks SET assignee_id = ? WHERE workspace_id = ? AND assignee_id = ?")
      .bind(ctx.user.id, ctx.user.wid, m.user_id).run();
  }

  await ctx.env.DB.prepare("DELETE FROM members WHERE id = ?").bind(id).run();
  await logActivity(ctx.env, {
    workspaceId: ctx.user.wid, entity: "member", entityId: m.user_id, actorId: ctx.user.id,
    action: "member_remove", details: `إزالة ${m.full_name} من بيئة العمل`,
  });
  return { ok: true, reassignedTasks: t };
});

// ══════════════════════════════════════════════════════════
//  المهمات
// ══════════════════════════════════════════════════════════

const TASK_SELECT = `
  SELECT t.*, a.full_name AS assignee_name, a.job_title AS assignee_title,
         c.full_name AS creator_name
    FROM tasks t
    JOIN users a ON a.id = t.assignee_id
    JOIN users c ON c.id = t.created_by`;

route("GET", "/api/tasks", needMember, async (ctx) => {
  const q = sp(ctx.req);
  const where = ["t.workspace_id = ?"];
  const vals = [ctx.user.wid];

  const scope = q.get("scope") || (isAdmin(ctx.user) ? "all" : "mine");
  if (scope === "mine" || scope === "assigned_to_me") { where.push("t.assignee_id = ?"); vals.push(ctx.user.id); }
  else if (scope === "created_by_me") { where.push("t.created_by = ?"); vals.push(ctx.user.id); }
  // scope=all متاح للمشرفين فقط؛ غير المشرف محصور بمهامه

  if (q.get("assigneeId")) { where.push("t.assignee_id = ?"); vals.push(toInt(q.get("assigneeId"), "العضو")); }
  if (q.get("status") && q.get("status") !== "all") { where.push("t.status = ?"); vals.push(normStatus(q.get("status"))); }
  if (q.get("priority") && q.get("priority") !== "all") { where.push("t.priority = ?"); vals.push(normPriority(q.get("priority"))); }

  const search = (q.get("q") || "").trim().slice(0, 80);
  if (search) {
    where.push("(t.title LIKE ? OR t.description LIKE ? OR t.result_note LIKE ? OR t.manager_note LIKE ? OR a.full_name LIKE ?)");
    const like = `%${search}%`;
    vals.push(like, like, like, like, like);
  }

  const when = q.get("when");
  if (when === "overdue") where.push("t.due_date IS NOT NULL AND t.due_date < date('now') AND t.status NOT IN ('done','cancelled')");
  else if (when === "today") where.push("t.due_date = date('now') AND t.status NOT IN ('done','cancelled')");
  else if (when === "week") where.push("t.due_date BETWEEN date('now') AND date('now','+7 day') AND t.status NOT IN ('done','cancelled')");
  else if (when === "month") where.push("t.assigned_at >= date('now','-30 day')");

  const orderBy = {
    newest:   "t.assigned_at DESC, t.id DESC",
    oldest:   "t.assigned_at ASC, t.id ASC",
    due:      "CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date ASC, t.id DESC",
    priority: "CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.assigned_at DESC",
    title:    "t.title COLLATE NOCASE ASC",
  }[q.get("sort")] || "t.assigned_at DESC, t.id DESC";

  const limit = toInt(q.get("limit"), "الحد", { def: 300, min: 1, max: 500 });
  const offset = toInt(q.get("offset"), "الإزاحة", { def: 0, min: 0, max: 100000 });

  const whereSql = "WHERE " + where.join(" AND ");
  const { results } = await ctx.env.DB.prepare(
    `${TASK_SELECT} ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  ).bind(...vals, limit, offset).all();

  const { n } = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM tasks t JOIN users a ON a.id = t.assignee_id ${whereSql}`
  ).bind(...vals).first();

  const today = todayStr();
  return {
    ok: true,
    total: n,
    tasks: results.map((r) => ({ ...publicTask(r), overdue: isOverdue(r, today) })),
  };
});

route("GET", "/api/tasks/:id", needMember, async (ctx) => {
  const id = toInt(ctx.params.id, "المهمة", { max: 1e12 });
  const row = await ctx.env.DB.prepare(`${TASK_SELECT} WHERE t.id = ? AND t.workspace_id = ?`).bind(id, ctx.user.wid).first();
  if (!row) throw new HttpError(404, "المهمة غير موجودة");
  if (!isAdmin(ctx.user) && row.assignee_id !== ctx.user.id) throw new HttpError(403, "لا تملك صلاحية عرض هذه المهمة");

  const { results: notes } = await ctx.env.DB.prepare(
    `SELECT n.id, n.body, n.created_at, u.full_name AS author_name
       FROM task_notes n JOIN users u ON u.id = n.user_id
      WHERE n.task_id = ? ORDER BY n.created_at ASC, n.id ASC`
  ).bind(id).all();

  return {
    ok: true,
    task: { ...publicTask(row), overdue: isOverdue(row, todayStr()) },
    notes: notes.map((n) => ({ id: n.id, body: n.body, createdAt: n.created_at, authorName: n.author_name })),
  };
});

route("POST", "/api/tasks", needAdmin, async (ctx) => {
  const b = await readJson(ctx.req);
  const title = cleanText(b.title, { min: 2, max: 160, field: "عنوان المهمة", required: true });
  const description = cleanText(b.description, { max: 4000, field: "التفاصيل" });
  const priority = normPriority(b.priority);
  const dueDate = normDate(b.dueDate, "تاريخ الاستحقاق");
  const resultNote = cleanText(b.resultNote, { max: 2000, field: "ملاحظة الإنجاز" });
  const managerNote = cleanText(b.managerNote, { max: 2000, field: "ملاحظة المشرف" });

  let ids = Array.isArray(b.assigneeIds) ? b.assigneeIds : [b.assigneeId];
  ids = [...new Set(ids.filter((v) => v !== undefined && v !== null && v !== "").map((v) => toInt(v, "العضو", { max: 1e9 })))];
  if (!ids.length) throw new HttpError(400, "اختر عضواً واحداً على الأقل");

  const ph = ids.map(() => "?").join(",");
  const { results: found } = await ctx.env.DB.prepare(
    `SELECT u.id, u.full_name FROM members m JOIN users u ON u.id = m.user_id
      WHERE u.id IN (${ph}) AND m.workspace_id = ? AND m.status = 'active'`
  ).bind(...ids, ctx.user.wid).all();
  if (found.length !== ids.length) throw new HttpError(400, "أحد الأعضاء غير موجود في هذه البيئة أو لم يوافق على الدعوة");

  const now = nowIso();
  const preDone = !!resultNote;
  const created = [];

  for (const uid of ids) {
    await ctx.env.DB.prepare(
      `INSERT INTO tasks (workspace_id, title, description, assignee_id, created_by, priority, status,
                          due_date, result_note, manager_note, progress, assigned_at, read_at, started_at, completed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      ctx.user.wid, title, description, uid, ctx.user.id, priority,
      preDone ? "done" : "new", dueDate, resultNote, managerNote,
      preDone ? 100 : 0, now,                       // progress, assigned_at
      preDone ? now : null, preDone ? now : null,   // read_at, started_at
      preDone ? now : null, now                     // completed_at, updated_at
    ).run();

    const task = await ctx.env.DB.prepare("SELECT * FROM tasks WHERE id = last_insert_rowid()").first();
    created.push(publicTask(task));
    await logActivity(ctx.env, {
      workspaceId: ctx.user.wid, entity: "task", entityId: task.id, actorId: ctx.user.id,
      action: "task_create", details: `إسناد "${title}" إلى ${found.find((f) => f.id === uid).full_name}`,
    });
  }

  return { ok: true, created: created.length, tasks: created };
});

route("PATCH", "/api/tasks/:id", needMember, async (ctx) => {
  const id = toInt(ctx.params.id, "المهمة", { max: 1e12 });
  const task = await ctx.env.DB.prepare("SELECT * FROM tasks WHERE id = ? AND workspace_id = ?").bind(id, ctx.user.wid).first();
  if (!task) throw new HttpError(404, "المهمة غير موجودة");

  const isOwner = task.assignee_id === ctx.user.id;
  const admin = isAdmin(ctx.user);
  if (!isOwner && !admin) throw new HttpError(403, "لا تملك صلاحية تعديل هذه المهمة");

  const b = await readJson(ctx.req);
  const sets = [], vals = [], changes = [];

  if (admin) {
    if (b.title !== undefined) { sets.push("title = ?"); vals.push(cleanText(b.title, { min: 2, max: 160, field: "العنوان", required: true })); changes.push("العنوان"); }
    if (b.description !== undefined) { sets.push("description = ?"); vals.push(cleanText(b.description, { max: 4000, field: "التفاصيل" })); }
    if (b.priority !== undefined) { sets.push("priority = ?"); vals.push(normPriority(b.priority)); changes.push("الأولوية"); }
    if (b.dueDate !== undefined) { sets.push("due_date = ?"); vals.push(normDate(b.dueDate, "تاريخ الاستحقاق")); changes.push("الاستحقاق"); }
    if (b.managerNote !== undefined) { sets.push("manager_note = ?"); vals.push(cleanText(b.managerNote, { max: 2000, field: "ملاحظة المشرف" })); }

    if (b.assigneeId !== undefined) {
      const nid = toInt(b.assigneeId, "العضو", { max: 1e9 });
      const emp = await ctx.env.DB.prepare(
        `SELECT u.id, u.full_name FROM members m JOIN users u ON u.id = m.user_id
          WHERE u.id = ? AND m.workspace_id = ? AND m.status = 'active'`
      ).bind(nid, ctx.user.wid).first();
      if (!emp) throw new HttpError(400, "العضو غير موجود أو لم يوافق على الدعوة");
      if (nid !== task.assignee_id) {
        sets.push("assignee_id = ?", "read_at = NULL", "completed_at = NULL",
                  "status = CASE WHEN status='done' THEN 'read' ELSE status END");
        vals.push(nid);
        changes.push(`المسؤول ← ${emp.full_name}`);
      }
    }
    if (b.status !== undefined) {
      const st = normStatus(b.status);
      if (st === "done") {
        sets.push("status='done'", "progress=100", "read_at=COALESCE(read_at, datetime('now'))",
                  "started_at=COALESCE(started_at, datetime('now'))", "completed_at=COALESCE(completed_at, datetime('now'))");
      } else if (st === "cancelled") {
        sets.push("status='cancelled'", "completed_at=NULL");
        if (task.status === "done") sets.push("progress=0");
      } else if (st === "new") {
        sets.push("status='new'", "completed_at=NULL", "read_at=NULL");
      } else {
        sets.push("status='read'", "completed_at=NULL", "read_at=COALESCE(read_at, datetime('now'))",
                  "started_at=COALESCE(started_at, datetime('now'))");
        if (task.status === "done") sets.push("progress=25");
      }
      changes.push(`الحالة ← ${st}`);
    }
  }

  if (b.resultNote !== undefined) {
    sets.push("result_note = ?");
    vals.push(cleanText(b.resultNote, { max: 2000, field: "ملاحظة الإنجاز" }));
  }
  if (b.progress !== undefined) { sets.push("progress = ?"); vals.push(toInt(b.progress, "نسبة الإنجاز", { min: 0, max: 100 })); }

  if (b.markRead === true) {
    sets.push("status = CASE WHEN status='new' THEN 'read' ELSE status END",
              "read_at = COALESCE(read_at, datetime('now'))",
              "started_at = COALESCE(started_at, datetime('now'))");
  }
  if (b.markDone === true) {
    sets.push("status='done'", "progress=100", "read_at=COALESCE(read_at, datetime('now'))",
              "started_at=COALESCE(started_at, datetime('now'))", "completed_at=datetime('now')");
    changes.push("تم الإنجاز");
  }
  if (b.reopen === true) { sets.push("status='read'", "progress=25", "completed_at=NULL"); changes.push("إعادة فتح"); }

  if (!sets.length) throw new HttpError(400, "لا توجد تغييرات");

  sets.push("updated_at = datetime('now')");
  await ctx.env.DB.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();

  const fresh = await ctx.env.DB.prepare(`${TASK_SELECT} WHERE t.id = ?`).bind(id).first();
  await logActivity(ctx.env, {
    workspaceId: ctx.user.wid, entity: "task", entityId: id, actorId: ctx.user.id,
    action: changes.length ? "task_update" : "task_read",
    details: changes.length ? changes.join(" | ") : `تعليم "${task.title}" كمقروء`,
  });
  return { ok: true, task: { ...publicTask(fresh), overdue: isOverdue(fresh, todayStr()) } };
});

route("DELETE", "/api/tasks/:id", needAdmin, async (ctx) => {
  const id = toInt(ctx.params.id, "المهمة", { max: 1e12 });
  const task = await ctx.env.DB.prepare("SELECT * FROM tasks WHERE id = ? AND workspace_id = ?").bind(id, ctx.user.wid).first();
  if (!task) throw new HttpError(404, "المهمة غير موجودة");
  await ctx.env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(id).run();
  await logActivity(ctx.env, {
    workspaceId: ctx.user.wid, entity: "task", entityId: id, actorId: ctx.user.id,
    action: "task_delete", details: `حذف "${task.title}"`,
  });
  return { ok: true };
});

route("POST", "/api/tasks/:id/notes", needMember, async (ctx) => {
  const id = toInt(ctx.params.id, "المهمة", { max: 1e12 });
  const task = await ctx.env.DB.prepare("SELECT * FROM tasks WHERE id = ? AND workspace_id = ?").bind(id, ctx.user.wid).first();
  if (!task) throw new HttpError(404, "المهمة غير موجودة");
  if (!isAdmin(ctx.user) && task.assignee_id !== ctx.user.id) throw new HttpError(403, "لا تملك صلاحية التعليق على هذه المهمة");

  const b = await readJson(ctx.req);
  const body = cleanText(b.body, { min: 1, max: 1500, field: "التعليق", required: true });
  const now = nowIso();

  const info = await ctx.env.DB.prepare(
    "INSERT INTO task_notes (task_id, user_id, body, created_at) VALUES (?, ?, ?, ?)"
  ).bind(id, ctx.user.id, body, now).run();

  await logActivity(ctx.env, {
    workspaceId: ctx.user.wid, entity: "task", entityId: id, actorId: ctx.user.id,
    action: "task_note", details: `تعليق على "${task.title}"`,
  });
  return { ok: true, note: { id: info.meta?.last_row_id ?? null, body, createdAt: now, authorName: ctx.user.full_name } };
});

// ══════════════════════════════════════════════════════════
//  قوائم TODO  (خاصة أو مرئية لبيئة العمل) — لكل الأدوار
// ══════════════════════════════════════════════════════════

const TODO_SELECT = `
  SELECT t.*, u.full_name AS owner_name FROM todos t JOIN users u ON u.id = t.owner_id`;

const TODO_ACCESS = `
  ( t.owner_id = :uid
    OR (t.visibility = 'workspace' AND t.workspace_id = :wid) )`;

route("GET", "/api/todos", needAuth, async (ctx) => {
  const q = sp(ctx.req);
  const view = q.get("view") || "all"; // all | private | shared | done | open

  let extra = "";
  if (view === "private") extra = " AND t.visibility='private' AND t.owner_id = ?";
  else if (view === "shared") extra = " AND t.visibility='workspace' AND t.workspace_id = ?";
  else if (view === "done") extra = " AND t.done = 1";
  else if (view === "open") extra = " AND t.done = 0";

  const ownerFilter = q.get("mine") === "1" ? " AND t.owner_id = ?" : "";
  const search = (q.get("q") || "").trim().slice(0, 80);
  const searchFilter = search ? " AND (t.title LIKE ? OR t.description LIKE ?)" : "";

  const binds = [ctx.user.id, ctx.user.wid];
  const extraBinds = [];
  if (view === "private") extraBinds.push(ctx.user.id);
  else if (view === "shared") extraBinds.push(ctx.user.wid);
  if (ownerFilter) extraBinds.push(ctx.user.id);
  if (searchFilter) { extraBinds.push(`%${search}%`, `%${search}%`); }

  const where = TODO_ACCESS.replace(/:uid/g, "?").replace(/:wid/g, "?") + extra + ownerFilter + searchFilter;

  const { results } = await ctx.env.DB.prepare(
    `${TODO_SELECT}
      WHERE ${where}
      ORDER BY t.done ASC,
               CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
               t.sort_order ASC, t.id DESC`
  ).bind(...binds, ...extraBinds).all();

  const today = todayStr();
  const items = results.map((r) => ({
    ...publicTodo(r),
    isOverdue: !r.done && r.due_date && r.due_date < today,
  }));

  const counts = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(done=0),0) AS open_c,
            COALESCE(SUM(done=1),0) AS done_c,
            COALESCE(SUM(CASE WHEN visibility='private' THEN 1 ELSE 0 END),0) AS private_c,
            COALESCE(SUM(CASE WHEN visibility='workspace' THEN 1 ELSE 0 END),0) AS shared_c
       FROM todos t WHERE ${TODO_ACCESS.replace(/:uid/g, "?").replace(/:wid/g, "?")}`
  ).bind(ctx.user.id, ctx.user.wid).first();

  return {
    ok: true,
    todos: items,
    counts: {
      total: counts.total, open: counts.open_c, done: counts.done_c,
      private: counts.private_c, shared: counts.shared_c,
    },
  };
});

route("POST", "/api/todos", needAuth, async (ctx) => {
  const b = await readJson(ctx.req);
  const title = cleanText(b.title, { min: 1, max: 200, field: "عنوان المهمة", required: true });
  const description = cleanText(b.description, { max: 2000, field: "التفاصيل" });
  const visibility = b.visibility === "workspace" ? "workspace" : "private";
  const priority = ["low", "normal", "high"].includes(b.priority) ? b.priority : "normal";
  const dueDate = normDate(b.dueDate, "تاريخ الاستحقاق");

  // القوائم العامة تتطلب بيئة عمل
  if (visibility === "workspace" && !ctx.user.wid) {
    throw new HttpError(400, "القوائم العامة تتطلب بيئة عمل. أنشئ بيئة أولاً");
  }

  const now = nowIso();
  const maxRow = await ctx.env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), 0) AS m FROM todos WHERE owner_id = ?"
  ).bind(ctx.user.id).first();

  const info = await ctx.env.DB.prepare(
    `INSERT INTO todos (owner_id, workspace_id, visibility, title, description, done, priority, due_date, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
  ).bind(ctx.user.id, visibility === "workspace" ? ctx.user.wid : null, visibility, title, description,
        priority, dueDate, (maxRow.m || 0) + 1, now, now).run();

  await logActivity(ctx.env, {
    workspaceId: ctx.user.wid, entity: "todo", entityId: info.meta.last_row_id, actorId: ctx.user.id,
    action: "todo_create",
    details: `قائمة ${visibility === "workspace" ? "عامة" : "خاصة"}: "${title}"`,
  });

  const row = await ctx.env.DB.prepare(`${TODO_SELECT} WHERE t.id = ?`).bind(info.meta.last_row_id).first();
  return { ok: true, todo: publicTodo(row) };
});

route("PATCH", "/api/todos/:id", needAuth, async (ctx) => {
  const id = toInt(ctx.params.id, "القائمة", { max: 1e12 });
  const todo = await ctx.env.DB.prepare("SELECT * FROM todos WHERE id = ?").bind(id).first();
  if (!todo) throw new HttpError(404, "القائمة غير موجودة");

  const canEdit = todo.owner_id === ctx.user.id ||
    (isAdmin(ctx.user) && todo.visibility === "workspace" && todo.workspace_id === ctx.user.wid);
  if (!canEdit) throw new HttpError(403, "لا تملك صلاحية تعديل هذه القائمة");

  const b = await readJson(ctx.req);
  const sets = [], vals = [];

  if (b.title !== undefined) { sets.push("title = ?"); vals.push(cleanText(b.title, { min: 1, max: 200, field: "العنوان", required: true })); }
  if (b.description !== undefined) { sets.push("description = ?"); vals.push(cleanText(b.description, { max: 2000, field: "التفاصيل" })); }
  if (b.priority !== undefined) { sets.push("priority = ?"); vals.push(["low", "normal", "high"].includes(b.priority) ? b.priority : "normal"); }
  if (b.dueDate !== undefined) { sets.push("due_date = ?"); vals.push(normDate(b.dueDate, "تاريخ الاستحقاق")); }
  if (b.visibility !== undefined) {
    const vis = b.visibility === "workspace" ? "workspace" : "private";
    if (vis === "workspace" && !ctx.user.wid) throw new HttpError(400, "لا توجد بيئة عمل");
    sets.push("visibility = ?", "workspace_id = ?");
    vals.push(vis, vis === "workspace" ? ctx.user.wid : null);
  }
  if (b.sortOrder !== undefined) { sets.push("sort_order = ?"); vals.push(toInt(b.sortOrder, "الترتيب", { min: 0, max: 1e6 })); }
  if (b.done !== undefined) {
    const done = b.done ? 1 : 0;
    sets.push("done = ?", "completed_at = ?");
    vals.push(done, done ? nowIso() : null);
  }
  if (!sets.length) throw new HttpError(400, "لا توجد تغييرات");

  sets.push("updated_at = datetime('now')");
  await ctx.env.DB.prepare(`UPDATE todos SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id).run();

  if (b.done !== undefined) {
    await logActivity(ctx.env, {
      workspaceId: ctx.user.wid, entity: "todo", entityId: id, actorId: ctx.user.id,
      action: b.done ? "todo_done" : "todo_undone",
      details: `${b.done ? "إنجاز" : "إعادة فتح"}: "${todo.title}"`,
    });
  }

  const row = await ctx.env.DB.prepare(`${TODO_SELECT} WHERE t.id = ?`).bind(id).first();
  return { ok: true, todo: publicTodo(row) };
});

route("DELETE", "/api/todos/:id", needAuth, async (ctx) => {
  const id = toInt(ctx.params.id, "القائمة", { max: 1e12 });
  const todo = await ctx.env.DB.prepare("SELECT * FROM todos WHERE id = ?").bind(id).first();
  if (!todo) throw new HttpError(404, "القائمة غير موجودة");

  const canEdit = todo.owner_id === ctx.user.id ||
    (isAdmin(ctx.user) && todo.visibility === "workspace" && todo.workspace_id === ctx.user.wid);
  if (!canEdit) throw new HttpError(403, "لا تملك صلاحية حذف هذه القائمة");

  await ctx.env.DB.prepare("DELETE FROM todos WHERE id = ?").bind(id).run();
  await logActivity(ctx.env, {
    workspaceId: ctx.user.wid, entity: "todo", entityId: id, actorId: ctx.user.id,
    action: "todo_delete", details: `حذف قائمة "${todo.title}"`,
  });
  return { ok: true };
});

/** حذف المكتملة */
route("POST", "/api/todos/clear-done", needAuth, async (ctx) => {
  const r = await ctx.env.DB.prepare(
    `DELETE FROM todos WHERE done = 1 AND owner_id = ?
      AND (visibility = 'private' OR workspace_id = ?)`
  ).bind(ctx.user.id, ctx.user.wid).run();
  return { ok: true, deleted: r.meta?.changes ?? 0 };
});

// ══════════════════════════════════════════════════════════
//  الإحصائيات والتقارير
// ══════════════════════════════════════════════════════════

route("GET", "/api/stats", needMember, async (ctx) => {
  const q = sp(ctx.req);
  let where = "workspace_id = ?";
  let vals = [ctx.user.wid];

  if (!isAdmin(ctx.user) || q.get("scope") === "mine") {
    where += " AND assignee_id = ?";
    vals.push(ctx.user.id);
  } else if (q.get("assigneeId")) {
    where += " AND assignee_id = ?";
    vals.push(toInt(q.get("assigneeId"), "العضو"));
  }

  const t = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(status='new'),0)       AS new_c,
            COALESCE(SUM(status='read'),0)      AS read_c,
            COALESCE(SUM(status='done'),0)      AS done_c,
            COALESCE(SUM(status='cancelled'),0) AS cancel_c,
            COALESCE(SUM(CASE WHEN due_date IS NOT NULL AND due_date < date('now') AND status NOT IN ('done','cancelled') THEN 1 ELSE 0 END),0) AS overdue_c,
            COALESCE(SUM(CASE WHEN due_date = date('now') AND status NOT IN ('done','cancelled') THEN 1 ELSE 0 END),0) AS today_c,
            COALESCE(SUM(CASE WHEN due_date BETWEEN date('now') AND date('now','+7 day') AND status NOT IN ('done','cancelled') THEN 1 ELSE 0 END),0) AS week_c,
            COALESCE(SUM(CASE WHEN completed_at IS NOT NULL AND completed_at <= due_date THEN 1 ELSE 0 END),0) AS on_time_c,
            COALESCE(SUM(CASE WHEN status='done' AND completed_at >= date('now','-7 day') THEN 1 ELSE 0 END),0) AS done_week
       FROM tasks WHERE ${where}`
  ).bind(...vals).first();

  const admin = isAdmin(ctx.user);
  const staff = admin
    ? await ctx.env.DB.prepare(
        `SELECT COALESCE(SUM(status='active'),0) AS active, COUNT(*) AS total
           FROM members WHERE workspace_id = ?`
      ).bind(ctx.user.wid).first()
    : { active: 0, total: 0 };

  const todos = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(done=0),0) AS open_c,
            COALESCE(SUM(done=1),0) AS done_c,
            COALESCE(SUM(CASE WHEN visibility='private' THEN 1 ELSE 0 END),0) AS private_c,
            COALESCE(SUM(CASE WHEN visibility='workspace' AND done=0 THEN 1 ELSE 0 END),0) AS shared_open
       FROM todos t WHERE ${TODO_ACCESS.replace(/:uid/g, "?").replace(/:wid/g, "?")}`
  ).bind(ctx.user.id, ctx.user.wid).first();

  const done = t.done_c || 0;
  return {
    ok: true,
    totals: {
      total: t.total || 0,
      new: t.new_c,
      read: t.read_c,
      done,
      cancelled: t.cancel_c,
      overdue: t.overdue_c,
      dueToday: t.today_c,
      dueWeek: t.week_c,
      doneThisWeek: t.done_week,
      onTime: t.on_time_c,
      onTimeRate: done ? Math.round((t.on_time_c / done) * 100) : 0,
      open: (t.total || 0) - done - t.cancel_c,
      completionRate: t.total ? Math.round((done / t.total) * 100) : 0,
      membersActive: staff.active,
      membersTotal: staff.total,
    },
    todos: {
      total: todos.total, open: todos.open_c, done: todos.done_c,
      private: todos.private_c, sharedOpen: todos.shared_open,
    },
  };
});

route("GET", "/api/reports", needAdmin, async (ctx) => {
  const { results } = await ctx.env.DB.prepare(
    `SELECT m.role, m.status, u.id AS user_id, u.username, u.full_name, u.job_title,
            u.avatar_color, u.last_login_at,
            COUNT(t.id) AS total,
            COALESCE(SUM(t.status='new'),0)  AS new_c,
            COALESCE(SUM(t.status='read'),0) AS read_c,
            COALESCE(SUM(t.status='done'),0) AS done_c,
            COALESCE(SUM(CASE WHEN t.due_date IS NOT NULL AND t.due_date < date('now') AND t.status NOT IN ('done','cancelled') THEN 1 ELSE 0 END),0) AS overdue_c,
            COALESCE(SUM(CASE WHEN t.completed_at IS NOT NULL AND t.completed_at <= t.due_date THEN 1 ELSE 0 END),0) AS on_time_c,
            AVG(CASE WHEN t.completed_at IS NOT NULL THEN (julianday(t.completed_at) - julianday(t.assigned_at)) END) AS avg_days
       FROM members m JOIN users u ON u.id = m.user_id
       LEFT JOIN tasks t ON t.assignee_id = u.id AND t.workspace_id = m.workspace_id
      WHERE m.workspace_id = ? AND m.status = 'active'
      GROUP BY m.id ORDER BY done_c DESC, u.full_name COLLATE NOCASE`
  ).bind(ctx.user.wid).all();

  return {
    ok: true,
    reports: results.map((r) => ({
      userId: r.user_id,
      username: r.username,
      fullName: r.full_name,
      jobTitle: r.job_title || "",
      avatarColor: r.avatar_color || "#4f7cff",
      role: r.role,
      lastLoginAt: r.last_login_at,
      total: r.total,
      new: r.new_c,
      read: r.read_c,
      done: r.done_c,
      overdue: r.overdue_c,
      onTime: r.on_time_c,
      onTimeRate: r.done_c ? Math.round((r.on_time_c / r.done_c) * 100) : 0,
      avgDays: r.avg_days != null ? Math.round(r.avg_days * 10) / 10 : null,
      completionRate: r.total ? Math.round((r.done_c / r.total) * 100) : 0,
    })),
  };
});

route("GET", "/api/reports.csv", needAdmin, async (ctx) => {
  const { results: rows } = await ctx.env.DB.prepare(
    `SELECT m.role, u.username, u.full_name, u.job_title, u.avatar_color,
            COUNT(t.id) AS total,
            COALESCE(SUM(t.status='new'),0)  AS new_c,
            COALESCE(SUM(t.status='read'),0) AS read_c,
            COALESCE(SUM(t.status='done'),0) AS done_c,
            COALESCE(SUM(CASE WHEN t.due_date IS NOT NULL AND t.due_date < date('now') AND t.status NOT IN ('done','cancelled') THEN 1 ELSE 0 END),0) AS overdue_c,
            AVG(CASE WHEN t.completed_at IS NOT NULL THEN (julianday(t.completed_at) - julianday(t.assigned_at)) END) AS avg_days
       FROM members m JOIN users u ON u.id = m.user_id
       LEFT JOIN tasks t ON t.assignee_id = u.id AND t.workspace_id = m.workspace_id
      WHERE m.workspace_id = ? AND m.status='active'
      GROUP BY m.id ORDER BY done_c DESC`
  ).bind(ctx.user.wid).all();
  const lines = [["العضو", "المستخدم", "الرتبة", "الإجمالي", "جديد", "مقروء", "منجز", "متأخر", "نسبة الإنجاز", "متوسط المدة"].join(",")];
  for (const r of rows) {
    const total = r.total || 0;
    lines.push([
      r.full_name, r.username, { owner: "صاحب", admin: "مشرف", member: "موظف" }[r.role] || r.role,
      total, r.new_c, r.read_c, r.done_c, r.overdue_c,
      total ? Math.round((r.done_c / total) * 100) + "%" : "",
      r.avg_days != null ? Math.round(r.avg_days * 10) / 10 : "",
    ].map(csvEscape).join(","));
  }
  return csvResponse(lines, `performance-${todayStr()}.csv`);
});

route("GET", "/api/export/tasks.csv", needMember, async (ctx) => {
  const onlyDone = sp(ctx.req).get("done") === "1";
  const admin = isAdmin(ctx.user);
  const scopeSql = admin ? "" : "AND t.assignee_id = ?";
  const bind = admin ? [] : [ctx.user.id];
  const doneSql = onlyDone ? "AND t.status='done'" : "";

  const { results } = await ctx.env.DB.prepare(
    `${TASK_SELECT} WHERE t.workspace_id = ? ${scopeSql} ${doneSql} ORDER BY t.assigned_at DESC`
  ).bind(ctx.user.wid, ...bind).all();

  const lines = [["رقم", "المهمة", "التفاصيل", "الموظف", "أنشأها", "الأولوية", "الحالة", "الاستحقاق", "نتيجة الإنجاز", "تاريخ الإسناد", "تاريخ القراءة", "تاريخ الإنجاز"].join(",")];
  for (const r of results) {
    lines.push([
      r.id, r.title, r.description, r.assignee_name,
      r.created_by === r.assignee_id ? "—" : r.creator_name,
      { new: "جديد", read: "مقروء", done: "منجز", cancelled: "ملغي" }[r.status] || r.status,
      { low: "منخفضة", normal: "عادية", high: "عالية", urgent: "عاجلة" }[r.priority] || r.priority,
      r.due_date || "", r.result_note,
      fmtDate(r.assigned_at) || r.assigned_at, fmtDate(r.read_at) || "", fmtDate(r.completed_at) || "",
    ].map(csvEscape).join(","));
  }
  return csvResponse(lines, `tasks-${todayStr()}.csv`);
});

// ══════════════════════════════════════════════════════════
//  سجل النشاط
// ══════════════════════════════════════════════════════════

route("GET", "/api/activity", needAuth, async (ctx) => {
  const limit = toInt(sp(ctx.req).get("limit"), "الحد", { def: 80, min: 1, max: 200 });
  const { results } = await ctx.env.DB.prepare(
    `SELECT a.*, u.full_name AS actor_name FROM activity a
       LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.workspace_id IS NULL OR a.workspace_id = ?
      ORDER BY a.created_at DESC, a.id DESC LIMIT ?`
  ).bind(ctx.user.wid, limit).all();

  return {
    ok: true,
    activity: results.map((a) => ({
      id: a.id, entity: a.entity, entityId: a.entity_id, action: a.action,
      details: a.details, createdAt: a.created_at, actorName: a.actor_name || "النظام",
    })),
  };
});

// ══════════════════════════════════════════════════════════
//  الحُرّاس والمساعدات
// ══════════════════════════════════════════════════════════

function needAuth(ctx) {
  if (!ctx.user) throw new HttpError(401, "انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى");
}
function needMember(ctx) {
  needAuth(ctx);
  if (!ctx.user.wid || !ctx.user.workspace) {
    throw new HttpError(409, "أنت خارج أي بيئة عمل. اختر بيئة عمل أو أنشئ واحدة");
  }
}
function needAdmin(ctx) {
  needAuth(ctx);
  if (!ctx.user.wid || !ctx.user.workspace) {
    throw new HttpError(409, "أنت خارج أي بيئة عمل");
  }
  if (!isAdmin(ctx.user)) throw new HttpError(403, "هذه العملية متاحة للمشرفين فقط");
}
function needOwner(ctx) {
  needAdmin(ctx);
  if (!isOwner(ctx.user)) throw new HttpError(403, "هذه العملية متاحة لصاحب بيئة العمل فقط");
}

async function badgesOf(env, user) {
  const invites = await pendingInviteCount(env, user.id);
  if (!user.wid) return { invites, newTasks: 0, openTasks: 0, overdue: 0, openTodos: 0 };

  const t = await env.DB.prepare(
    `SELECT COALESCE(SUM(status='new'),0) AS n,
            COALESCE(SUM(status NOT IN ('done','cancelled')),0) AS open_n,
            COALESCE(SUM(CASE WHEN due_date IS NOT NULL AND due_date < date('now') AND status NOT IN ('done','cancelled') THEN 1 ELSE 0 END),0) AS od
       FROM tasks WHERE workspace_id = ? AND assignee_id = ?`
  ).bind(user.wid, user.id).first();

  const td = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM todos
      WHERE done = 0 AND (owner_id = ? OR (visibility='workspace' AND workspace_id = ?))`
  ).bind(user.id, user.wid).first();

  return {
    invites, newTasks: t.n || 0, openTasks: t.open_n || 0,
    overdue: t.od || 0, openTodos: td.n || 0,
  };
}

async function pendingInviteCount(env, userId) {
  const { n } = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM members WHERE user_id = ? AND status = 'pending'"
  ).bind(userId).first();
  return n || 0;
}

function isPast(sqlTimeStr) {
  if (!sqlTimeStr) return false;
  return Date.parse(sqlTimeStr.replace(" ", "T") + "Z") <= Date.now();
}

function sqlTime(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

function csvResponse(lines, filename) {
  return new Response("\uFEFF" + lines.join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

const COLORS = ["#4f7cff", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#10b981", "#f97316", "#6366f1"];
function pickColor(seed) {
  let h = 7;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

// ══════════════════════════════════════════════════════════
//  الموزّع
// ══════════════════════════════════════════════════════════

export async function handleApi(req, env, user) {
  const path = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
  const cookies = [];

  const ctx = {
    req, env, user,
    params: {},
    setSessionCookie(value, opts = {}) { cookies.push(cookieHeader(value, opts)); },
    clearSessionCookie() { cookies.push(cookieHeader("", { clear: true })); },
    async switchWorkspace(workspaceId) {
      const fresh = await env.DB.prepare("SELECT token_version FROM users WHERE id = ?").bind(ctx.user.id).first();
      const { token, expiresAt, maxAge } = await createSession(env, { ...ctx.user, token_version: fresh.token_version }, req, workspaceId);
      ctx.setSessionCookie(token, { maxAge, expires: expiresAt });
      // تحديث الجلسة القديمة حتى لا تتراكم
      await env.DB.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").bind(ctx.user.sid).run();
    },
  };

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.regex.exec(path);
    if (!m) continue;

    r.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });

    try {
      if (r.guard) await r.guard(ctx);
      const result = await r.handler(ctx);
      const res = result instanceof Response ? result : jsonResponse(result, 200);
      cookies.forEach((c) => res.headers.append("set-cookie", c));
      return res;
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status >= 500) console.error("API error", path, err?.stack || err);
      const res = jsonResponse(
        { error: status >= 500 ? "حدث خطأ داخلي، حاول مرة أخرى" : err.message,
          ...(status >= 500 && env.DEBUG_ERRORS === "1" ? { debug: `${err?.message} :: ${err?.stack}` } : {}) },
        status
      );
      cookies.forEach((c) => res.headers.append("set-cookie", c));
      return res;
    }
  }

  const res = jsonResponse({ error: "المسار غير موجود" }, 404);
  cookies.forEach((c) => res.headers.append("set-cookie", c));
  return res;
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}