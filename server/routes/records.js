import express from 'express';
import { requireRole, requireWard, isLead } from '../auth.js';
import { REGISTERS, ENTITY_TYPES, cleanFields, isValidDate } from '../registers.js';
import { makeAudit, todayNairobi, diff, bad, asyncRouter, nowIso } from '../util.js';
import { loader } from '../ctx.js';
import { sortBy, isActive } from '../store.js';

const STATUS_FIELD = { premises: 'licence_status', handler: 'status', household: 'sanitation_status', water_source: 'status', facility: 'incinerator_status' };
const FACILITY_STATUS_KEYS = ['water_supply_status', 'toilet_status', 'drainage_status', 'cleaning_status', 'waste_management_status', 'incinerator_status', 'pest_control_status'];

/** Default values for a new register document (what the SQL column defaults used to give). */
export function registerDefaults(reg) {
  const d = {};
  for (const [k, rule] of Object.entries(reg.fields)) d[k] = rule.enum?.includes('unknown') ? 'unknown' : rule.type === 'bool' ? 1 : null;
  if (reg.table === 'food_premises') d.licence_status = 'unknown';
  return d;
}

export function recordRoutes(store) {
  const r = asyncRouter(express.Router());
  const audit = makeAudit(store);
  r.use(requireWard);

  const getReg = (req, res) => {
    const reg = REGISTERS[req.params.type];
    if (!reg) { res.status(404).json({ error: 'Unknown register.' }); return null; }
    return reg;
  };
  const hideRestricted = (req, reg, row) => {
    if (req.role !== 'reviewer' || !reg.restricted) return row;
    const out = { ...row };
    for (const k of reg.restricted) if (k in out) out[k] = out[k] ? '••• restricted' : null;
    return out;
  };
  const getInWard = async (table, id, wardId) => {
    const row = await store.get(table, id);
    return row && row.ward_id === wardId ? row : null;
  };

  // ---------- Registers (generic) ----------
  r.get('/registers/:type', async (req, res) => {
    const reg = getReg(req, res); if (!reg) return;
    const type = req.params.type, q = req.query, w = req.ward.id, L = loader(store, req);
    const [rowsAll, locs, users, inspections, fus, premises] = await Promise.all([
      store.find(reg.table, { ward_id: w }), L.locations(), L.users(), store.find('inspections', { ward_id: w, entity_type: type }),
      store.find('follow_ups', { ward_id: w, linked_entity_type: type, status: 'open' }),
      type === 'handler' ? L.entities('premises') : Promise.resolve(new Map())
    ]);
    let rows = rowsAll;
    if (q.active !== 'all') rows = rows.filter((x) => (q.active === '0' ? !isActive(x.active) : isActive(x.active)));
    if (q.q) { const s = String(q.q).toLowerCase(); rows = rows.filter((x) => reg.search.some((f) => String(x[f] ?? '').toLowerCase().includes(s))); }
    if (q.status) rows = rows.filter((x) => x[STATUS_FIELD[type]] === q.status);
    if (q.location_id && reg.fields.location_id) rows = rows.filter((x) => x.location_id === Number(q.location_id));
    if (q.sub_location && reg.fields.location_id) rows = rows.filter((x) => locs.get(x.location_id)?.sub_location === q.sub_location);
    if (q.officer_id && reg.fields.assigned_officer_id) rows = rows.filter((x) => x.assigned_officer_id === Number(q.officer_id));
    if (q.premises_id && type === 'handler') rows = rows.filter((x) => x.premises_id === Number(q.premises_id));
    const lastInsp = new Map();
    for (const i of inspections) if (!lastInsp.has(i.entity_id) || i.inspection_date > lastInsp.get(i.entity_id)) lastInsp.set(i.entity_id, i.inspection_date);
    const openFu = new Map();
    for (const f of fus) openFu.set(f.linked_entity_id, (openFu.get(f.linked_entity_id) || 0) + 1);
    rows = sortBy(rows, reg.nameField).slice(0, 1000).map((x) => {
      const out = { ...x, last_inspection: lastInsp.get(x.id) ?? null, open_follow_ups: openFu.get(x.id) || 0 };
      if (reg.fields.location_id) { const l = locs.get(x.location_id); out.sub_location = l?.sub_location ?? null; out.village = l?.village ?? null; }
      if (reg.fields.assigned_officer_id) out.officer_name = users.get(x.assigned_officer_id)?.full_name ?? null;
      if (type === 'handler') out.premises_name = premises.get(x.premises_id)?.premises_name ?? null;
      return hideRestricted(req, reg, out);
    });
    res.json(rows);
  });

  r.get('/registers/:type/:id', async (req, res) => {
    const reg = getReg(req, res); if (!reg) return;
    const type = req.params.type, w = req.ward.id, L = loader(store, req);
    const row = await getInWard(reg.table, req.params.id, w);
    if (!row) return res.status(404).json({ error: 'Record not found in your ward.' });
    const users = await L.users();
    const name = (id) => users.get(id)?.full_name ?? null;
    const [location, inspections, followUps, tasks, notices, auditRows] = await Promise.all([
      row.location_id ? store.get('locations', row.location_id) : null,
      store.find('inspections', { entity_type: type, entity_id: row.id }),
      store.find('follow_ups', { linked_entity_type: type, linked_entity_id: row.id }),
      store.find('tasks', { linked_entity_type: type, linked_entity_id: row.id }),
      store.find('notice_drafts', { linked_entity_type: type, linked_entity_id: row.id }),
      store.find('audit_events', { entity_type: type, entity_id: row.id })
    ]);
    const findingCounts = new Map();
    for (const i of inspections) findingCounts.set(i.id, (await store.find('inspection_findings', { inspection_id: i.id })).length);
    const extra = {};
    if (type === 'water_source') extra.samples = sortBy(await store.find('water_samples', { water_source_id: row.id }), '-collection_date').map((s) => ({ ...s, recorded_by_name: name(s.recorded_by) }));
    if (type === 'premises') extra.handlers = sortBy((await store.find('food_handlers', { premises_id: row.id })).filter((h) => isActive(h.active)), 'name')
      .map(({ id, name: n, certificate_expiry, status }) => ({ id, name: n, certificate_expiry, status }));
    if (type === 'handler' && row.premises_id) { const p = await store.get('food_premises', row.premises_id); extra.premises = p ? { id: p.id, premises_name: p.premises_name } : null; }
    res.json({
      record: hideRestricted(req, reg, row),
      location,
      inspections: sortBy(inspections, '-inspection_date', '-id').map((i) => ({ ...i, officer_name: name(i.officer_id), finding_count: findingCounts.get(i.id) || 0 })),
      followUps: sortBy(followUps, '-due_date').map((f) => ({ ...f, responsible_name: name(f.responsible_user_id) })),
      tasks: sortBy(tasks.filter((t) => !t.deleted_at), '-due_at').map((t) => ({ id: t.id, title: t.title, status: t.status, due_at: t.due_at, assigned_name: name(t.assigned_to) })),
      notices: sortBy(notices, '-id').map(({ id, draft_reference, status, created_at, compliance_deadline }) => ({ id, draft_reference, status, created_at, compliance_deadline })),
      history: sortBy(auditRows, '-id').slice(0, 30).map((a) => ({ at: a.at, action: a.action, change_summary: a.change_summary, full_name: name(a.actor_user_id) })),
      ...extra
    });
  });

  r.post('/registers/:type', requireRole('officer'), async (req, res) => {
    const reg = getReg(req, res); if (!reg) return;
    const L = loader(store, req);
    const { data, errors } = cleanFields(reg.fields, req.body || {});
    if (data.location_id && !(await L.locations()).has(data.location_id)) errors.location_id = 'Location not in this ward.';
    if (data.premises_id && !(await L.entityExists('premises', data.premises_id))) errors.premises_id = 'Premises not in this ward.';
    if (Object.keys(errors).length) return bad(res, errors);
    if (reg.duplicateCheck && !req.body.confirm_duplicate) {
      const name = String(data[reg.nameField]).toLowerCase();
      const dups = [...(await L.entities(req.params.type)).values()]
        .filter((x) => { const n = String(x[reg.nameField] || '').toLowerCase(); return n.includes(name) || name.includes(n); })
        .map((x) => ({ id: x.id, name: x[reg.nameField], location_id: x.location_id ?? null }));
      if (dups.length) return res.status(409).json({ error: 'Possible duplicate: a record with a similar name already exists.', duplicates: dups });
    }
    const id = await store.insert(reg.table, { ...registerDefaults(reg), ...data, ward_id: req.ward.id });
    await audit(req, 'create', req.params.type, id, data);
    res.status(201).json({ id });
  });

  r.patch('/registers/:type/:id', requireRole('officer'), async (req, res) => {
    const reg = getReg(req, res); if (!reg) return;
    const L = loader(store, req);
    const row = await getInWard(reg.table, req.params.id, req.ward.id);
    if (!row) return res.status(404).json({ error: 'Record not found in your ward.' });
    const { data, errors } = cleanFields(reg.fields, req.body || {}, { partial: true });
    if ('active' in data && data.active === 0 && !isLead(req)) errors.active = 'Only the ward lead can deactivate a register entry.';
    if (data.location_id && !(await L.locations()).has(data.location_id)) errors.location_id = 'Location not in this ward.';
    if (Object.keys(errors).length) return bad(res, errors);
    if (!Object.keys(data).length) return res.json({ ok: true });
    const changes = diff(row, data);
    await store.update(reg.table, row.id, data);
    await audit(req, 'update', req.params.type, row.id, changes);
    res.json({ ok: true });
  });

  // ---------- Water samples ----------
  const sampleSpec = {
    collection_date: { type: 'date', required: true, label: 'Collection date' }, sample_reference: {}, laboratory: {}, result: {},
    compliance_status: { enum: ['pending_result', 'compliant', 'non_compliant', 'unknown'] }, result_date: { type: 'date' }, next_action_due: { type: 'date' }
  };
  const checkSample = (d, errors, existing = {}) => {
    const m = { ...existing, ...d };
    if (['compliant', 'non_compliant'].includes(m.compliance_status) && (!m.result || !m.result_date))
      errors.compliance_status = 'A compliance status needs a recorded result and result date. Keep it as pending result until the lab result is in.';
    if (m.result_date && m.collection_date && m.result_date < m.collection_date) errors.result_date = 'Result date cannot be before the collection date.';
    if (m.collection_date && m.collection_date > todayNairobi()) errors.collection_date = 'Collection date cannot be in the future.';
  };
  r.post('/registers/water_source/:id/samples', requireRole('officer'), async (req, res) => {
    const src = await getInWard('water_sources', req.params.id, req.ward.id);
    if (!src) return res.status(404).json({ error: 'Water source not found.' });
    const { data, errors } = cleanFields(sampleSpec, req.body || {});
    if (!data.compliance_status) data.compliance_status = 'pending_result';
    checkSample(data, errors);
    if (Object.keys(errors).length) return bad(res, errors);
    const id = await store.insert('water_samples', {
      sample_reference: null, laboratory: null, result: null, result_date: null, next_action_due: null,
      ...data, ward_id: req.ward.id, water_source_id: src.id, recorded_by: req.user.id
    });
    const cat = (await store.find('categories', { module_group: 'water_sample' })).find((c) => isActive(c.active));
    if (cat) await store.insert('activity_records', {
      ward_id: req.ward.id, category_id: cat.id, activity_date: data.collection_date, recorded_by: req.user.id, location_id: src.location_id ?? null,
      linked_entity_type: 'water_source', linked_entity_id: src.id, linked_task_id: null, linked_inspection_id: null,
      outcome: 'Sample collected', notes: null, quantity: 1, unit: 'samples', deleted_at: null
    });
    await audit(req, 'create', 'water_sample', id, data);
    res.status(201).json({ id });
  });
  r.patch('/samples/:id', requireRole('officer'), async (req, res) => {
    const s = await getInWard('water_samples', req.params.id, req.ward.id);
    if (!s) return res.status(404).json({ error: 'Sample not found.' });
    const { data, errors } = cleanFields(sampleSpec, req.body || {}, { partial: true });
    checkSample(data, errors, s);
    if (Object.keys(errors).length) return bad(res, errors);
    await store.update('water_samples', s.id, data);
    await audit(req, 'update', 'water_sample', s.id, diff(s, data));
    res.json({ ok: true });
  });

  // ---------- Checklists ----------
  const activeChecklist = async (type) => sortBy((await store.find('checklists', { entity_type: type })).filter((c) => isActive(c.active)), '-version')[0] || null;
  r.get('/checklists/:entityType', async (req, res) => {
    const c = await activeChecklist(req.params.entityType);
    res.json(c ? { ...c, items: Array.isArray(c.items) ? c.items : JSON.parse(c.items || '[]') } : { entity_type: req.params.entityType, version: 0, items: [] });
  });

  // ---------- Inspections ----------
  r.get('/inspections', async (req, res) => {
    const q = req.query, L = loader(store, req);
    let rows = await store.find('inspections', { ward_id: req.ward.id });
    if (q.entity_type) rows = rows.filter((i) => i.entity_type === q.entity_type);
    if (q.from) rows = rows.filter((i) => i.inspection_date >= q.from);
    if (q.to) rows = rows.filter((i) => i.inspection_date <= q.to);
    if (q.officer_id) rows = rows.filter((i) => i.officer_id === Number(q.officer_id));
    if (q.risk_level) rows = rows.filter((i) => i.risk_level === q.risk_level);
    rows = sortBy(rows, '-inspection_date', '-id').slice(0, 500);
    const users = await L.users();
    const out = [];
    for (const i of rows) {
      const f = await store.find('inspection_findings', { inspection_id: i.id });
      out.push({ ...i, officer_name: users.get(i.officer_id)?.full_name ?? null, finding_count: f.length,
        open_findings: f.filter((x) => x.status !== 'resolved').length, entity_name: await L.entityName(i.entity_type, i.entity_id) });
    }
    res.json(out);
  });

  r.get('/inspections/:id', async (req, res) => {
    const L = loader(store, req);
    const i = await getInWard('inspections', req.params.id, req.ward.id);
    if (!i) return res.status(404).json({ error: 'Inspection not found.' });
    const users = await L.users();
    const name = (id) => users.get(id)?.full_name ?? null;
    const [findings, followUps, notices] = await Promise.all([
      store.find('inspection_findings', { inspection_id: i.id }), store.find('follow_ups', { linked_inspection_id: i.id }),
      store.find('notice_drafts', { inspection_id: i.id })
    ]);
    res.json({
      ...i, officer_name: name(i.officer_id),
      checklist_results: Array.isArray(i.checklist_results) ? i.checklist_results : JSON.parse(i.checklist_results || '[]'),
      findings: sortBy(findings, 'id').map((f) => ({ ...f, responsible_name: name(f.responsible_user_id) })),
      followUps: sortBy(followUps, 'id').map((f) => ({ ...f, responsible_name: name(f.responsible_user_id) })),
      notices: notices.map(({ id, draft_reference, status }) => ({ id, draft_reference, status })),
      entity_name: await L.entityName(i.entity_type, i.entity_id)
    });
  });

  r.post('/inspections', requireRole('officer'), async (req, res) => {
    const b = req.body || {}, errors = {}, L = loader(store, req);
    if (!ENTITY_TYPES.includes(b.entity_type)) errors.entity_type = 'Choose what is being inspected.';
    const reg = REGISTERS[b.entity_type];
    const entity = reg ? await getInWard(reg.table, Number(b.entity_id) || 0, req.ward.id) : null;
    if (reg && !entity) errors.entity_id = 'Select a register entry in your ward.';
    if (!isValidDate(b.inspection_date || '')) errors.inspection_date = 'Enter a valid inspection date.';
    else if (b.inspection_date > todayNairobi()) errors.inspection_date = 'Inspection date cannot be in the future.';
    if (b.next_visit_due && !isValidDate(b.next_visit_due)) errors.next_visit_due = 'Enter a valid date.';
    if (b.risk_level && !['unknown', 'low', 'medium', 'high'].includes(b.risk_level)) errors.risk_level = 'Choose low, medium or high.';
    const findings = Array.isArray(b.findings_list) ? b.findings_list.filter((f) => f && String(f.finding || '').trim()) : [];
    const officers = new Set((await store.find('memberships', { ward_id: req.ward.id })).map((m) => m.user_id));
    findings.forEach((f, idx) => {
      if (f.deadline && !isValidDate(f.deadline)) errors[`finding_${idx}`] = `Finding ${idx + 1}: enter a valid deadline.`;
      if (f.responsible_user_id && !officers.has(Number(f.responsible_user_id))) errors[`finding_${idx}`] = `Finding ${idx + 1}: responsible officer must be in this ward.`;
    });
    if (Object.keys(errors).length) return bad(res, errors);

    const checklist = await activeChecklist(b.entity_type);
    const inspectionId = await store.insert('inspections', {
      ward_id: req.ward.id, entity_type: b.entity_type, entity_id: entity.id, inspection_date: b.inspection_date, officer_id: req.user.id,
      checklist_version: checklist?.version ?? null, checklist_results: Array.isArray(b.checklist_results) ? b.checklist_results : [],
      findings: b.findings || null, risk_level: b.risk_level || 'unknown', outcome: b.outcome || null, next_visit_due: b.next_visit_due || null,
      notice_required: b.notice_required ? 1 : 0
    });
    for (const f of findings) {
      const responsible = f.responsible_user_id ? Number(f.responsible_user_id) : req.user.id;
      const fid = await store.insert('inspection_findings', {
        inspection_id: inspectionId, finding: String(f.finding).trim(), required_action: f.required_action || null,
        deadline: f.deadline || null, responsible_user_id: responsible, status: 'open', resolved_at: null
      });
      if (f.deadline && b.create_follow_ups !== false) {
        await store.insert('follow_ups', {
          ward_id: req.ward.id, linked_entity_type: b.entity_type, linked_entity_id: entity.id, linked_inspection_id: inspectionId,
          linked_finding_id: fid, action_required: f.required_action || `Recheck: ${f.finding}`, responsible_user_id: responsible,
          due_date: f.deadline, status: 'open', outcome: null, outcome_notes: null, next_step: null, completed_at: null, created_by: req.user.id
        });
      }
    }
    const cat = (await store.find('categories', { module_group: b.entity_type })).find((c) => isActive(c.active));
    if (b.next_visit_due && b.create_next_visit_task !== false) {
      const tid = await store.insert('tasks', {
        ward_id: req.ward.id, title: `Revisit: ${entity[reg.nameField]}`, description: null, category_id: cat?.id ?? null,
        assigned_to: req.user.id, created_by: req.user.id, due_at: new Date(b.next_visit_due + 'T09:00:00+03:00').toISOString(),
        reminder_at: null, status: 'planned', priority: 'normal', location_id: entity.location_id ?? null, linked_entity_type: b.entity_type,
        linked_entity_id: entity.id, status_reason: null, next_action: null, notes: null, completed_at: null, completed_by: null, deleted_at: null
      });
      await store.insert('task_history', { task_id: tid, user_id: req.user.id, at: nowIso(), field: 'created', old_value: null, new_value: b.next_visit_due, reason: null }, { timestamps: false });
    }
    // One activity record per inspection (unique claim): prevents double counting in reports.
    if (cat && (await store.claim(`activity_inspection_${inspectionId}`))) {
      await store.insert('activity_records', {
        ward_id: req.ward.id, category_id: cat.id, activity_date: b.inspection_date, recorded_by: req.user.id, location_id: entity.location_id ?? null,
        linked_entity_type: b.entity_type, linked_entity_id: entity.id, linked_inspection_id: inspectionId, linked_task_id: null,
        outcome: b.outcome || null, notes: null, quantity: 1, unit: 'visits', deleted_at: null
      });
    }
    // Update the register's summary fields
    if (b.entity_type === 'water_source') await store.update('water_sources', entity.id, { last_inspection_date: b.inspection_date, next_inspection_due: b.next_visit_due || entity.next_inspection_due || null });
    if (b.entity_type === 'household') await store.update('households', entity.id, { last_visit_date: b.inspection_date, follow_up_due: b.next_visit_due || entity.follow_up_due || null });
    if (b.entity_type === 'facility' && b.facility_status) {
      const upd = {};
      for (const k of FACILITY_STATUS_KEYS) if (b.facility_status[k]) upd[k] = b.facility_status[k];
      if (Object.keys(upd).length) await store.update('healthcare_facilities', entity.id, upd);
    }
    await audit(req, 'create', 'inspection', inspectionId, { entity_type: b.entity_type, entity_id: entity.id, findings: findings.length });
    res.status(201).json({ id: inspectionId });
  });

  r.patch('/findings/:id', requireRole('officer'), async (req, res) => {
    const f = await store.get('inspection_findings', req.params.id);
    const insp = f ? await store.get('inspections', f.inspection_id) : null;
    if (!f || !insp || insp.ward_id !== req.ward.id) return res.status(404).json({ error: 'Finding not found.' });
    const st = req.body?.status;
    if (!['open', 'resolved', 'partially_resolved', 'unresolved'].includes(st)) return bad(res, { status: 'Choose a valid status.' });
    await store.update('inspection_findings', f.id, { status: st, resolved_at: st === 'resolved' ? nowIso() : null });
    await audit(req, 'status_change', 'inspection_finding', f.id, { from: f.status, to: st });
    res.json({ ok: true });
  });

  // ---------- Notice drafts ----------
  const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `[${k}]`);
  const fmtDate = (d) => d ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '[date]';

  r.get('/notices', async (req, res) => {
    const L = loader(store, req);
    let rows = await store.find('notice_drafts', { ward_id: req.ward.id });
    if (req.query.status) rows = rows.filter((n) => n.status === req.query.status);
    const [users, templates] = await Promise.all([L.users(), store.byId('notice_templates')]);
    const out = [];
    for (const n of sortBy(rows, '-id')) {
      out.push({ id: n.id, draft_reference: n.draft_reference, status: n.status, recipient: n.recipient, linked_entity_type: n.linked_entity_type,
        linked_entity_id: n.linked_entity_id, compliance_deadline: n.compliance_deadline, created_at: n.created_at,
        template_name: templates.get(n.template_id)?.name ?? null, prepared_by_name: users.get(n.prepared_by)?.full_name ?? null,
        entity_name: await L.entityName(n.linked_entity_type, n.linked_entity_id) });
    }
    res.json(out);
  });

  r.get('/notices/:id', async (req, res) => {
    const L = loader(store, req);
    const n = await getInWard('notice_drafts', req.params.id, req.ward.id);
    if (!n) return res.status(404).json({ error: 'Notice not found.' });
    const [users, tpl] = await Promise.all([L.users(), store.get('notice_templates', n.template_id)]);
    res.json({ ...n, template_name: tpl?.name ?? null, prepared_by_name: users.get(n.prepared_by)?.full_name ?? null,
      reviewed_by_name: users.get(n.reviewed_by)?.full_name ?? null, entity_name: await L.entityName(n.linked_entity_type, n.linked_entity_id) });
  });

  r.post('/notices', requireRole('officer'), async (req, res) => {
    const b = req.body || {}, errors = {};
    const tpl = await store.get('notice_templates', Number(b.template_id) || 0);
    if (!tpl || !isActive(tpl.active) || !isActive(tpl.approved)) errors.template_id = 'Choose an approved template.';
    if (b.linked_entity_type && !ENTITY_TYPES.includes(b.linked_entity_type)) errors.linked_entity_type = 'Unknown record type.';
    const reg = REGISTERS[b.linked_entity_type];
    const entity = reg ? await getInWard(reg.table, Number(b.linked_entity_id) || 0, req.ward.id) : null;
    if (reg && !entity) errors.linked_entity_id = 'Linked record not found.';
    if (b.compliance_deadline && !isValidDate(b.compliance_deadline)) errors.compliance_deadline = 'Enter a valid compliance deadline.';
    if (!String(b.recipient || '').trim()) errors.recipient = 'Recipient is required so the notice is addressed correctly.';
    if (Object.keys(errors).length) return bad(res, errors);
    const loc = entity?.location_id ? await store.get('locations', entity.location_id) : null;
    const id = await store.nextId('notice_drafts');
    const ref = `DRAFT/${req.ward.code || 'W' + req.ward.id}/${new Date().getFullYear()}/${String(id).padStart(4, '0')}`;
    const content = fill(tpl.body, {
      reference: ref, recipient: b.recipient, entity_name: entity ? entity[reg.nameField] : '[premises]',
      location: loc ? [loc.village, loc.sub_location].filter(Boolean).join(', ') : '[location]', findings: b.findings || '[findings]',
      corrective_action: b.corrective_action || '[corrective action]', compliance_deadline: fmtDate(b.compliance_deadline),
      officer_name: req.user.full_name, ward: req.ward.name, date: fmtDate(todayNairobi())
    });
    const t = nowIso();
    await store.db.collection('notice_drafts').doc(String(id)).set({
      id, ward_id: req.ward.id, linked_entity_type: b.linked_entity_type || null, linked_entity_id: entity?.id ?? null,
      inspection_id: b.inspection_id ? Number(b.inspection_id) : null, template_id: tpl.id, draft_reference: ref, recipient: b.recipient,
      findings: b.findings || null, corrective_action: b.corrective_action || null, compliance_deadline: b.compliance_deadline || null,
      content, version: 1, prepared_by: req.user.id, reviewed_by: null, status: 'draft', issue_date: null, service_date: null,
      service_method: null, service_notes: null, created_at: t, updated_at: t
    });
    await audit(req, 'create', 'notice_draft', id, { template: tpl.name, ref });
    res.status(201).json({ id });
  });

  r.patch('/notices/:id', requireRole('officer'), async (req, res) => {
    const n = await getInWard('notice_drafts', req.params.id, req.ward.id);
    if (!n) return res.status(404).json({ error: 'Notice not found.' });
    if (n.status !== 'draft') return res.status(409).json({ error: 'Only drafts can be edited. Approved notices are locked.' });
    const content = String(req.body?.content ?? '').trim();
    if (!content) return bad(res, { content: 'Notice content cannot be empty.' });
    await store.update('notice_drafts', n.id, { content, version: (n.version || 1) + 1 });
    await audit(req, 'update', 'notice_draft', n.id, { version: (n.version || 1) + 1 });
    res.json({ ok: true });
  });

  // Status transitions: draft -> approved (ward lead) -> issued -> served. Each recorded only when the real action happened.
  r.post('/notices/:id/:action(approve|issue|serve|withdraw)', requireRole('officer'), async (req, res) => {
    const n = await getInWard('notice_drafts', req.params.id, req.ward.id);
    if (!n) return res.status(404).json({ error: 'Notice not found.' });
    const a = req.params.action, b = req.body || {}, today = todayNairobi();
    if (a === 'approve') {
      if (!isLead(req)) return res.status(403).json({ error: 'Only the ward lead can approve a notice.' });
      if (n.status !== 'draft') return res.status(409).json({ error: 'Only drafts can be approved.' });
      const ref = n.draft_reference.replace(/^DRAFT\//, 'NTC/');
      await store.update('notice_drafts', n.id, { status: 'approved', reviewed_by: req.user.id, draft_reference: ref, content: String(n.content || '').split(n.draft_reference).join(ref) });
    } else if (a === 'issue') {
      if (n.status !== 'approved') return res.status(409).json({ error: 'A notice must be approved before it can be recorded as issued.' });
      if (!isValidDate(b.issue_date || '') || b.issue_date > today) return bad(res, { issue_date: 'Enter the actual issue date (not in the future).' });
      await store.update('notice_drafts', n.id, { status: 'issued', issue_date: b.issue_date });
    } else if (a === 'serve') {
      if (n.status !== 'issued') return res.status(409).json({ error: 'Record the issue first. Service is recorded only after the notice was actually served.' });
      const errs = {};
      if (!isValidDate(b.service_date || '') || b.service_date > today) errs.service_date = 'Enter the actual service date (not in the future).';
      else if (b.service_date < n.issue_date) errs.service_date = 'Service date cannot be before the issue date.';
      if (!String(b.service_method || '').trim()) errs.service_method = 'Record how the notice was served.';
      if (Object.keys(errs).length) return bad(res, errs);
      await store.update('notice_drafts', n.id, { status: 'served', service_date: b.service_date, service_method: b.service_method, service_notes: b.service_notes || null });
    } else if (a === 'withdraw') {
      if (!isLead(req) && n.prepared_by !== req.user.id) return res.status(403).json({ error: 'Not permitted.' });
      if (n.status === 'served') return res.status(409).json({ error: 'A served notice cannot be withdrawn here.' });
      await store.update('notice_drafts', n.id, { status: 'withdrawn' });
    }
    await audit(req, `notice_${a}`, 'notice_draft', n.id, b);
    res.json({ ok: true });
  });

  // Word export (HTML based .doc that opens in Microsoft Word / LibreOffice)
  r.get('/notices/:id/word', async (req, res) => {
    const n = await getInWard('notice_drafts', req.params.id, req.ward.id);
    if (!n) return res.status(404).json({ error: 'Notice not found.' });
    const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const banner = n.status === 'draft' ? '<p style="color:#b45309;font-weight:bold">DRAFT: NOT APPROVED. NOT FOR SERVICE.</p>' : '';
    const html = `<html><head><meta charset="utf-8"><title>${esc(n.draft_reference)}</title></head><body style="font-family:Calibri,Arial;font-size:12pt">${banner}${esc(n.content).replace(/\n/g, '<br>')}</body></html>`;
    await audit(req, 'export', 'notice_draft', n.id, { format: 'word' });
    res.setHeader('Content-Type', 'application/msword');
    res.setHeader('Content-Disposition', `attachment; filename="${n.draft_reference.replace(/\//g, '-')}.doc"`);
    res.send(html);
  });

  return r;
}
