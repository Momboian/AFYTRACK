// End to end API tests (AC-01 .. AC-14 core checks) against the in-memory Firestore stand in,
// loaded with the same synthetic demo dataset as `npm run seed`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_DRIVER = 'memory';
process.env.AUTH_RATE_LIMIT = '1000';
const { getStore } = await import('../store.js');
const { seedDemo } = await import('../seed.js');
const { createApp } = await import('../index.js');
const { runReminders } = await import('../routes/work.js');
let server, base, db;
let lead, officer, other, reviewer;

before(async () => {
  db = await getStore();
  await seedDemo(db);
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
  lead = (await login('lead@afyatrack.test', 'Lead@2026')).body.token;
  officer = (await login('officer@afyatrack.test', 'Officer@2026')).body.token;
  other = (await login('ukunda@afyatrack.test', 'Officer@2026')).body.token;
  reviewer = (await login('reviewer@afyatrack.test', 'Reviewer@2026')).body.token;
});
after(() => { server.close(); });

async function login(email, password) {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return { status: r.status, body: await r.json() };
}
const call = (token, p, opts = {}) => fetch(`${base}${p}`, {
  ...opts, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  body: opts.body ? JSON.stringify(opts.body) : undefined
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));


test('AC-01 active user signs in, inactive user cannot, wrong password rejected', async () => {
  assert.ok(lead);
  assert.equal((await login('inactive@afyatrack.test', 'Officer@2026')).status, 403);
  assert.equal((await login('lead@afyatrack.test', 'wrong')).status, 401);
});

test('AC-01 officer cannot read another ward', async () => {
  assert.equal((await call(other, '/registers/premises/1')).status, 404);
  assert.equal((await call(other, '/registers/premises', { headers: { 'x-ward-id': '1' } })).status, 403);
});

test('unauthenticated API requests are rejected', async () => {
  assert.equal((await fetch(`${base}/tasks`)).status, 401);
});

test('reviewer is read only', async () => {
  assert.equal((await call(reviewer, '/tasks')).status, 200);
  assert.equal((await call(reviewer, '/tasks', { method: 'POST', body: { title: 'x', due_at: new Date().toISOString() } })).status, 403);
});

test('AC-02/04 task creation, overdue logic and completion without double counting', async () => {
  const past = new Date(Date.now() - 3600e3).toISOString();
  const c = await call(officer, '/tasks', { method: 'POST', body: { title: 'Test task', category_id: 1, due_at: past } });
  assert.equal(c.status, 201);
  let t = (await call(officer, `/tasks/${c.body.id}`)).body;
  assert.equal(t.is_overdue, true);
  const done = { status: 'completed', record_activity: { activity_date: new Date().toISOString().slice(0, 10), quantity: 1 } };
  assert.equal((await call(officer, `/tasks/${c.body.id}`, { method: 'PATCH', body: done })).status, 200);
  await call(officer, `/tasks/${c.body.id}`, { method: 'PATCH', body: done }); // second time must not add another record
  t = (await call(officer, `/tasks/${c.body.id}`)).body;
  assert.equal(t.is_overdue, false);
  const n = (await db.find('activity_records', { linked_task_id: c.body.id })).length;
  assert.equal(n, 1);
});

test('officer cannot assign tasks to others; postpone needs reason and new date', async () => {
  const r = await call(officer, '/tasks', { method: 'POST', body: { title: 'x', due_at: new Date().toISOString(), assigned_to: 4 } });
  assert.equal(r.status, 400);
  const c = await call(officer, '/tasks', { method: 'POST', body: { title: 'p', due_at: new Date(Date.now() + 864e5).toISOString() } });
  const p = await call(officer, `/tasks/${c.body.id}`, { method: 'PATCH', body: { status: 'postponed' } });
  assert.equal(p.status, 400);
  assert.ok(p.body.errors.status_reason && p.body.errors.due_at);
});

test('AC-03 reminders are generated at the scheduled time', async () => {
  const due = new Date(Date.now() + 864e5).toISOString();
  const rem = new Date(Date.now() - 60e3).toISOString();
  const c = await call(officer, '/tasks', { method: 'POST', body: { title: 'Remind me', due_at: due, reminder_at: rem } });
  await runReminders(db);
  const list = (await call(officer, '/reminders')).body;
  assert.ok(list.some((r) => r.linked_record_type === 'task' && r.linked_record_id === c.body.id));
});

test('AC-06/07/19 register CRUD, duplicate warning, facility inspection with findings and history', async () => {
  const dup = await call(officer, '/registers/premises', { method: 'POST', body: { premises_name: 'Kinondo Bakery' } });
  assert.equal(dup.status, 409);
  const f = await call(officer, '/registers/facility', { method: 'POST', body: { facility_name: 'Test Hospital Z', facility_type: 'Hospital' } });
  assert.equal(f.status, 201);
  const today = new Date().toISOString().slice(0, 10);
  const ins = await call(officer, '/inspections', { method: 'POST', body: {
    entity_type: 'facility', entity_id: f.body.id, inspection_date: today, risk_level: 'high',
    findings_list: [{ finding: 'Incinerator broken', required_action: 'Repair', deadline: today }, { finding: 'No bins', required_action: 'Provide bins', deadline: today }],
    facility_status: { incinerator_status: 'non_functional' } } });
  assert.equal(ins.status, 201);
  const prof = (await call(officer, `/registers/facility/${f.body.id}`)).body;
  assert.equal(prof.inspections.length, 1);
  assert.equal(prof.followUps.length, 2);
  assert.equal(prof.record.incinerator_status, 'non_functional');
});

test('AC-12 missing water results are not compliant; future dates rejected', async () => {
  const bad = await call(officer, '/registers/water_source/1/samples', { method: 'POST', body: { collection_date: '2026-01-05', compliance_status: 'compliant' } });
  assert.equal(bad.status, 400);
  const ok = await call(officer, '/registers/water_source/1/samples', { method: 'POST', body: { collection_date: '2026-01-05' } });
  assert.equal(ok.status, 201);
  assert.equal((await db.get('water_samples', ok.body.id)).compliance_status, 'pending_result');
  const fut = await call(officer, '/inspections', { method: 'POST', body: { entity_type: 'premises', entity_id: 1, inspection_date: '2999-01-01' } });
  assert.equal(fut.status, 400);
});

test('AC-08 notice draft is never auto served; only lead approves', async () => {
  const n = await call(officer, '/notices', { method: 'POST', body: { template_id: 1, recipient: 'Owner', linked_entity_type: 'premises', linked_entity_id: 1 } });
  assert.equal(n.status, 201);
  assert.equal((await call(officer, `/notices/${n.body.id}`)).body.status, 'draft');
  assert.equal((await call(officer, `/notices/${n.body.id}/approve`, { method: 'POST', body: {} })).status, 403);
  assert.equal((await call(lead, `/notices/${n.body.id}/serve`, { method: 'POST', body: { service_date: '2026-01-01', service_method: 'x' } })).status, 409);
  assert.equal((await call(lead, `/notices/${n.body.id}/approve`, { method: 'POST', body: {} })).status, 200);
});

test('AC-09/10/11 reports: N/A without target, totals traceable to source records', async () => {
  const r = (await call(lead, '/reports?type=monthly')).body;
  const handler = r.activities.find((a) => a.category === 'Food handler medical follow up');
  if (handler) assert.equal(handler.achievement_pct, 'N/A'); // seeded target is zero
  for (const a of r.activities.filter((x) => x.records)) {
    const src = (await call(lead, `/reports/source?type=monthly&category_id=${a.category_id}`)).body;
    assert.equal(src.length, a.records);
    assert.equal(src.reduce((s, x) => s + x.quantity, 0), a.quantity);
  }
  assert.ok(Array.isArray(r.tasks.overdue) && typeof r.tasks.completed === 'number');
});

test('AC-13/14 export creates an audit entry and CSV matches preview totals', async () => {
  const res = await fetch(`${base}/reports/export.csv?type=weekly`, { headers: { authorization: `Bearer ${lead}` } });
  assert.equal(res.status, 200);
  const csv = await res.text();
  const preview = (await call(lead, '/reports?type=weekly')).body;
  assert.ok(csv.includes(`TOTAL,${preview.totals.activity_records},${preview.totals.quantity}`));
  assert.ok((await db.find('audit_events', { action: 'export', entity_type: 'report' })).length >= 1);
});

test('US-15 admin can deactivate a user without erasing records', async () => {
  const admin = (await login('admin@afyatrack.test', 'Admin@2026')).body.token;
  const before = (await db.find('tasks', { assigned_to: 4 })).length;
  assert.equal((await call(admin, '/users/4', { method: 'PATCH', body: { active: false } })).status, 200);
  assert.equal((await login('officer2@afyatrack.test', 'Officer@2026')).status, 403);
  assert.equal((await db.find('tasks', { assigned_to: 4 })).length, before);
});

test('lookups list each officer once (no duplicate dropdown values)', async () => {
  const lk = (await call(lead, '/lookups')).body;
  const ids = lk.officers.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
});
