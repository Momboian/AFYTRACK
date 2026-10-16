import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, List, CalendarDays, ChevronLeft, ChevronRight, ArrowLeft, Pencil, CheckCircle2, PlayCircle, Clock, XCircle, Trash2 } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, fmtDateTime, fmtTime, todayStr, addDays, toLocalInput, fromLocalInput, humanize, ENTITY_LABEL } from '../lib/format.js';
import { Badge, Card, PageHeader, Spinner, Button, Empty, Tabs, Select, Input, Field, Textarea, Modal, ErrorNote, useToast } from '../components/ui.jsx';
import { useLoad, TaskForm, EntityLink, FollowUpForm } from '../components/forms.jsx';

const weekStart = (d) => { const dow = (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7; return addDays(d, -dow); };
const nairobiDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date(iso));

export default function Planner() {
  const { can, lookups, me } = useAuth();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'week' ? 'week' : 'list';
  const status = params.get('status') || (params.get('view') === 'today' ? 'today' : 'open');
  const [officer, setOfficer] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [anchor, setAnchor] = useState(weekStart(todayStr()));
  const [open, setOpen] = useState(false);
  const nav = useNavigate();

  const query = useMemo(() => {
    const base = { assigned_to: officer, category_id: category, q };
    if (view === 'week') return { ...base, from: anchor, to: addDays(anchor, 6) };
    if (status === 'today') return { ...base, status: 'open', from: todayStr(), to: todayStr() };
    if (status === 'all') return base;
    return { ...base, status };
  }, [view, status, officer, category, q, anchor]);
  const { data, loading, reload } = useLoad(() => api(`/tasks${qs(query)}`), [JSON.stringify(query), me.ward?.id]);
  const setParam = (k, v) => { const p = new URLSearchParams(params); v ? p.set(k, v) : p.delete(k); setParams(p, { replace: true }); };

  return (
    <div>
      <PageHeader title="Planner" subtitle="Plan daily, weekly and monthly work. Overdue status is worked out from the due date."
        actions={<>
          <div className="flex rounded-lg border border-line bg-white p-0.5">
            <button onClick={() => setParam('view', '')} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold ${view === 'list' ? 'bg-brand-700 text-white' : 'text-ink-soft'}`}><List className="h-4 w-4" />List</button>
            <button onClick={() => setParam('view', 'week')} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold ${view === 'week' ? 'bg-brand-700 text-white' : 'text-ink-soft'}`}><CalendarDays className="h-4 w-4" />Week</button>
          </div>
          {can.write && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New task</Button>}
        </>} />

      {view === 'list' && (
        <Tabs value={status} onChange={(v) => setParam('status', v === 'open' ? '' : v)}
          tabs={[{ value: 'today', label: 'Today' }, { value: 'open', label: 'Open' }, { value: 'overdue', label: 'Overdue' }, { value: 'postponed', label: 'Postponed' },
            { value: 'completed', label: 'Completed' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'all', label: 'All' }]} />
      )}

      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_200px_220px]">
        <Input placeholder="Search tasks…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} placeholder="All categories" options={lookups.categories.map((c) => ({ value: c.id, label: c.name }))} />
        {(can.lead || me.role === 'reviewer') && <Select value={officer} onChange={(e) => setOfficer(e.target.value)} placeholder="All officers" options={lookups.officers.map((o) => ({ value: o.id, label: o.full_name }))} />}
      </div>

      {view === 'week' ? (
        <WeekView anchor={anchor} setAnchor={setAnchor} tasks={data || []} loading={loading} />
      ) : loading && !data ? <Spinner /> : (
        <Card className="overflow-hidden">
          {data.length === 0 ? <Empty title="No tasks match">Change the filters or create a new task.</Empty> : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Due</th><th>Task</th><th className="hidden md:table-cell">Linked to</th><th className="hidden sm:table-cell">Officer</th><th>Status</th></tr></thead>
                <tbody>
                  {data.map((t) => (
                    <tr key={t.id} className="clickable" onClick={() => nav(`/planner/${t.id}`)}>
                      <td className={`whitespace-nowrap font-semibold ${t.is_overdue ? 'text-red-600' : ''}`}>{fmtDateTime(t.due_at)}</td>
                      <td><div className="font-semibold">{t.title}</div><div className="text-[12px] text-ink-faint">{t.category || 'No category'}{t.priority === 'high' ? ' · High priority' : ''}</div></td>
                      <td className="hidden md:table-cell"><EntityLink type={t.linked_entity_type} id={t.linked_entity_id} name={t.entity_name} /></td>
                      <td className="hidden sm:table-cell whitespace-nowrap">{t.assigned_name}</td>
                      <td><Badge status={t.is_overdue ? 'overdue' : t.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      <TaskForm open={open} onClose={() => setOpen(false)} onSaved={reload} />
    </div>
  );
}

function WeekView({ anchor, setAnchor, tasks, loading }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(anchor, i));
  const today = todayStr();
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setAnchor(addDays(anchor, -7))}><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="secondary" size="sm" onClick={() => setAnchor(weekStart(todayStr()))}>This week</Button>
        <Button variant="secondary" size="sm" onClick={() => setAnchor(addDays(anchor, 7))}><ChevronRight className="h-4 w-4" /></Button>
        <span className="ml-2 text-sm font-semibold text-ink-soft">{fmtDate(anchor)} to {fmtDate(addDays(anchor, 6))}</span>
        {loading && <span className="text-[12px] text-ink-faint">Loading…</span>}
      </div>
      <div className="grid gap-2 md:grid-cols-7">
        {days.map((d) => {
          const list = tasks.filter((t) => nairobiDate(t.due_at) === d);
          return (
            <div key={d} className={`min-h-[140px] rounded-xl border bg-white p-2 ${d === today ? 'border-brand-500 ring-2 ring-brand-100' : 'border-line'}`}>
              <div className="mb-2 flex items-baseline justify-between px-1">
                <span className="text-[12px] font-bold uppercase tracking-wide text-ink-faint">{new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
                <span className={`text-sm font-bold ${d === today ? 'text-brand-700' : ''}`}>{Number(d.slice(8))}</span>
              </div>
              <div className="space-y-1.5">
                {list.map((t) => (
                  <Link key={t.id} to={`/planner/${t.id}`} className={`block rounded-lg border-l-[3px] px-2 py-1.5 text-[12px] leading-snug hover:shadow ${t.is_overdue ? 'border-red-500 bg-red-50' : t.status === 'completed' ? 'border-brand-500 bg-brand-50 text-ink-soft line-through' : t.status === 'cancelled' ? 'border-stone-300 bg-stone-50 text-ink-faint line-through' : 'border-sky-500 bg-sky-50'}`}>
                    <div className="font-mono text-[11px] text-ink-faint">{fmtTime(t.due_at)}</div>
                    <div className="font-semibold">{t.title}</div>
                    <div className="text-[11px] text-ink-faint">{t.assigned_name}</div>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TaskDetail() {
  const { id } = useParams();
  const { can, me, lookups } = useAuth();
  const { data: t, loading, error, reload } = useLoad(() => api(`/tasks/${id}`), [id]);
  const [edit, setEdit] = useState(false);
  const [action, setAction] = useState(null);
  const [fuOpen, setFuOpen] = useState(false);
  const toast = useToast();
  const nav = useNavigate();
  if (loading && !t) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  const mine = t.assigned_to === me.user.id || t.created_by === me.user.id;
  const canAct = can.write && (can.lead || mine);
  const isOpen = ['planned', 'in_progress', 'postponed'].includes(t.status);

  const start = async () => { await api(`/tasks/${t.id}`, { method: 'PATCH', body: { status: 'in_progress' } }); toast('Marked in progress'); reload(); };
  const del = async () => { if (!confirm('Remove this task? It stays in the audit history.')) return; await api(`/tasks/${t.id}`, { method: 'DELETE' }); nav('/planner'); };

  return (
    <div className="max-w-4xl">
      <Link to="/planner" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink"><ArrowLeft className="h-4 w-4" />Planner</Link>
      <PageHeader title={t.title} eyebrow={t.category || 'Task'}
        actions={canAct && <>
          {isOpen && t.status !== 'in_progress' && <Button variant="secondary" onClick={start}><PlayCircle className="h-4 w-4" />Start</Button>}
          {isOpen && <Button onClick={() => setAction('complete')}><CheckCircle2 className="h-4 w-4" />Complete</Button>}
          {isOpen && <Button variant="secondary" onClick={() => setAction('postpone')}><Clock className="h-4 w-4" />Postpone</Button>}
          {isOpen && <Button variant="secondary" onClick={() => setAction('cancel')}><XCircle className="h-4 w-4" />Cancel</Button>}
          <Button variant="ghost" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" />Edit</Button>
          {can.lead && <Button variant="ghost" onClick={del}><Trash2 className="h-4 w-4" /></Button>}
        </>} />

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Card className="p-5">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div><dt className="label">Status</dt><dd><Badge status={t.is_overdue ? 'overdue' : t.status} /> {t.is_overdue && <span className="ml-1 text-[12px] text-ink-faint">({humanize(t.status)})</span>}</dd></div>
            <div><dt className="label">Priority</dt><dd>{humanize(t.priority)}</dd></div>
            <div><dt className="label">Due</dt><dd className={t.is_overdue ? 'font-semibold text-red-600' : ''}>{fmtDateTime(t.due_at)}</dd></div>
            <div><dt className="label">Reminder</dt><dd>{t.reminder_at ? fmtDateTime(t.reminder_at) : 'None'}</dd></div>
            <div><dt className="label">Assigned to</dt><dd>{t.assigned_name}</dd></div>
            <div><dt className="label">Created by</dt><dd>{t.created_by_name}</dd></div>
            <div><dt className="label">Location</dt><dd>{t.sub_location ? `${t.village || ''}${t.village ? ', ' : ''}${t.sub_location}` : '—'}</dd></div>
            <div><dt className="label">Linked record</dt><dd><EntityLink type={t.linked_entity_type} id={t.linked_entity_id} name={t.entity_name} />{t.linked_entity_type && <div className="text-[12px] text-ink-faint">{ENTITY_LABEL[t.linked_entity_type]}</div>}</dd></div>
            {t.completed_at && <div><dt className="label">Completed</dt><dd>{fmtDateTime(t.completed_at)}</dd></div>}
            {t.status_reason && <div className="col-span-2"><dt className="label">Reason</dt><dd>{t.status_reason}</dd></div>}
            {t.description && <div className="col-span-2"><dt className="label">Description</dt><dd className="whitespace-pre-wrap">{t.description}</dd></div>}
          </dl>
          {t.activity && (
            <div className="mt-5 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2.5 text-sm text-brand-800">
              Counted in reports as 1 activity record dated {fmtDate(t.activity.activity_date)} (quantity {t.activity.quantity}).
            </div>
          )}
          {canAct && (
            <div className="mt-5 border-t border-line pt-4">
              <Button variant="secondary" size="sm" onClick={() => setFuOpen(true)}><Plus className="h-4 w-4" />Add follow up</Button>
            </div>
          )}
        </Card>

        <Card>
          <div className="border-b border-line px-4 py-3 font-bold">History</div>
          <ol className="px-4 py-3">
            {t.history.map((h) => (
              <li key={h.id} className="relative border-l-2 border-line pb-3 pl-4 last:pb-0">
                <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-brand-500" />
                <div className="text-[13px]"><b>{h.full_name || 'System'}</b> {h.field === 'created' ? 'created the task' : h.field === 'status' ? <>changed status <Badge status={h.old_value} /> → <Badge status={h.new_value} /></> : <>changed {humanize(h.field)}</>}</div>
                {h.field === 'due_at' && <div className="text-[12px] text-ink-soft">{fmtDateTime(h.old_value)} → {fmtDateTime(h.new_value)}</div>}
                {h.reason && <div className="text-[12px] italic text-ink-soft">“{h.reason}”</div>}
                <div className="text-[11px] text-ink-faint">{fmtDateTime(h.at.includes('T') ? h.at : h.at.replace(' ', 'T') + 'Z')}</div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <TaskForm open={edit} onClose={() => setEdit(false)} onSaved={reload} task={t} />
      <StatusModal task={t} action={action} onClose={() => setAction(null)} onDone={reload} lookups={lookups} />
      <FollowUpForm open={fuOpen} onClose={() => setFuOpen(false)} preset={{ linked_entity_type: t.linked_entity_type, linked_entity_id: t.linked_entity_id, action_required: t.next_action || '' }} />
    </div>
  );
}

function StatusModal({ task, action, onClose, onDone }) {
  const [f, setF] = useState({});
  const [err, setErr] = useState(null); const [errors, setErrors] = useState({}); const [busy, setBusy] = useState(false);
  const toast = useToast();
  const key = action + task.id;
  const [lastKey, setLastKey] = useState(null);
  if (action && key !== lastKey) {
    setLastKey(key);
    setF({ record: !!task.category_id, activity_date: todayStr(), quantity: 1, outcome: '', reason: '', due_at: toLocalInput(new Date(new Date(task.due_at).getTime() + 2 * 86400000).toISOString()) });
    setErr(null); setErrors({});
  }
  const save = async () => {
    setBusy(true); setErr(null);
    let body;
    if (action === 'complete') body = { status: 'completed', ...(f.record ? { record_activity: { activity_date: f.activity_date, quantity: Number(f.quantity) || 1, outcome: f.outcome } } : {}) };
    if (action === 'postpone') body = { status: 'postponed', due_at: fromLocalInput(f.due_at), status_reason: f.reason };
    if (action === 'cancel') body = { status: 'cancelled', status_reason: f.reason };
    try { await api(`/tasks/${task.id}`, { method: 'PATCH', body }); toast(`Task ${action === 'complete' ? 'completed' : action === 'postpone' ? 'postponed' : 'cancelled'}`); onDone(); onClose(); }
    catch (e) { setErr(e.message); setErrors(e.errors || {}); } finally { setBusy(false); }
  };
  const titles = { complete: 'Complete task', postpone: 'Postpone task', cancel: 'Cancel task' };
  return (
    <Modal open={!!action} onClose={onClose} title={titles[action]}
      footer={<><Button variant="secondary" onClick={onClose}>Back</Button><Button onClick={save} loading={busy} variant={action === 'cancel' ? 'danger' : 'primary'}>{titles[action]}</Button></>}>
      <ErrorNote error={err} />
      {action === 'complete' && (
        <div className="space-y-4">
          <label className="flex items-start gap-3 rounded-lg border border-line p-3">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-700" checked={!!f.record} onChange={(e) => setF({ ...f, record: e.target.checked })} />
            <span><span className="block text-sm font-semibold">Record this as an activity</span><span className="text-[12px] text-ink-soft">Counts once in weekly and monthly reports. Leave unticked if you already recorded it through an inspection.</span></span>
          </label>
          {errors.category_id && <div className="text-[13px] text-red-600">{errors.category_id}</div>}
          {f.record && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Activity date" error={errors.activity_date}><Input type="date" value={f.activity_date} max={todayStr()} onChange={(e) => setF({ ...f, activity_date: e.target.value })} /></Field>
              <Field label="Quantity" hint="e.g. number of households visited"><Input type="number" min="1" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
              <Field label="Result / outcome" className="sm:col-span-2"><Textarea rows={2} value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} /></Field>
            </div>
          )}
        </div>
      )}
      {action === 'postpone' && (
        <div className="space-y-4">
          <Field label="New due date and time" required error={errors.due_at} hint="The old due date is kept in the task history."><Input type="datetime-local" value={f.due_at} onChange={(e) => setF({ ...f, due_at: e.target.value })} /></Field>
          <Field label="Reason" required error={errors.status_reason}><Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        </div>
      )}
      {action === 'cancel' && (
        <Field label="Why is this task cancelled?" required error={errors.status_reason}><Textarea rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      )}
    </Modal>
  );
}
