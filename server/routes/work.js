import express from 'express';
import { requireRole, requireWard, isLead } from '../auth.js';
import { ENTITY_TYPES, cleanFields, isValidDate } from '../registers.js';
import { makeAudit, todayNairobi, nowIso, addDays, weekRange, bad, achievementPct, asyncRouter } from '../util.js';
import { loader } from '../ctx.js';
import { sortBy, isActive } from '../store.js';

const TASK_STATUSES = ['planned', 'in_progress', 'completed', 'postponed', 'cancelled'];
const OPEN_STATUSES = ['planned', 'in_progress', 'postponed'];
const isOpen = (t) => OPEN_STATUSES.includes(t.status);
const eatStartIso = (d) => new Date(d + 'T00:00:00+03:00').toISOString();

export function isIsoDateTime(s) {
  return typeof s === 'string' && !Number.isNaN(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}T/.test(s);
}

export function workRoutes(store) {
  const r = asyncRouter(express.Router());
  const audit = makeAudit(store);
  r.use(requireWard);

  const wardTasks = async (w) => (await store.find('tasks', { ward_id: w })).filter((t) => !t.deleted_at);
  const wardActivities = async (w) => (await store.find('activity_records', { ward_id: w })).filter((a) => !a.deleted_at);

  // ---------- Lookups ----------
  r.get('/lookups', async (req, res) => {
    const w = req.ward.id, L = loader(store, req);
    const [categories, officers, locations, templates, premises] = await Promise.all([
      store.all('categories'), L.officers(), store.find('locations', { ward_id: w }), store.all('notice_templates'),
      store.find('food_premises', { ward_id: w })
    ]);
    res.json({
      categories: sortBy(categories, 'name').map(({ id, name, module_group, description, active }) => ({ id, name, module_group, description, active })),
      officers,
      locations: sortBy(locations, 'sub_location', 'village'),
      templates: sortBy(templates.filter((t) => isActive(t.active) && isActive(t.approved)), 'name').map(({ id, name }) => ({ id, name })),
      premises: sortBy(premises.filter((p) => isActive(p.active)), 'premises_name').map((p) => ({ id: p.id, name: p.premises_name }))
    });
  });

  // ---------- Dashboard ----------
  r.get('/dashboard', async (req, res) => {
    const w = req.ward.id, me = req.user.id, now = nowIso(), today = todayNairobi(), L = loader(store, req);
    const endToday = eatStartIso(addDays(today, 1));
    const wk = weekRange(today);
    const [tasks, users, cats, fus, acts, targets, premises, handlers, samples] = await Promise.all([
      wardTasks(w), L.users(), L.categories(), store.find('follow_ups', { ward_id: w }), wardActivities(w),
      store.find('targets', { ward_id: w, period_type: 'weekly' }), store.find('food_premises', { ward_id: w }),
      store.find('food_handlers', { ward_id: w }), store.find('water_samples', { ward_id: w })
    ]);
    const withNames = (t) => ({ ...t, category: cats.get(t.category_id)?.name ?? null, assigned_name: users.get(t.assigned_to)?.full_name ?? null });
    const mine = sortBy(tasks.filter((t) => t.assigned_to === me && isOpen(t)), 'due_at');
    const todayTasks = mine.filter((t) => t.due_at >= now && t.due_at < endToday).map(withNames);
    const overdue = mine.filter((t) => t.due_at < now).map(withNames);
    const upcoming = mine.filter((t) => t.due_at >= endToday).slice(0, 8).map(withNames);
    const soon = addDays(today, 7);
    const followUps = [];
    for (const f of sortBy(fus.filter((f) => f.status === 'open' && f.due_date <= soon && (isLead(req) || f.responsible_user_id === me)), 'due_date').slice(0, 10)) {
      followUps.push({ ...f, responsible_name: users.get(f.responsible_user_id)?.full_name ?? null,
        entity_name: await L.entityName(f.linked_entity_type, f.linked_entity_id), overdue: f.due_date < today });
    }

    const scopeUser = isLead(req) ? null : me;
    const prog = new Map();
    for (const a of acts) {
      if (a.activity_date < wk.start || a.activity_date > wk.end) continue;
      if (scopeUser && a.recorded_by !== scopeUser) continue;
      const p = prog.get(a.category_id) || { category: cats.get(a.category_id)?.name ?? null, achieved: 0, target: null };
      p.achieved += Number(a.quantity) || 0;
      prog.set(a.category_id, p);
    }
    for (const t of targets) {
      if (!(t.period_start <= wk.end && t.period_end >= wk.start)) continue;
      if (scopeUser ? t.user_id !== scopeUser : t.user_id != null) continue;
      const p = prog.get(t.category_id) || { category: cats.get(t.category_id)?.name ?? null, achieved: 0, target: null };
      p.target = (p.target || 0) + Number(t.target_value);
      prog.set(t.category_id, p);
    }
    const weekly = [...prog.values()].map((p) => ({ ...p, pct: achievementPct(p.achieved, p.target) })).sort((a, b) => String(a.category).localeCompare(String(b.category)));

    const openFus = fus.filter((f) => f.status === 'open' && f.due_date < today);
    const wardCounts = isLead(req) ? {
      open_tasks: tasks.filter(isOpen).length,
      overdue_tasks: tasks.filter((t) => isOpen(t) && t.due_at < now).length,
      overdue_follow_ups: openFus.length,
      facilities_overdue_actions: new Set(openFus.filter((f) => f.linked_entity_type === 'facility').map((f) => f.linked_entity_id)).size
    } : null;

    const expiring = {
      licences: premises.filter((p) => isActive(p.active) && p.licence_expiry_date && p.licence_expiry_date < today).length,
      certificates: handlers.filter((h) => isActive(h.active) && h.certificate_expiry && h.certificate_expiry < today).length,
      pending_samples: samples.filter((s) => s.compliance_status === 'pending_result').length
    };
    res.json({ today, week: wk, todayTasks, overdue, upcoming, followUps, weekly, wardCounts, expiring });
  });

  // ---------- Tasks ----------
  const canSeeTask = (req, t) => t && t.ward_id === req.ward.id && !t.deleted_at &&
    (isLead(req) || req.role === 'reviewer' || t.assigned_to === req.user.id || t.created_by === req.user.id);
  const decorate = async (L, t) => {
    const [users, cats, locs] = await Promise.all([L.users(), L.categories(), L.locations()]);
    const loc = t.location_id ? locs.get(t.location_id) : null;
    return {
      ...t,
      category: cats.get(t.category_id)?.name ?? null,
      assigned_name: users.get(t.assigned_to)?.full_name ?? null,
      created_by_name: users.get(t.created_by)?.full_name ?? null,
      sub_location: loc?.sub_location ?? null,
      village: loc?.village ?? null,
      is_overdue: isOpen(t) && t.due_at < nowIso(),
      entity_name: await L.entityName(t.linked_entity_type, t.linked_entity_id)
    };
  };

  r.get('/tasks', async (req, res) => {
    const q = req.query, now = nowIso(), L = loader(store, req), me = req.user.id;
    let rows = await wardTasks(req.ward.id);
    if (!isLead(req) && req.role !== 'reviewer') rows = rows.filter((t) => t.assigned_to === me || t.created_by === me);
    if (q.mine === '1') rows = rows.filter((t) => t.assigned_to === me);
    if (q.assigned_to) rows = rows.filter((t) => t.assigned_to === Number(q.assigned_to));
    if (q.category_id) rows = rows.filter((t) => t.category_id === Number(q.category_id));
    if (q.status === 'overdue') rows = rows.filter((t) => isOpen(t) && t.due_at < now);
    else if (q.status === 'open') rows = rows.filter(isOpen);
    else if (TASK_STATUSES.includes(q.status)) rows = rows.filter((t) => t.status === q.status);
    if (q.from) { const f = eatStartIso(q.from); rows = rows.filter((t) => t.due_at >= f); }
    if (q.to) { const e = eatStartIso(addDays(q.to, 1)); rows = rows.filter((t) => t.due_at < e); }
    if (q.q) { const s = String(q.q).toLowerCase(); rows = rows.filter((t) => `${t.title} ${t.description || ''}`.toLowerCase().includes(s)); }
    if (q.linked_entity_type && q.linked_entity_id) rows = rows.filter((t) => t.linked_entity_type === q.linked_entity_type && t.linked_entity_id === Number(q.linked_entity_id));
    rows = sortBy(rows, 'due_at').slice(0, 500);
    res.json(await Promise.all(rows.map((t) => decorate(L, t))));
  });

  r.get('/tasks/:id', async (req, res) => {
    const L = loader(store, req);
    const t = await store.get('tasks', req.params.id);
    if (!canSeeTask(req, t)) return res.status(404).json({ error: 'Task not found.' });
    const users = await L.users();
    const history = sortBy(await store.find('task_history', { task_id: t.id }), '-id')
      .map((h) => ({ ...h, full_name: users.get(h.user_id)?.full_name ?? null }));
    const activity = (await store.find('activity_records', { linked_task_id: t.id })).find((a) => !a.deleted_at) || null;
    res.json({ ...(await decorate(L, t)), history, activity });
  });

  const taskSpec = {
    title: { required: true, label: 'Title' }, description: {}, category_id: { type: 'int' }, assigned_to: { type: 'int' },
    due_at: { required: true, label: 'Due date' }, reminder_at: {}, priority: { enum: ['low', 'normal', 'high'] },
    location_id: { type: 'int' }, linked_entity_type: {}, linked_entity_id: { type: 'int' }, notes: {}, next_action: {}
  };
  const validateTask = async (req, L, data, errors) => {
    if (data.due_at && !isIsoDateTime(data.due_at)) errors.due_at = 'Enter a valid due date and time.';
    if (data.reminder_at && !isIsoDateTime(data.reminder_at)) errors.reminder_at = 'Enter a valid reminder date and time.';
    if (data.reminder_at && data.due_at && data.reminder_at > data.due_at) errors.reminder_at = 'Reminder should be before the due time.';
    if (data.assigned_to !== undefined && data.assigned_to !== null) {
      if (!(await L.memberIds()).has(data.assigned_to)) errors.assigned_to = 'Choose an active officer in this ward.';
      else if (!isLead(req) && data.assigned_to !== req.user.id) errors.assigned_to = 'Only the ward lead can assign tasks to other officers.';
    }
    if (data.linked_entity_type) {
      if (!ENTITY_TYPES.includes(data.linked_entity_type)) errors.linked_entity_type = 'Unknown record type.';
      else if (!data.linked_entity_id || !(await L.entityExists(data.linked_entity_type, data.linked_entity_id))) errors.linked_entity_id = 'Linked record not found in this ward.';
    }
    if (data.location_id && !(await L.locations()).has(data.location_id)) errors.location_id = 'Location not in this ward.';
  };
  const history = (taskId, userId, field, oldValue, newValue, reason) => store.insert('task_history', {
    task_id: taskId, user_id: userId, at: nowIso(), field, old_value: oldValue ?? null, new_value: newValue ?? null, reason: reason ?? null
  }, { timestamps: false });

  r.post('/tasks', requireRole('officer'), async (req, res) => {
    const L = loader(store, req);
    const { data, errors } = cleanFields(taskSpec, req.body || {});
    if (!data.assigned_to) data.assigned_to = req.user.id;
    await validateTask(req, L, data, errors);
    if (Object.keys(errors).length) return bad(res, errors);
    const id = await store.insert('tasks', {
      description: null, category_id: null, reminder_at: null, priority: 'normal', location_id: null, linked_entity_type: null,
      linked_entity_id: null, notes: null, next_action: null, ...data,
      ward_id: req.ward.id, created_by: req.user.id, status: 'planned', status_reason: null, completed_at: null, completed_by: null, deleted_at: null
    });
    await history(id, req.user.id, 'created', null, data.due_at);
    await audit(req, 'create', 'task', id, { title: data.title, assigned_to: data.assigned_to });
    res.status(201).json({ id });
  });

  r.patch('/tasks/:id', requireRole('officer'), async (req, res) => {
    const L = loader(store, req);
    const t = await store.get('tasks', req.params.id);
    if (!canSeeTask(req, t)) return res.status(404).json({ error: 'Task not found.' });
    if (!isLead(req) && t.assigned_to !== req.user.id && t.created_by !== req.user.id) return res.status(403).json({ error: 'You can only update your own tasks.' });
    const body = req.body || {};
    const { data, errors } = cleanFields(taskSpec, body, { partial: true });
    await validateTask(req, L, data, errors);

    const status = body.status;
    const reason = body.status_reason ? String(body.status_reason).trim() : null;
    if (status !== undefined) {
      if (!TASK_STATUSES.includes(status)) errors.status = 'Unknown status.';
      if (status === 'postponed') {
        if (!data.due_at || data.due_at === t.due_at) errors.due_at = 'Postponing needs a new due date.';
        if (!reason) errors.status_reason = 'Explain why the task is postponed.';
      }
      if (status === 'cancelled' && !reason) errors.status_reason = 'Explain why the task is cancelled.';
    }
    const rec = body.record_activity;
    if (status === 'completed' && rec) {
      if (!t.category_id && !data.category_id) errors.category_id = 'Choose a category so the activity can be counted in reports.';
      if (rec.activity_date && !isValidDate(rec.activity_date)) errors.activity_date = 'Enter a valid activity date.';
    }
    if (Object.keys(errors).length) return bad(res, errors);

    const upd = { ...data };
    if (status !== undefined && status !== t.status) {
      upd.status = status;
      upd.status_reason = reason;
      if (status === 'completed') { upd.completed_at = nowIso(); upd.completed_by = req.user.id; }
      else { upd.completed_at = null; upd.completed_by = null; }
      await history(t.id, req.user.id, 'status', t.status, status, reason);
    }
    for (const k of Object.keys(data)) {
      if (String(t[k] ?? '') !== String(data[k] ?? '')) await history(t.id, req.user.id, k, t[k], data[k], k === 'due_at' ? reason : null);
    }
    if (Object.keys(upd).length) await store.update('tasks', t.id, upd);
    // One activity record per task at most: the unique claim stops double counting even on retries.
    if (status === 'completed' && rec && (await store.claim(`activity_task_${t.id}`))) {
      await store.insert('activity_records', {
        ward_id: t.ward_id, category_id: data.category_id || t.category_id, activity_date: rec.activity_date || todayNairobi(),
        recorded_by: req.user.id, location_id: data.location_id ?? t.location_id ?? null, linked_task_id: t.id,
        linked_entity_type: t.linked_entity_type ?? null, linked_entity_id: t.linked_entity_id ?? null, linked_inspection_id: null,
        outcome: rec.outcome || null, notes: rec.notes || null, quantity: Number(rec.quantity) > 0 ? Number(rec.quantity) : 1,
        unit: rec.unit || 'activities', deleted_at: null
      });
    }
    await audit(req, status ? 'status_change' : 'update', 'task', t.id, { status, ...data });
    res.json({ ok: true });
  });

  r.delete('/tasks/:id', requireRole('ward_lead'), async (req, res) => {
    const t = await store.get('tasks', req.params.id);
    if (!t || t.ward_id !== req.ward.id || t.deleted_at) return res.status(404).json({ error: 'Task not found.' });
    await store.update('tasks', t.id, { deleted_at: nowIso() });
    await audit(req, 'delete', 'task', t.id, { title: t.title });
    res.json({ ok: true });
  });

  // ---------- Activity records ----------
  r.get('/activities', async (req, res) => {
    const q = req.query, L = loader(store, req);
    let rows = await wardActivities(req.ward.id);
    if (!isLead(req) && req.role !== 'reviewer') rows = rows.filter((a) => a.recorded_by === req.user.id);
    if (q.from) rows = rows.filter((a) => a.activity_date >= q.from);
    if (q.to) rows = rows.filter((a) => a.activity_date <= q.to);
    if (q.category_id) rows = rows.filter((a) => a.category_id === Number(q.category_id));
    if (q.recorded_by) rows = rows.filter((a) => a.recorded_by === Number(q.recorded_by));
    rows = sortBy(rows, '-activity_date', '-id').slice(0, 500);
    const [users, cats, locs] = await Promise.all([L.users(), L.categories(), L.locations()]);
    const out = [];
    for (const a of rows) {
      out.push({ ...a, category: cats.get(a.category_id)?.name ?? null, recorded_by_name: users.get(a.recorded_by)?.full_name ?? null,
        sub_location: locs.get(a.location_id)?.sub_location ?? null, entity_name: await L.entityName(a.linked_entity_type, a.linked_entity_id) });
    }
    res.json(out);
  });

  const actSpec = {
    category_id: { type: 'int', required: true, label: 'Category' }, activity_date: { type: 'date', required: true, label: 'Activity date' },
    location_id: { type: 'int' }, outcome: {}, notes: {}, quantity: { type: 'number' }, unit: {},
    linked_entity_type: {}, linked_entity_id: { type: 'int' }
  };
  r.post('/activities', requireRole('officer'), async (req, res) => {
    const L = loader(store, req);
    const { data, errors } = cleanFields(actSpec, req.body || {});
    if (data.activity_date && data.activity_date > todayNairobi()) errors.activity_date = 'Activity date cannot be in the future.';
    if (data.quantity !== undefined && data.quantity !== null && data.quantity <= 0) errors.quantity = 'Quantity must be more than zero.';
    if (data.category_id && !(await L.categories()).has(data.category_id)) errors.category_id = 'Choose a valid category.';
    if (data.linked_entity_type && (!ENTITY_TYPES.includes(data.linked_entity_type) || !(await L.entityExists(data.linked_entity_type, data.linked_entity_id)))) errors.linked_entity_id = 'Linked record not found.';
    if (Object.keys(errors).length) return bad(res, errors);
    const id = await store.insert('activity_records', {
      ward_id: req.ward.id, category_id: data.category_id, activity_date: data.activity_date, recorded_by: req.user.id,
      location_id: data.location_id ?? null, outcome: data.outcome ?? null, notes: data.notes ?? null, quantity: data.quantity || 1,
      unit: data.unit || 'activities', linked_entity_type: data.linked_entity_type ?? null, linked_entity_id: data.linked_entity_id ?? null,
      linked_task_id: null, linked_inspection_id: null, deleted_at: null
    });
    await audit(req, 'create', 'activity_record', id, data);
    res.status(201).json({ id });
  });

  r.delete('/activities/:id', requireRole('officer'), async (req, res) => {
    const a = await store.get('activity_records', req.params.id);
    if (!a || a.ward_id !== req.ward.id || a.deleted_at) return res.status(404).json({ error: 'Record not found.' });
    if (!isLead(req) && a.recorded_by !== req.user.id) return res.status(403).json({ error: 'You can only remove your own records.' });
    await store.update('activity_records', a.id, { deleted_at: nowIso() });
    await audit(req, 'delete', 'activity_record', a.id, { category_id: a.category_id, activity_date: a.activity_date });
    res.json({ ok: true });
  });

  // ---------- Follow ups ----------
  r.get('/follow-ups', async (req, res) => {
    const q = req.query, today = todayNairobi(), soon = addDays(today, 7), L = loader(store, req);
    let rows = await store.find('follow_ups', { ward_id: req.ward.id });
    if (q.bucket === 'overdue') rows = rows.filter((f) => f.status === 'open' && f.due_date < today);
    else if (q.bucket === 'due_soon') rows = rows.filter((f) => f.status === 'open' && f.due_date >= today && f.due_date <= soon);
    else if (q.bucket === 'open') rows = rows.filter((f) => f.status === 'open');
    else if (q.bucket === 'completed') rows = rows.filter((f) => f.status === 'completed');
    if (q.responsible_user_id) rows = rows.filter((f) => f.responsible_user_id === Number(q.responsible_user_id));
    if (q.mine === '1') rows = rows.filter((f) => f.responsible_user_id === req.user.id);
    if (q.entity_type) rows = rows.filter((f) => f.linked_entity_type === q.entity_type);
    if (q.entity_id) rows = rows.filter((f) => f.linked_entity_id === Number(q.entity_id));
    rows = [...rows].sort((a, b) => (b.status === 'open') - (a.status === 'open') || String(a.due_date).localeCompare(String(b.due_date))).slice(0, 500);
    const users = await L.users();
    const out = [];
    for (const f of rows) {
      out.push({ ...f, responsible_name: users.get(f.responsible_user_id)?.full_name ?? null,
        entity_name: await L.entityName(f.linked_entity_type, f.linked_entity_id), is_overdue: f.status === 'open' && f.due_date < today });
    }
    res.json(out);
  });

  const fuSpec = {
    action_required: { required: true, label: 'Action required' }, responsible_user_id: { type: 'int', required: true, label: 'Responsible officer' },
    due_date: { type: 'date', required: true, label: 'Due date' }, linked_entity_type: {}, linked_entity_id: { type: 'int' },
    linked_inspection_id: { type: 'int' }, linked_finding_id: { type: 'int' }
  };
  r.post('/follow-ups', requireRole('officer'), async (req, res) => {
    const L = loader(store, req);
    const { data, errors } = cleanFields(fuSpec, req.body || {});
    if (data.responsible_user_id && !(await L.memberIds()).has(data.responsible_user_id)) errors.responsible_user_id = 'Choose an active officer in this ward.';
    if (data.linked_entity_type && (!ENTITY_TYPES.includes(data.linked_entity_type) || !(await L.entityExists(data.linked_entity_type, data.linked_entity_id)))) errors.linked_entity_id = 'Linked record not found.';
    if (Object.keys(errors).length) return bad(res, errors);
    const id = await store.insert('follow_ups', {
      ward_id: req.ward.id, linked_entity_type: data.linked_entity_type ?? null, linked_entity_id: data.linked_entity_id ?? null,
      linked_inspection_id: data.linked_inspection_id ?? null, linked_finding_id: data.linked_finding_id ?? null, action_required: data.action_required,
      responsible_user_id: data.responsible_user_id, due_date: data.due_date, status: 'open', outcome: null, outcome_notes: null,
      next_step: null, completed_at: null, created_by: req.user.id
    });
    await audit(req, 'create', 'follow_up', id, data);
    res.status(201).json({ id });
  });

  r.patch('/follow-ups/:id', requireRole('officer'), async (req, res) => {
    const L = loader(store, req);
    const f = await store.get('follow_ups', req.params.id);
    if (!f || f.ward_id !== req.ward.id) return res.status(404).json({ error: 'Follow up not found.' });
    if (!isLead(req) && f.responsible_user_id !== req.user.id && f.created_by !== req.user.id) return res.status(403).json({ error: 'Only the responsible officer or ward lead can update this follow up.' });
    const b = req.body || {}, errors = {};
    const upd = {};
    if (b.due_date !== undefined) { if (!isValidDate(b.due_date)) errors.due_date = 'Enter a valid date.'; else upd.due_date = b.due_date; }
    if (b.responsible_user_id !== undefined) {
      if (!isLead(req)) errors.responsible_user_id = 'Only the ward lead can reassign.';
      else if (!(await L.memberIds()).has(Number(b.responsible_user_id))) errors.responsible_user_id = 'Choose an active officer.';
      else upd.responsible_user_id = Number(b.responsible_user_id);
    }
    if (b.status === 'completed') {
      if (!['compliant', 'partial', 'non_compliant'].includes(b.outcome)) errors.outcome = 'Record the revisit outcome: compliant, partial or non compliant.';
      Object.assign(upd, { status: 'completed', outcome: b.outcome, outcome_notes: b.outcome_notes || null, next_step: b.next_step || null, completed_at: nowIso() });
    } else if (b.status === 'cancelled') {
      if (!b.outcome_notes) errors.outcome_notes = 'Explain why the follow up is cancelled.';
      Object.assign(upd, { status: 'cancelled', outcome_notes: b.outcome_notes || null });
    }
    if (b.next_follow_up && !isValidDate(b.next_follow_up.due_date || '')) errors.next_due = 'Enter a valid date for the next follow up.';
    if (Object.keys(errors).length) return bad(res, errors);
    if (Object.keys(upd).length) await store.update('follow_ups', f.id, upd);
    if (f.linked_finding_id && upd.outcome) {
      const map = { compliant: 'resolved', partial: 'partially_resolved', non_compliant: 'unresolved' };
      const st = map[upd.outcome];
      await store.update('inspection_findings', f.linked_finding_id, { status: st, resolved_at: st === 'resolved' ? nowIso() : null });
    }
    if (b.next_follow_up) {
      await store.insert('follow_ups', {
        ward_id: f.ward_id, linked_entity_type: f.linked_entity_type, linked_entity_id: f.linked_entity_id, linked_inspection_id: f.linked_inspection_id,
        linked_finding_id: f.linked_finding_id, action_required: b.next_follow_up.action_required || f.action_required,
        responsible_user_id: upd.responsible_user_id || f.responsible_user_id, due_date: b.next_follow_up.due_date, status: 'open',
        outcome: null, outcome_notes: null, next_step: null, completed_at: null, created_by: req.user.id
      });
    }
    await audit(req, upd.status ? 'status_change' : 'update', 'follow_up', f.id, upd);
    res.json({ ok: true });
  });

  // ---------- Reminders (in app) ----------
  r.get('/reminders', async (req, res) => {
    const rows = (await store.find('reminders', { user_id: req.user.id })).filter((x) => x.status === 'sent');
    res.json(sortBy(rows, '-sent_at').slice(0, 30));
  });
  r.post('/reminders/read-all', async (req, res) => {
    const t = nowIso();
    for (const x of await store.find('reminders', { user_id: req.user.id })) if (!x.read_at) await store.update('reminders', x.id, { read_at: t }, { touch: false });
    res.json({ ok: true });
  });

  // ---------- Team view (ward lead only) ----------
  r.get('/team', requireRole('ward_lead'), async (req, res) => {
    const w = req.ward.id, now = nowIso(), today = todayNairobi(), wk = weekRange(today), L = loader(store, req);
    const s = eatStartIso(wk.start), e = eatStartIso(addDays(wk.end, 1));
    const [mems, users, tasks, acts, fus, facilities] = await Promise.all([
      store.find('memberships', { ward_id: w }), L.users(), wardTasks(w), wardActivities(w), store.find('follow_ups', { ward_id: w }),
      store.find('healthcare_facilities', { ward_id: w })
    ]);
    const people = new Map();
    for (const m of mems) {
      const u = users.get(m.user_id);
      if (!u || !isActive(u.active)) continue;
      const p = people.get(u.id) || { id: u.id, full_name: u.full_name, email: u.email, roles: new Set() };
      p.roles.add(m.role);
      people.set(u.id, p);
    }
    const officers = sortBy([...people.values()], 'full_name').map((o) => ({
      id: o.id, full_name: o.full_name, email: o.email, roles: [...o.roles].join(','),
      open_tasks: tasks.filter((t) => t.assigned_to === o.id && isOpen(t)).length,
      overdue_tasks: tasks.filter((t) => t.assigned_to === o.id && isOpen(t) && t.due_at < now).length,
      completed_this_week: tasks.filter((t) => t.assigned_to === o.id && t.status === 'completed' && t.completed_at >= s && t.completed_at < e).length,
      activities_this_week: acts.filter((a) => a.recorded_by === o.id && a.activity_date >= wk.start && a.activity_date <= wk.end).length,
      overdue_follow_ups: fus.filter((f) => f.responsible_user_id === o.id && f.status === 'open' && f.due_date < today).length
    }));
    const facMap = new Map(facilities.map((f) => [f.id, f]));
    const facilitiesOverdue = sortBy(fus.filter((f) => f.linked_entity_type === 'facility' && f.status === 'open' && f.due_date < today && facMap.has(f.linked_entity_id)), 'due_date')
      .map((f) => ({ id: f.id, action_required: f.action_required, due_date: f.due_date, facility_name: facMap.get(f.linked_entity_id).facility_name,
        facility_id: f.linked_entity_id, responsible_name: users.get(f.responsible_user_id)?.full_name ?? null }));
    res.json({ week: wk, officers, facilitiesOverdue });
  });

  return r;
}

// Background job: create in app reminders when a task reminder time arrives or a follow up falls due.
// Each reminder has a deterministic key so it is created once even if the job runs on several servers.
export async function runReminders(store) {
  const now = nowIso(), today = todayNairobi();
  let n = 0;
  const add = async (userId, type, recordId, title, scheduledAt) => {
    if (!(await store.claim(`reminder_${userId}_${type}_${recordId}_${scheduledAt}`))) return;
    await store.insert('reminders', { user_id: userId, linked_record_type: type, linked_record_id: recordId, title, scheduled_at: scheduledAt,
      sent_at: now, read_at: null, channel: 'in_app', status: 'sent' }, { timestamps: false });
    n++;
  };
  for (const t of await store.all('tasks')) {
    if (t.deleted_at || !isOpen(t)) continue;
    if (t.reminder_at && t.reminder_at <= now) await add(t.assigned_to, 'task', t.id, `Reminder: ${t.title}`, t.reminder_at);
    if (t.due_at <= now) await add(t.assigned_to, 'task_overdue', t.id, `Overdue: ${t.title}`, t.due_at);
  }
  for (const f of await store.find('follow_ups', { status: 'open' })) {
    if (f.due_date <= today) await add(f.responsible_user_id, 'follow_up', f.id, `Follow up due: ${f.action_required}`, f.due_date);
  }
  return n;
}
