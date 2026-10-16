import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSpreadsheet, Printer, ExternalLink, Info } from 'lucide-react';
import { api, qs, download } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, fmtDateTime, todayStr, humanize, ENTITY_LABEL } from '../lib/format.js';
import { Badge, Card, PageHeader, Spinner, Button, Select, Input, Field, Modal, ErrorNote, useToast } from '../components/ui.jsx';
import { useLoad, EntityLink } from '../components/forms.jsx';

function Section({ title, children, note }) {
  return (
    <section className="card print-area mb-5 break-inside-avoid overflow-hidden">
      <div className="flex items-baseline justify-between gap-2 border-b border-line px-4 py-3"><h2 className="font-bold">{title}</h2>{note && <span className="text-[11px] text-ink-faint">{note}</span>}</div>
      {children}
    </section>
  );
}
function KV({ obj }) {
  return (
    <div className="grid grid-cols-2 border-t border-line sm:grid-cols-3 [&>div]:border-b [&>div]:border-r [&>div]:border-line">
      {Object.entries(obj).map(([k, v]) => (
        <div key={k} className="px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{humanize(k)}</div>
          {typeof v === 'object' && v !== null ? (
            Array.isArray(v) ? <div className="mt-1 text-[13px]">{v.map((r) => <div key={r.sub_location}>{r.sub_location}: <b>{r.n}</b></div>)}</div>
              : <div className="mt-1 flex flex-wrap gap-1">{Object.entries(v).map(([a, b]) => <Badge key={a} status={a}>{humanize(a)}: {b}</Badge>)}{!Object.keys(v).length && <span className="text-sm text-ink-faint">—</span>}</div>
          ) : <div className="mt-0.5 text-[20px] font-extrabold leading-tight">{v}</div>}
        </div>
      ))}
    </div>
  );
}

export default function Reports() {
  const { can, lookups, me } = useAuth();
  const [type, setType] = useState('weekly');
  const [date, setDate] = useState(todayStr());
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [scope, setScope] = useState(can.lead || me.role === 'reviewer' ? 'team' : 'me');
  const [run, setRun] = useState(0);
  const params = { type, date: type === 'weekly' ? date : undefined, month: type === 'monthly' ? month : undefined, scope };
  const { data: r, loading, error } = useLoad(() => api(`/reports${qs(params)}`), [run, me.ward?.id]);
  const [source, setSource] = useState(null);
  const toast = useToast();

  const exportCsv = async () => {
    try { await download(`/reports/export.csv${qs(params)}`, 'report.csv'); toast('Excel / CSV downloaded'); } catch (e) { toast(e.message, 'error'); }
  };
  const print = () => { api('/reports/printed', { method: 'POST', body: { type, start: r.meta.start, end: r.meta.end } }).catch(() => {}); window.print(); };

  return (
    <div>
      <div className="no-print">
        <PageHeader title="Reports" subtitle="Weekly and monthly reports generated from saved records. Open any figure to see the records behind it." />
        <Card className="mb-5 p-4">
          <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[180px_200px_1fr_auto]">
            <Field label="Report"><Select value={type} onChange={(e) => setType(e.target.value)} options={[{ value: 'weekly', label: 'Weekly activity report' }, { value: 'monthly', label: 'Monthly activity report' }]} /></Field>
            {type === 'weekly'
              ? <Field label="Any day in the week" hint="Weeks run Monday to Sunday."><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              : <Field label="Month"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>}
            {(can.lead || me.role === 'reviewer') ? (
              <Field label="Scope"><Select value={scope} onChange={(e) => setScope(e.target.value)} options={[{ value: 'team', label: 'Whole ward team' }, { value: 'me', label: 'My work only' }, ...lookups.officers.map((o) => ({ value: `user:${o.id}`, label: `Officer: ${o.full_name}` }))]} /></Field>
            ) : <Field label="Scope"><Input value="My work" disabled /></Field>}
            <Button onClick={() => setRun((x) => x + 1)}>Generate preview</Button>
          </div>
        </Card>
      </div>
      <ErrorNote error={error} />
      {loading && !r ? <Spinner label="Building report…" /> : r && (
        <div>
          <div className="card print-area mb-5 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-600">AfyaTrack PHO</div>
                <h2 className="text-[22px] font-extrabold tracking-tight">{r.meta.type === 'weekly' ? 'Weekly' : 'Monthly'} activity report</h2>
                <div className="mt-1 text-sm text-ink-soft">{r.meta.ward} · {r.meta.scope}</div>
                <div className="text-sm text-ink-soft">Period: <b>{fmtDate(r.meta.start)}</b> to <b>{fmtDate(r.meta.end)}</b> · Generated {fmtDateTime(r.meta.generated_at)} (EAT)</div>
              </div>
              <div className="no-print flex gap-2">
                <Button variant="secondary" onClick={exportCsv}><FileSpreadsheet className="h-4 w-4" />Excel / CSV</Button>
                <Button variant="secondary" onClick={print}><Printer className="h-4 w-4" />Print / PDF</Button>
              </div>
            </div>
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-ochre-100 bg-ochre-50 px-3 py-2 text-[12px] text-ochre-700">
              <Info className="mt-0.5 h-4 w-4 flex-none" /><span><b>Draft, generated automatically. Not officially approved.</b> {r.meta.counting_rule}</span>
            </div>
          </div>

          <Section title="Activity by category" note="Achievement % = achieved ÷ target × 100. N/A when no target or target is zero.">
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Category</th><th className="text-right">Records</th><th className="text-right">Achieved (qty)</th><th className="text-right">Target</th><th className="text-right">Achievement</th><th className="no-print"></th></tr></thead>
                <tbody>
                  {r.activities.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-ink-faint">No activity records in this period.</td></tr>}
                  {r.activities.map((a) => (
                    <tr key={a.category_id}>
                      <td className="font-medium">{a.category}</td>
                      <td className="text-right font-mono">{a.records}</td>
                      <td className="text-right font-mono font-bold">{a.quantity}</td>
                      <td className="text-right font-mono">{a.target ?? 'N/A'}</td>
                      <td className="text-right">
                        {a.achievement_pct === 'N/A' ? <span className="font-mono text-ink-faint">N/A</span> : (
                          <span className="inline-flex items-center gap-2"><span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-paper sm:inline-block"><span className="block h-full bg-brand-500" style={{ width: `${Math.min(100, a.achievement_pct)}%` }} /></span><span className="font-mono font-bold">{a.achievement_pct}%</span></span>
                        )}
                      </td>
                      <td className="no-print text-right"><button onClick={() => setSource(a)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:underline" disabled={!a.records}>{a.records ? <>Records<ExternalLink className="h-3 w-3" /></> : ''}</button></td>
                    </tr>
                  ))}
                  <tr className="bg-paper/60 font-bold"><td>Total</td><td className="text-right font-mono">{r.totals.activity_records}</td><td className="text-right font-mono">{r.totals.quantity}</td><td colSpan={3}></td></tr>
                </tbody>
              </table>
            </div>
          </Section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Tasks" note="Shown separately from achievements">
              <div className="grid grid-cols-3 gap-px bg-line">
                <div className="bg-white px-4 py-3"><div className="text-[11px] font-semibold uppercase text-ink-faint">Completed</div><div className="text-[22px] font-extrabold text-brand-600">{r.tasks.completed}</div></div>
                <div className="bg-white px-4 py-3"><div className="text-[11px] font-semibold uppercase text-ink-faint">Pending</div><div className="text-[22px] font-extrabold">{r.tasks.pending.length}</div></div>
                <div className="bg-white px-4 py-3"><div className="text-[11px] font-semibold uppercase text-ink-faint">Overdue</div><div className="text-[22px] font-extrabold text-red-600">{r.tasks.overdue.length}</div></div>
              </div>
              {[...r.tasks.overdue.map((t) => ({ ...t, od: true })), ...r.tasks.pending].slice(0, 12).map((t) => (
                <Link key={t.id} to={`/planner/${t.id}`} className="flex items-center justify-between gap-2 border-t border-line/70 px-4 py-2 text-sm hover:bg-paper">
                  <span className="truncate">{t.title} <span className="text-[12px] text-ink-faint">· {t.assigned_name}</span></span><Badge status={t.od ? 'overdue' : t.status}>{t.od ? `Overdue ${fmtDate(t.due_at)}` : fmtDate(t.due_at)}</Badge>
                </Link>
              ))}
            </Section>
            <Section title="Follow ups">
              <div className="grid grid-cols-3 gap-px bg-line">
                <div className="bg-white px-4 py-3"><div className="text-[11px] font-semibold uppercase text-ink-faint">Due in period</div><div className="text-[22px] font-extrabold">{r.follow_ups.due_in_period}</div></div>
                <div className="bg-white px-4 py-3"><div className="text-[11px] font-semibold uppercase text-ink-faint">Completed</div><div className="text-[22px] font-extrabold text-brand-600">{r.follow_ups.completed_in_period}</div></div>
                <div className="bg-white px-4 py-3"><div className="text-[11px] font-semibold uppercase text-ink-faint">Overdue</div><div className="text-[22px] font-extrabold text-red-600">{r.follow_ups.overdue.length}</div></div>
              </div>
              {r.follow_ups.overdue.slice(0, 10).map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-2 border-t border-line/70 px-4 py-2 text-sm">
                  <span className="truncate">{f.action_required} <span className="text-[12px] text-ink-faint">· {f.responsible_name}</span></span><span className="flex-none text-[12px] font-semibold text-red-600">{fmtDate(f.due_date)}</span>
                </div>
              ))}
            </Section>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Officer breakdown">
              {r.officers.length === 0 ? <div className="px-4 py-4 text-sm text-ink-faint">No records.</div> : r.officers.map((o) => (
                <div key={o.id} className="flex justify-between border-b border-line/60 px-4 py-2 text-sm last:border-0"><span>{o.full_name}</span><span className="font-mono">{o.records} records · qty {o.quantity}</span></div>
              ))}
            </Section>
            <Section title="Location breakdown">
              {r.locations.length === 0 ? <div className="px-4 py-4 text-sm text-ink-faint">No records.</div> : r.locations.map((l) => (
                <div key={l.sub_location} className="flex justify-between border-b border-line/60 px-4 py-2 text-sm last:border-0"><span>{l.sub_location}</span><span className="font-mono">{l.records}</span></div>
              ))}
            </Section>
          </div>

          <Section title="Food premises register summary" note="Register totals count distinct active premises; inspections count visits"><KV obj={r.registers.premises} /></Section>
          <Section title="Food handlers summary" note="Valid status is never inferred when the expiry date is missing"><KV obj={r.registers.handlers} /></Section>
          <Section title="Household sanitation summary" note={r.registers.households.coverage_note}><KV obj={Object.fromEntries(Object.entries(r.registers.households).filter(([k]) => k !== 'coverage_note'))} /></Section>
          <Section title="Water source and sampling summary" note="Source inspections and samples are separate counts"><KV obj={r.registers.water} /></Section>
          <Section title="Healthcare facility sanitation summary" note="Corrective actions counted separately from inspection visits"><KV obj={r.registers.facilities} /></Section>

          <Section title="Notable issues and next actions">
            {r.issues.length === 0 ? <div className="px-4 py-4 text-sm text-ink-faint">No open findings due by the end of this period.</div> : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>Finding</th><th>Required action</th><th>Record</th><th>Deadline</th><th>Status</th></tr></thead>
                  <tbody>{r.issues.map((i) => (
                    <tr key={i.id}><td>{i.finding}</td><td>{i.required_action || '—'}</td><td><EntityLink type={i.entity_type} id={i.entity_id} name={ENTITY_LABEL[i.entity_type]} /></td><td className="whitespace-nowrap">{fmtDate(i.deadline)}</td><td><Badge status={i.status} /></td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      )}
      <SourceModal row={source} params={params} onClose={() => setSource(null)} />
    </div>
  );
}

function SourceModal({ row, params, onClose }) {
  const { data, loading } = useLoad(() => (row ? api(`/reports/source${qs({ ...params, category_id: row.category_id })}`) : Promise.resolve([])), [row?.category_id]);
  if (!row) return null;
  return (
    <Modal open onClose={onClose} title={`Source records: ${row.category}`} wide>
      <p className="mb-3 text-sm text-ink-soft">{row.records} record(s), total quantity {row.quantity}. These saved records make up the figure in the report.</p>
      {loading ? <Spinner /> : (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Date</th><th>Outcome</th><th>Qty</th><th>Officer</th><th>Source</th></tr></thead>
            <tbody>{data.map((a) => (
              <tr key={a.id}>
                <td className="whitespace-nowrap">{fmtDate(a.activity_date)}</td><td>{a.outcome || '—'}</td><td className="font-mono">{a.quantity}</td><td className="whitespace-nowrap">{a.recorded_by_name}</td>
                <td className="whitespace-nowrap text-[12px]">
                  {a.linked_inspection_id ? <Link className="text-brand-700 hover:underline" to={`/inspections/${a.linked_inspection_id}`} onClick={onClose}>Inspection #{a.linked_inspection_id}</Link>
                    : a.linked_task_id ? <Link className="text-brand-700 hover:underline" to={`/planner/${a.linked_task_id}`} onClick={onClose}>Task #{a.linked_task_id}</Link>
                    : a.linked_entity_type ? <Link className="text-brand-700 hover:underline" to={`/registers/${a.linked_entity_type}/${a.linked_entity_id}`} onClick={onClose}>{ENTITY_LABEL[a.linked_entity_type]}</Link> : 'Activity log'}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
