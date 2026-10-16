import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, todayStr, addDays } from '../lib/format.js';
import { Card, PageHeader, Spinner, Button, Empty, Select, Input, Field, Textarea, Modal, ErrorNote, useToast } from '../components/ui.jsx';
import { useLoad, EntityLink, EntityPicker, locationLabel } from '../components/forms.jsx';

export default function Activities() {
  const { can, lookups, me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({ from: addDays(todayStr(), -30), to: todayStr(), category_id: '', recorded_by: '' });
  const { data, loading, reload } = useLoad(() => api(`/activities${qs(filters)}`), [JSON.stringify(filters), me.ward?.id]);
  const [open, setOpen] = useState(params.get('new') === '1');
  const toast = useToast();
  const remove = async (a) => {
    if (!confirm('Remove this activity record? It will no longer count in reports. The change is logged.')) return;
    try { await api(`/activities/${a.id}`, { method: 'DELETE' }); toast('Record removed'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const total = (data || []).reduce((s, a) => s + a.quantity, 0);

  return (
    <div>
      <PageHeader title="Activity log" subtitle="Completed work recorded here is the source for report totals. Inspections and samples add records automatically."
        actions={can.write && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Record activity</Button>} />
      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        <Field label="From"><Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></Field>
        <Field label="To"><Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></Field>
        <Field label="Category"><Select value={filters.category_id} onChange={(e) => setFilters({ ...filters, category_id: e.target.value })} placeholder="All" options={lookups.categories.map((c) => ({ value: c.id, label: c.name }))} /></Field>
        {(can.lead || me.role === 'reviewer') && <Field label="Officer"><Select value={filters.recorded_by} onChange={(e) => setFilters({ ...filters, recorded_by: e.target.value })} placeholder="All" options={lookups.officers.map((o) => ({ value: o.id, label: o.full_name }))} /></Field>}
      </div>
      {loading && !data ? <Spinner /> : (
        <Card className="overflow-hidden">
          {data.length === 0 ? <Empty title="No activity in this period">Record completed field work, or complete a task with “record this as an activity”.</Empty> : (
            <>
              <div className="border-b border-line bg-paper/50 px-4 py-2 text-[13px] text-ink-soft">{data.length} records · total quantity {total}</div>
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>Date</th><th>Category</th><th>Outcome</th><th className="hidden md:table-cell">Linked</th><th className="hidden sm:table-cell">Qty</th><th className="hidden lg:table-cell">Officer</th><th></th></tr></thead>
                  <tbody>
                    {data.map((a) => (
                      <tr key={a.id}>
                        <td className="whitespace-nowrap font-semibold">{fmtDate(a.activity_date)}</td>
                        <td>{a.category}<div className="text-[12px] text-ink-faint">{a.sub_location || ''}{a.linked_inspection_id ? ' · from inspection' : a.linked_task_id ? ' · from task' : ''}</div></td>
                        <td className="max-w-xs">{a.outcome || <span className="text-ink-faint">—</span>}</td>
                        <td className="hidden md:table-cell"><EntityLink type={a.linked_entity_type} id={a.linked_entity_id} name={a.entity_name} /></td>
                        <td className="hidden sm:table-cell">{a.quantity} <span className="text-[12px] text-ink-faint">{a.unit}</span></td>
                        <td className="hidden lg:table-cell whitespace-nowrap">{a.recorded_by_name}</td>
                        <td>{can.write && (can.lead || a.recorded_by === me.user.id) && <button onClick={() => remove(a)} className="rounded p-1 text-ink-faint hover:bg-red-50 hover:text-red-600" aria-label="Remove"><Trash2 className="h-4 w-4" /></button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}
      <ActivityForm open={open} onClose={() => { setOpen(false); if (params.get('new')) setParams({}, { replace: true }); }} onSaved={reload} />
    </div>
  );
}

function ActivityForm({ open, onClose, onSaved }) {
  const { lookups } = useAuth();
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({}); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { if (open) { setF({ category_id: '', activity_date: todayStr(), quantity: 1, unit: 'activities', outcome: '', notes: '', location_id: '', linked_entity_type: null, linked_entity_id: null }); setErrors({}); setErr(null); } }, [open]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api('/activities', { method: 'POST', body: { ...f, quantity: Number(f.quantity) } }); toast('Activity recorded'); onSaved(); onClose(); }
    catch (e) { setErr(e.message); setErrors(e.errors || {}); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Record activity" wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save record</Button></>}>
      <ErrorNote error={err} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" required error={errors.category_id}><Select value={f.category_id} onChange={set('category_id')} placeholder="Choose…" options={lookups.categories.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="Activity date" required error={errors.activity_date}><Input type="date" max={todayStr()} value={f.activity_date} onChange={set('activity_date')} /></Field>
        <Field label="Quantity" error={errors.quantity} hint="Visits, people reached, samples… one record is counted once."><Input type="number" min="1" value={f.quantity} onChange={set('quantity')} /></Field>
        <Field label="Unit"><Select value={f.unit} onChange={set('unit')} options={['activities', 'visits', 'households', 'people_reached', 'samples', 'sessions']} /></Field>
        <Field label="Location" className="sm:col-span-2"><Select value={f.location_id} onChange={set('location_id')} placeholder="Not specified" options={lookups.locations.map((l) => ({ value: l.id, label: locationLabel(l) }))} /></Field>
        <div className="sm:col-span-2"><EntityPicker type={f.linked_entity_type} id={f.linked_entity_id} error={errors.linked_entity_id} onChange={(t, i) => setF({ ...f, linked_entity_type: t, linked_entity_id: i })} /></div>
        <Field label="Result / outcome" className="sm:col-span-2"><Textarea rows={2} value={f.outcome} onChange={set('outcome')} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}
