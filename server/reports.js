import { achievementPct, todayNairobi, nairobiDayBoundsIso, nowIso } from './util.js';
import { sortBy, isActive } from './store.js';

const OPEN = ['planned', 'in_progress', 'postponed'];
const inRange = (d, start, end) => d != null && d >= start && d <= end;
const countBy = (rows, key) => {
  const out = {};
  for (const r of rows) { const k = r[key] ?? 'unknown'; out[k] = (out[k] || 0) + 1; }
  return out;
};

export async function buildReport(store, { wardId, type, start, end, scopeUserId = null }) {
  const today = todayNairobi();
  const now = nowIso();
  const { s: startIso, e: endIso } = nairobiDayBoundsIso(start, end);
  const w = { ward_id: wardId };
  const [cats, users, locs, actsAll, targetsAll, tasksAll, fusAll, inspections, premises, handlers, households, sources, samples, facilities] = await Promise.all([
    store.byId('categories'), store.byId('users'), store.byId('locations', w), store.find('activity_records', w),
    store.find('targets', { ward_id: wardId, period_type: type }), store.find('tasks', w), store.find('follow_ups', w),
    store.find('inspections', w), store.find('food_premises', w), store.find('food_handlers', w), store.find('households', w),
    store.find('water_sources', w), store.find('water_samples', w), store.find('healthcare_facilities', w)
  ]);
  const uname = (id) => users.get(id)?.full_name ?? null;

  // 1. Activity records in the period (source of all achievement counts; each record counted once)
  const acts = actsAll.filter((a) => !a.deleted_at && inRange(a.activity_date, start, end) && (!scopeUserId || a.recorded_by === scopeUserId));
  const byCat = new Map();
  for (const a of acts) {
    const row = byCat.get(a.category_id) || { category_id: a.category_id, category: cats.get(a.category_id)?.name ?? 'Unknown', records: 0, quantity: 0, target: null };
    row.records += 1;
    row.quantity += Number(a.quantity) || 0;
    byCat.set(a.category_id, row);
  }
  // 2. Targets overlapping the period, for this scope
  for (const t of targetsAll) {
    if (!(t.period_start <= end && t.period_end >= start)) continue;
    if (scopeUserId ? t.user_id !== scopeUserId : t.user_id != null) continue;
    const row = byCat.get(t.category_id) || { category_id: t.category_id, category: cats.get(t.category_id)?.name ?? 'Unknown', records: 0, quantity: 0, target: null };
    row.target = (row.target || 0) + Number(t.target_value);
    byCat.set(t.category_id, row);
  }
  const activities = [...byCat.values()]
    .map((r) => ({ ...r, achievement_pct: achievementPct(r.quantity, r.target) }))
    .sort((a, b) => a.category.localeCompare(b.category));

  // 3. Tasks: completed in period, pending (open, due in period, not overdue), overdue (open and past due)
  const tasks = tasksAll.filter((t) => !t.deleted_at && (!scopeUserId || t.assigned_to === scopeUserId));
  const taskRow = (t) => ({ id: t.id, title: t.title, due_at: t.due_at, status: t.status, status_reason: t.status_reason ?? null,
    assigned_name: uname(t.assigned_to), category: cats.get(t.category_id)?.name ?? null });
  const completedTasks = tasks.filter((t) => t.status === 'completed' && t.completed_at >= startIso && t.completed_at < endIso).length;
  const pendingTasks = sortBy(tasks.filter((t) => OPEN.includes(t.status) && t.due_at >= now && t.due_at < endIso), 'due_at').map(taskRow);
  const overdueTasks = sortBy(tasks.filter((t) => OPEN.includes(t.status) && t.due_at < now && t.due_at < endIso), 'due_at').map(taskRow);

  // 4. Follow ups
  const fus = fusAll.filter((f) => !scopeUserId || f.responsible_user_id === scopeUserId);
  const fuRow = (f) => ({ id: f.id, action_required: f.action_required, due_date: f.due_date, status: f.status, outcome: f.outcome ?? null,
    linked_entity_type: f.linked_entity_type ?? null, linked_entity_id: f.linked_entity_id ?? null, responsible_name: uname(f.responsible_user_id) });
  const followUps = {
    due_in_period: fus.filter((f) => inRange(f.due_date, start, end)).length,
    completed_in_period: fus.filter((f) => f.status === 'completed' && f.completed_at >= startIso && f.completed_at < endIso).length,
    overdue: sortBy(fus.filter((f) => f.status === 'open' && f.due_date < today && f.due_date <= end), 'due_date').map(fuRow),
    upcoming: sortBy(fus.filter((f) => f.status === 'open' && f.due_date >= today && inRange(f.due_date, start, end)), 'due_date').map(fuRow)
  };

  // 5. Breakdown by officer and location (activity records)
  const offMap = new Map();
  for (const a of acts) {
    const o = offMap.get(a.recorded_by) || { id: a.recorded_by, full_name: uname(a.recorded_by), records: 0, quantity: 0 };
    o.records += 1; o.quantity += Number(a.quantity) || 0;
    offMap.set(a.recorded_by, o);
  }
  const officers = [...offMap.values()].sort((a, b) => b.records - a.records || String(a.full_name).localeCompare(String(b.full_name)));
  const locMap = new Map();
  for (const a of acts) {
    const name = locs.get(a.location_id)?.sub_location || 'Not specified';
    locMap.set(name, (locMap.get(name) || 0) + 1);
  }
  const locations = [...locMap].map(([sub_location, records]) => ({ sub_location, records })).sort((a, b) => b.records - a.records || a.sub_location.localeCompare(b.sub_location));

  // 6. Register summaries
  const insp = (type) => {
    const rows = inspections.filter((i) => i.entity_type === type && inRange(i.inspection_date, start, end) && (!scopeUserId || i.officer_id === scopeUserId));
    return { visits: rows.length, entities: new Set(rows.map((i) => i.entity_id)).size };
  };
  const overdueFu = (type) => fusAll.filter((f) => f.linked_entity_type === type && f.status === 'open' && f.due_date < today).length;
  const active = (rows) => rows.filter((x) => isActive(x.active));

  const ap = active(premises);
  const premisesSummary = {
    total_active: ap.length,
    inspected_in_period: insp('premises').entities,
    inspection_visits: insp('premises').visits,
    licence_status: countBy(ap, 'licence_status'),
    licence_expired_by_date: ap.filter((p) => p.licence_expiry_date && p.licence_expiry_date < today).length,
    overdue_follow_ups: overdueFu('premises')
  };
  const ah = active(handlers);
  const handlersSummary = {
    total_registered: ah.length,
    certificate_current: ah.filter((h) => h.certificate_expiry && h.certificate_expiry >= today).length,
    certificate_expired: ah.filter((h) => h.certificate_expiry && h.certificate_expiry < today).length,
    expiry_not_recorded: ah.filter((h) => !h.certificate_expiry).length,
    medical_pending: ah.filter((h) => h.status === 'pending').length
  };
  const ahh = active(households);
  const byLoc = new Map();
  for (const h of ahh) { const n = locs.get(h.location_id)?.sub_location || 'Not specified'; byLoc.set(n, (byLoc.get(n) || 0) + 1); }
  const householdsSummary = {
    total_recorded: ahh.length,
    by_sanitation_status: countBy(ahh, 'sanitation_status'),
    by_location: [...byLoc].map(([sub_location, n]) => ({ sub_location, n })).sort((a, b) => a.sub_location.localeCompare(b.sub_location)),
    needing_follow_up: ahh.filter((h) => ['needs_improvement', 'inadequate', 'none'].includes(h.sanitation_status) || (h.follow_up_due && h.follow_up_due <= end)).length,
    visits_in_period: insp('household').visits,
    coverage_note: 'Based on registered household records only.'
  };
  const sm = samples.filter((x) => !scopeUserId || x.recorded_by === scopeUserId);
  const water = {
    sources_registered: active(sources).length,
    sources_inspected: insp('water_source').entities,
    inspection_visits: insp('water_source').visits,
    samples_collected: sm.filter((x) => inRange(x.collection_date, start, end)).length,
    results_pending: sm.filter((x) => x.compliance_status === 'pending_result' && x.collection_date <= end).length,
    compliant: sm.filter((x) => x.compliance_status === 'compliant' && inRange(x.collection_date, start, end)).length,
    non_compliant: sm.filter((x) => x.compliance_status === 'non_compliant' && inRange(x.collection_date, start, end)).length,
    overdue_actions: samples.filter((x) => x.next_action_due && x.next_action_due < today && ['pending_result', 'non_compliant'].includes(x.compliance_status)).length + overdueFu('water_source')
  };
  const facInspections = inspections.filter((i) => i.entity_type === 'facility');
  const facFindings = [];
  for (const i of facInspections) for (const f of await store.find('inspection_findings', { inspection_id: i.id })) facFindings.push({ ...f, inspection_date: i.inspection_date });
  const af = active(facilities);
  const facilitiesSummary = {
    total_active: af.length,
    inspected_in_period: insp('facility').entities,
    inspection_visits: insp('facility').visits,
    deficiencies_recorded: facFindings.filter((f) => inRange(f.inspection_date, start, end)).length,
    outstanding_corrective_actions: facFindings.filter((f) => ['open', 'partially_resolved', 'unresolved'].includes(f.status)).length,
    overdue_follow_ups: overdueFu('facility'),
    incinerator_status: countBy(af, 'incinerator_status')
  };

  // 7. Notable issues: open findings with deadlines up to period end
  const issues = [];
  for (const i of inspections) {
    if (scopeUserId && i.officer_id !== scopeUserId) continue;
    for (const f of await store.find('inspection_findings', { inspection_id: i.id })) {
      if (f.status !== 'resolved' && (!f.deadline || f.deadline <= end)) {
        issues.push({ id: f.id, finding: f.finding, required_action: f.required_action ?? null, deadline: f.deadline ?? null, status: f.status,
          entity_type: i.entity_type, entity_id: i.entity_id, inspection_id: i.id });
      }
    }
  }
  issues.sort((a, b) => String(a.deadline ?? '').localeCompare(String(b.deadline ?? '')));

  return {
    meta: { type, start, end, generated_at: now, approved: false, counting_rule: 'Achievements count saved activity records dated within the period. Each record is counted once. Tasks, follow ups, inspections (visits) and samples are counted separately.' },
    activities,
    totals: { activity_records: activities.reduce((s, r) => s + r.records, 0), quantity: activities.reduce((s, r) => s + r.quantity, 0) },
    tasks: { completed: completedTasks, pending: pendingTasks, overdue: overdueTasks },
    follow_ups: followUps,
    officers, locations,
    registers: { premises: premisesSummary, handlers: handlersSummary, households: householdsSummary, water, facilities: facilitiesSummary },
    issues: issues.slice(0, 25)
  };
}

export async function sourceRecords(store, { wardId, categoryId, start, end, scopeUserId = null }) {
  const [rows, users, cats, locs] = await Promise.all([
    store.find('activity_records', { ward_id: wardId }), store.byId('users'), store.byId('categories'), store.byId('locations', { ward_id: wardId })
  ]);
  return sortBy(rows.filter((a) => !a.deleted_at && inRange(a.activity_date, start, end) && (!categoryId || a.category_id === categoryId) && (!scopeUserId || a.recorded_by === scopeUserId)), 'activity_date', 'id')
    .map((a) => ({ id: a.id, activity_date: a.activity_date, outcome: a.outcome ?? null, notes: a.notes ?? null, quantity: a.quantity, unit: a.unit,
      linked_task_id: a.linked_task_id ?? null, linked_entity_type: a.linked_entity_type ?? null, linked_entity_id: a.linked_entity_id ?? null,
      linked_inspection_id: a.linked_inspection_id ?? null, recorded_by_name: users.get(a.recorded_by)?.full_name ?? null,
      category: cats.get(a.category_id)?.name ?? null, sub_location: locs.get(a.location_id)?.sub_location ?? null }));
}

export function reportToCsv(report, wardName, scopeLabel) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [];
  const push = (...cols) => rows.push(cols.map(esc).join(','));
  const m = report.meta;
  push(`AfyaTrack PHO ${m.type === 'weekly' ? 'Weekly' : 'Monthly'} Activity Report`);
  push('Ward', wardName); push('Scope', scopeLabel); push('Period', `${m.start} to ${m.end}`);
  push('Generated (UTC)', m.generated_at); push('Status', 'DRAFT: generated automatically, not officially approved');
  push('Counting rule', m.counting_rule);
  push('');
  push('Activity by category'); push('Category', 'Records', 'Quantity', 'Target', 'Achievement %');
  for (const a of report.activities) push(a.category, a.records, a.quantity, a.target ?? 'N/A', a.achievement_pct);
  push('TOTAL', report.totals.activity_records, report.totals.quantity);
  push('');
  push('Tasks'); push('Completed in period', report.tasks.completed);
  push('Pending tasks', report.tasks.pending.length); push('Overdue tasks', report.tasks.overdue.length);
  for (const t of report.tasks.overdue) push('Overdue', t.title, t.assigned_name, t.due_at);
  push('');
  push('Follow ups'); push('Due in period', report.follow_ups.due_in_period); push('Completed in period', report.follow_ups.completed_in_period);
  push('Overdue', report.follow_ups.overdue.length);
  for (const f of report.follow_ups.overdue) push('Overdue follow up', f.action_required, f.responsible_name, f.due_date);
  push('');
  push('Officer breakdown'); push('Officer', 'Records');
  for (const o of report.officers) push(o.full_name, o.records);
  push('');
  push('Location breakdown'); push('Sub location', 'Records');
  for (const l of report.locations) push(l.sub_location, l.records);
  push('');
  const flat = (title, obj) => {
    push(title);
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) push(`${k}: ${k2}`, v2);
      else if (Array.isArray(v)) for (const r of v) push(`${k}: ${r.sub_location}`, r.n);
      else push(k.replace(/_/g, ' '), v);
    }
    push('');
  };
  flat('Premises register summary', report.registers.premises);
  flat('Food handlers summary', report.registers.handlers);
  flat('Household sanitation summary', report.registers.households);
  flat('Water source and sampling summary', report.registers.water);
  flat('Healthcare facility sanitation summary', report.registers.facilities);
  push('Notable issues and next actions'); push('Finding', 'Required action', 'Deadline', 'Status');
  for (const i of report.issues) push(i.finding, i.required_action, i.deadline, i.status);
  return '﻿' + rows.join('\r\n');
}
