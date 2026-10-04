// ==========================================================
//  db.js — مساعدات قاعدة البيانات وسجل النشاط
// ==========================================================

import { nowIso } from "./util.js";

/** يسجّل حدثاً في سجل النشاط */
export async function logActivity(env, { workspaceId = null, entity, entityId = null, actorId = null, action, details = "" }) {
  await env.DB.prepare(
    `INSERT INTO activity (workspace_id, entity, entity_id, actor_id, action, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(workspaceId, entity, entityId, actorId, action, String(details).slice(0, 500), nowIso()).run();
}

/** يزيل الحقول الحساسة من صف مستخدم */
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    fullName: u.full_name,
    jobTitle: u.job_title || "",
    phone: u.phone || "",
    email: u.email || "",
    bio: u.bio || "",
    avatarColor: u.avatar_color || "#4f7cff",
    isActive: !!u.is_active,
    mustChangePassword: !!u.must_change_password,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}

export function publicWorkspace(w) {
  if (!w) return null;
  return {
    id: w.id ?? w.wid,
    name: w.name,
    tagline: w.tagline || "",
    avatarColor: w.avatar_color || w.avatarColor || "#4f7cff",
    ownerId: w.owner_id ?? w.ownerId,
    taskDueDays: w.task_due_days ?? w.taskDueDays ?? 7,
    isPersonal: !!(w.is_personal ?? w.isPersonal),
    createdAt: w.created_at,
    role: w.role ?? null,
    memberCount: w.member_count ?? w.memberCount ?? null,
    pendingCount: w.pending_count ?? w.pendingCount ?? null,
  };
}

/** يزيل الحقول الحساسة من صف مهمة */
export function publicTask(t) {
  if (!t) return null;
  return {
    id: t.id,
    workspaceId: t.workspace_id,
    title: t.title,
    description: t.description || "",
    assigneeId: t.assignee_id,
    assigneeName: t.assignee_name || "",
    assigneeTitle: t.assignee_title || "",
    createdBy: t.created_by,
    creatorName: t.creator_name || "",
    priority: t.priority,
    status: t.status,
    dueDate: t.due_date,
    resultNote: t.result_note || "",
    managerNote: t.manager_note || "",
    progress: t.progress ?? 0,
    assignedAt: t.assigned_at,
    readAt: t.read_at,
    startedAt: t.started_at,
    completedAt: t.completed_at,
    updatedAt: t.updated_at,
  };
}

export function publicTodo(t) {
  if (!t) return null;
  return {
    id: t.id,
    ownerId: t.owner_id,
    ownerName: t.owner_name || "",
    workspaceId: t.workspace_id,
    visibility: t.visibility,
    title: t.title,
    description: t.description || "",
    done: !!t.done,
    priority: t.priority,
    dueDate: t.due_date,
    sortOrder: t.sort_order,
    createdAt: t.created_at,
    completedAt: t.completed_at,
    isOverdue: !!t.is_overdue,
  };
}

export async function touchTask(env, taskId) {
  await env.DB.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").bind(nowIso(), taskId).run();
}