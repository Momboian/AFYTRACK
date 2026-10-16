export const TZ = 'Africa/Nairobi';

export function todayNairobi(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export const nowIso = () => new Date().toISOString();

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Monday to Sunday week containing dateStr
export function weekRange(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const start = addDays(dateStr, -dow);
  return { start, end: addDays(start, 6) };
}

export function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start, end: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}` };
}

// Start/end of a Nairobi calendar date expressed as UTC ISO strings (for timestamp columns)
export function nairobiDayBoundsIso(startDate, endDate) {
  const s = new Date(startDate + 'T00:00:00+03:00').toISOString();
  const e = new Date(addDays(endDate, 1) + 'T00:00:00+03:00').toISOString();
  return { s, e };
}

export function makeAudit(store) {
  return async (req, action, entityType, entityId, summary) => {
    await store.insert('audit_events', {
      actor_user_id: req?.user?.id ?? null,
      ward_id: req?.ward?.id ?? null,
      action,
      entity_type: entityType ?? null,
      entity_id: entityId ?? null,
      at: new Date().toISOString(),
      change_summary: typeof summary === 'string' ? summary : summary ? JSON.stringify(summary) : null,
      ip: req?.ip ?? null,
      user_agent: req?.get?.('user-agent')?.slice(0, 200) ?? null
    }, { timestamps: false });
  };
}

/** Wraps a router so async handlers pass their errors to Express. */
export function asyncRouter(router) {
  for (const m of ['get', 'post', 'patch', 'delete', 'put', 'use']) {
    const orig = router[m].bind(router);
    router[m] = (...args) => orig(...args.map((h) => (typeof h === 'function' && h.length < 4
      ? (req, res, next) => Promise.resolve(h(req, res, next)).catch(next) : h)));
  }
  return router;
}

export function diff(before, after) {
  const out = {};
  for (const k of Object.keys(after)) {
    if (String(before?.[k] ?? '') !== String(after[k] ?? '')) out[k] = { from: before?.[k] ?? null, to: after[k] ?? null };
  }
  return out;
}

export function achievementPct(achieved, target) {
  if (target === null || target === undefined || !(Number(target) > 0)) return 'N/A';
  return Math.round((Number(achieved) / Number(target)) * 1000) / 10; // one decimal
}

export function bad(res, errors, message = 'Please correct the highlighted fields.') {
  return res.status(400).json({ error: message, errors });
}
