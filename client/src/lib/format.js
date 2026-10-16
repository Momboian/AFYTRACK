export const TZ = 'Africa/Nairobi';

export function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function fmtDate(s) {
  if (!s) return '—';
  const d = s.length === 10 ? new Date(s + 'T00:00:00Z') : new Date(s);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: s.length === 10 ? 'UTC' : TZ });
}
// SQLite datetime('now') values look like "2026-10-14 07:30:00" (UTC)
const norm = (s) => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? s.replace(' ', 'T') + 'Z' : s);
export function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(norm(iso)).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
}
export function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}
// ISO -> value for <input type="datetime-local"> in Nairobi time
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 3 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}
// datetime-local (Nairobi) -> ISO
export function fromLocalInput(v) {
  if (!v) return null;
  return new Date(v + ':00+03:00').toISOString();
}
export const humanize = (s) => (s ? String(s).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—');

export const ENTITY_LABEL = { premises: 'Food premises', handler: 'Food handler', household: 'Household', water_source: 'Water source', facility: 'Healthcare facility' };
export const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
