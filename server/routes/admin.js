import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { requireRole, requireWard, isLead } from '../auth.js';
import { makeAudit, bad, todayNairobi, weekRange, monthRange, asyncRouter, addDays } from '../util.js';
import { isValidDate } from '../registers.js';
import { buildReport, sourceRecords, reportToCsv } from '../reports.js';
import { sortBy, nowIso } from '../store.js';

export function adminRoutes(store) {
  const r = asyncRouter(express.Router());
  const audit = makeAudit(store);
  const adminOnly = (req, res, next) => (req.user.is_admin ? next() : res.status(403).json({ error: 'Administrator access required.' }));
  const yesterday = () => addDays(todayNairobi(), -1);

  // ---------- Users ----------
  r.get('/users', (req, res, next) => (req.user.is_admin || isLead(req) ? next() : res.status(403).json({ error: 'Not permitted.' })), async (req, res) => {
    const [users, mems, wards] = await Promise.all([store.all('users'), store.all('memberships'), store.byId('wards')]);
    const withWard = mems.map((m) => ({ ...m, ward_name: wards.get(m.ward_id)?.name ?? null }));
    const visible = req.user.is_admin ? users : users.filter((u) => mems.some((m) => m.user_id === u.id && m.ward_id === req.ward?.id));
    res.json(sortBy(visible, 'full_name').map((u) => ({
      id: u.id, full_name: u.full_name, email: u.email, phone: u.phone ?? null, active: u.active, is_admin: u.is_admin ? 1 : 0,
      last_login_at: u.last_login_at ?? null, created_at: u.created_at, memberships: withWard.filter((m) => m.user_id === u.id)
    })));
  });

  const tempPassword = () => crypto.randomBytes(6).toString('base64url') + '9a';

  r.post('/users', adminOnly, async (req, res) => {
    const b = req.body || {}, errors = {};
    if (!String(b.full_name || '').trim()) errors.full_name = 'Full name is required.';
    if (!/^\S+@\S+\.\S+$/.test(b.email || '')) errors.email = 'Enter a valid email address.';
    else if (await store.findOne('users', { email_lower: String(b.email).trim().toLowerCase() })) errors.email = 'A user with this email already exists.';
    const roles = Array.isArray(b.memberships) ? b.memberships : [];
    const wards = await store.byId('wards');
    for (const m of roles) if (!['officer', 'ward_lead', 'reviewer'].includes(m.role) || !wards.has(Number(m.ward_id))) errors.memberships = 'Each role needs a valid ward and role.';
    if (Object.keys(errors).length) return bad(res, errors);
    const pw = b.password && String(b.password).length >= 8 ? String(b.password) : tempPassword();
    const email = String(b.email).trim();
    const id = await store.insert('users', {
      full_name: String(b.full_name).trim(), email, email_lower: email.toLowerCase(), phone: b.phone || null,
      password_hash: bcrypt.hashSync(pw, 11), is_admin: b.is_admin ? 1 : 0, active: 1, last_login_at: null
    });
    for (const m of roles) await store.insert('memberships', { user_id: id, ward_id: Number(m.ward_id), role: m.role, active_from: todayNairobi(), active_to: null });
    await audit(req, 'create', 'user', id, { email, roles, is_admin: !!b.is_admin });
    res.status(201).json({ id, temporary_password: b.password ? undefined : pw });
  });

  r.patch('/users/:id', adminOnly, async (req, res) => {
    const u = await store.get('users', req.params.id);
    if (!u) return res.status(404).json({ error: 'User not found.' });
    const b = req.body || {};
    if (u.id === req.user.id && b.active === false) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    const upd = {};
    if (b.full_name !== undefined) upd.full_name = String(b.full_name).trim();
    if (b.phone !== undefined) upd.phone = b.phone || null;
    if (b.active !== undefined) upd.active = b.active ? 1 : 0;
    if (b.is_admin !== undefined && u.id !== req.user.id) upd.is_admin = b.is_admin ? 1 : 0;
    await store.update('users', u.id, upd);
    if (Array.isArray(b.memberships)) {
      // End current memberships (history kept) and add the new set
      for (const m of await store.find('memberships', { user_id: u.id })) if (!m.active_to) await store.update('memberships', m.id, { active_to: yesterday() });
      for (const m of b.memberships) await store.insert('memberships', { user_id: u.id, ward_id: Number(m.ward_id), role: m.role, active_from: todayNairobi(), active_to: null });
    }
    await audit(req, b.active === false ? 'deactivate' : b.active === true ? 'reactivate' : b.memberships ? 'role_change' : 'update', 'user', u.id, b);
    res.json({ ok: true });
  });

  r.post('/users/:id/reset-password', adminOnly, async (req, res) => {
    const u = await store.get('users', req.params.id);
    if (!u) return res.status(404).json({ error: 'User not found.' });
    const pw = tempPassword();
    await store.update('users', u.id, { password_hash: bcrypt.hashSync(pw, 11) });
    await audit(req, 'password_reset_by_admin', 'user', u.id);
    res.json({ temporary_password: pw });
  });

  // ---------- Wards & locations ----------
  r.get('/wards', async (req, res) => res.json(sortBy(await store.all('wards'), 'name')));
  r.post('/wards', adminOnly, async (req, res) => {
    const { name, code } = req.body || {};
    if (!String(name || '').trim()) return bad(res, { name: 'Ward name is required.' });
    const org = (await store.all('organisations'))[0];
    const id = await store.insert('wards', { organisation_id: org?.id ?? null, name: name.trim(), code: code || null, status: 'active' });
    await audit(req, 'create', 'ward', id, { name, code });
    res.status(201).json({ id });
  });
  r.post('/locations', requireWard, requireRole('ward_lead'), async (req, res) => {
    const b = req.body || {};
    if (!String(b.sub_location || '').trim()) return bad(res, { sub_location: 'Sub location is required.' });
    const id = await store.insert('locations', { ward_id: req.ward.id, sub_location: b.sub_location.trim(), village: b.village || null, landmark: b.landmark || null, latitude: null, longitude: null });
    await audit(req, 'create', 'location', id, b);
    res.status(201).json({ id });
  });

  // ---------- Categories ----------
  r.post('/categories', adminOnly, async (req, res) => {
    const b = req.body || {};
    if (!String(b.name || '').trim()) return bad(res, { name: 'Category name is required.' });
    const id = await store.insert('categories', { name: b.name.trim(), description: b.description || null, module_group: b.module_group || 'general', active: 1, updated_by: req.user.id });
    await audit(req, 'create', 'category', id, b);
    res.status(201).json({ id });
  });
  r.patch('/categories/:id', adminOnly, async (req, res) => {
    const c = await store.get('categories', req.params.id);
    if (!c) return res.status(404).json({ error: 'Category not found.' });
    const b = req.body || {};
    await store.update('categories', c.id, { name: b.name ?? c.name, description: b.description ?? c.description, active: b.active === undefined ? c.active : b.active ? 1 : 0, updated_by: req.user.id });
    await audit(req, 'update', 'category', c.id, b);
    res.json({ ok: true });
  });

  // ---------- Targets ----------
  r.get('/targets', requireWard, async (req, res) => {
    const [targets, cats, users] = await Promise.all([store.find('targets', { ward_id: req.ward.id }), store.byId('categories'), store.byId('users')]);
    const rows = targets.map((t) => ({ ...t, category: cats.get(t.category_id)?.name ?? null, officer_name: users.get(t.user_id)?.full_name ?? null, approved_by_name: users.get(t.approved_by)?.full_name ?? null }));
    res.json(sortBy(rows, '-period_start', 'category'));
  });
  r.post('/targets', requireWard, requireRole('ward_lead'), async (req, res) => {
    const b = req.body || {}, errors = {};
    if (!(await store.get('categories', Number(b.category_id) || 0))) errors.category_id = 'Choose a category.';
    if (!['weekly', 'monthly'].includes(b.period_type)) errors.period_type = 'Choose weekly or monthly.';
    if (!(Number(b.target_value) >= 0) || b.target_value === '' || b.target_value === null) errors.target_value = 'Target must be zero or more.';
    let range;
    if (b.period_type === 'weekly') { if (!isValidDate(b.period_date || '')) errors.period_date = 'Pick a date in the target week.'; else range = weekRange(b.period_date); }
    if (b.period_type === 'monthly') { if (!/^\d{4}-\d{2}$/.test(b.period_month || '')) errors.period_month = 'Pick the target month.'; else range = monthRange(b.period_month); }
    if (Object.keys(errors).length) return bad(res, errors);
    const id = await store.insert('targets', {
      ward_id: req.ward.id, category_id: Number(b.category_id), user_id: b.user_id ? Number(b.user_id) : null, period_type: b.period_type,
      period_start: range.start, period_end: range.end, target_value: Number(b.target_value), unit: b.unit || 'activities',
      approved_by: req.user.id, created_by: req.user.id
    });
    await audit(req, 'create', 'target', id, { ...b, ...range });
    res.status(201).json({ id });
  });
  r.delete('/targets/:id', requireWard, requireRole('ward_lead'), async (req, res) => {
    const t = await store.get('targets', req.params.id);
    if (!t || t.ward_id !== req.ward.id) return res.status(404).json({ error: 'Target not found.' });
    await store.remove('targets', t.id);
    await audit(req, 'delete', 'target', t.id, t);
    res.json({ ok: true });
  });

  // ---------- Notice templates & checklists ----------
  r.get('/templates', async (req, res) => res.json(sortBy(await store.all('notice_templates'), 'name')));
  r.post('/templates', adminOnly, async (req, res) => {
    const b = req.body || {};
    if (!b.name || !b.body) return bad(res, { name: 'Name and body are required.' });
    const id = await store.insert('notice_templates', { name: b.name, body: b.body, approved: 1, active: 1, updated_by: req.user.id });
    await audit(req, 'create', 'notice_template', id, { name: b.name });
    res.status(201).json({ id });
  });
  r.patch('/templates/:id', adminOnly, async (req, res) => {
    const t = await store.get('notice_templates', req.params.id);
    if (!t) return res.status(404).json({ error: 'Template not found.' });
    const b = req.body || {};
    await store.update('notice_templates', t.id, { name: b.name ?? t.name, body: b.body ?? t.body, active: b.active === undefined ? t.active : b.active ? 1 : 0, updated_by: req.user.id });
    await audit(req, 'update', 'notice_template', t.id, { name: b.name });
    res.json({ ok: true });
  });
  r.post('/checklists', adminOnly, async (req, res) => {
    const { entity_type, items } = req.body || {};
    if (!entity_type || !Array.isArray(items) || !items.length) return bad(res, { items: 'Provide at least one checklist item.' });
    const existing = await store.find('checklists', { entity_type });
    const v = Math.max(0, ...existing.map((c) => c.version || 0)) + 1;
    for (const c of existing) if (c.active) await store.update('checklists', c.id, { active: 0 });
    const id = await store.insert('checklists', { entity_type, version: v, items, active: 1, created_by: req.user.id });
    await audit(req, 'create', 'checklist', id, { entity_type, version: v });
    res.status(201).json({ id, version: v });
  });

  // ---------- Audit history (read only) ----------
  r.get('/audit', async (req, res) => {
    if (!req.user.is_admin && req.role !== 'reviewer' && req.role !== 'ward_lead') return res.status(403).json({ error: 'Not permitted.' });
    const q = req.query;
    let rows = req.user.is_admin ? await store.all('audit_events') : await store.find('audit_events', { ward_id: req.ward?.id ?? -1 });
    if (q.entity_type) rows = rows.filter((a) => a.entity_type === q.entity_type);
    if (q.action) rows = rows.filter((a) => a.action === q.action);
    if (q.user_id) rows = rows.filter((a) => a.actor_user_id === Number(q.user_id));
    const users = await store.byId('users');
    res.json(sortBy(rows, '-id').slice(0, 300).map((a) => ({ ...a, actor_name: users.get(a.actor_user_id)?.full_name ?? null })));
  });

  // ---------- Reports ----------
  const resolvePeriod = (q) => {
    if (q.type === 'weekly') { const d = isValidDate(q.date || '') ? q.date : todayNairobi(); return { type: 'weekly', ...weekRange(d) }; }
    const m = /^\d{4}-\d{2}$/.test(q.month || '') ? q.month : todayNairobi().slice(0, 7);
    return { type: 'monthly', ...monthRange(m) };
  };
  const resolveScope = async (req) => {
    if (!isLead(req) && req.role !== 'reviewer') return { scopeUserId: req.user.id, label: `Officer: ${req.user.full_name}` };
    if (req.query.scope && req.query.scope.startsWith('user:')) {
      const u = await store.get('users', Number(req.query.scope.slice(5)) || 0);
      if (u) return { scopeUserId: u.id, label: `Officer: ${u.full_name}` };
    }
    if (req.query.scope === 'me') return { scopeUserId: req.user.id, label: `Officer: ${req.user.full_name}` };
    return { scopeUserId: null, label: 'Whole ward team' };
  };
  const logRun = (req, per, scope, format = null) => store.insert('report_runs', {
    ward_id: req.ward.id, report_type: per.type, period_start: per.start, period_end: per.end, generated_by: req.user.id,
    generated_at: nowIso(), filters: JSON.stringify({ scope: scope.label }), export_format: format
  }, { timestamps: false });

  r.get('/reports', requireWard, async (req, res) => {
    const per = resolvePeriod(req.query), scope = await resolveScope(req);
    const report = await buildReport(store, { wardId: req.ward.id, type: per.type, start: per.start, end: per.end, scopeUserId: scope.scopeUserId });
    await logRun(req, per, scope);
    res.json({ ...report, meta: { ...report.meta, ward: req.ward.name, scope: scope.label } });
  });

  r.get('/reports/source', requireWard, async (req, res) => {
    const per = resolvePeriod(req.query), scope = await resolveScope(req);
    res.json(await sourceRecords(store, { wardId: req.ward.id, categoryId: req.query.category_id ? Number(req.query.category_id) : null, start: per.start, end: per.end, scopeUserId: scope.scopeUserId }));
  });

  r.get('/reports/export.csv', requireWard, async (req, res) => {
    const per = resolvePeriod(req.query), scope = await resolveScope(req);
    const report = await buildReport(store, { wardId: req.ward.id, type: per.type, start: per.start, end: per.end, scopeUserId: scope.scopeUserId });
    await logRun(req, per, scope, 'csv');
    await audit(req, 'export', 'report', null, { type: per.type, start: per.start, end: per.end, format: 'csv', scope: scope.label });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="afyatrack-${per.type}-${per.start}.csv"`);
    res.send(reportToCsv(report, req.ward.name, scope.label));
  });

  r.post('/reports/printed', requireWard, async (req, res) => {
    await audit(req, 'export', 'report', null, { ...req.body, format: 'pdf/print' });
    res.json({ ok: true });
  });

  return r;
}
