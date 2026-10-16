import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { toLocalInput, fromLocalInput, todayStr, addDays, ENTITY_LABEL } from '../lib/format.js';
import { Modal, Button, Field, Input, Select, Textarea, ErrorNote, useToast } from './ui.jsx';
import { REGISTER_KEYS, REGISTERS } from '../lib/registers.js';

export function useLoad(fn, deps = []) {
  const [state, set] = useState({ loading: true, data: null, error: null });
  const reload = () => {
    set((s) => ({ ...s, loading: true }));
    return fn().then((data) => set({ loading: false, data, error: null })).catch((error) => set({ loading: false, data: null, error }));
  };
  useEffect(() => { reload(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload };
}

export const locationLabel = (l) => (l ? [l.village, l.sub_location].filter(Boolean).join(', ') : '');

export function EntityLink({ type, id, name }) {
  if (!type || !id) return <span className="text-ink-faint">—</span>;
  return (
    <Link to={`/registers/${type}/${id}`} className="font-medium text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
      {name || `${ENTITY_LABEL[type]} #${id}`}
    </Link>
  );
}

// Picker for a register entity (type + record)
export function EntityPicker({ type, id, onChange, error, allowNone = true }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!type) { setRows([]); return; }
    api(`/registers/${type}`).then(setRows).catch(() => setRows([]));
  }, [type]);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Linked record type">
        <Select value={type || ''} onChange={(e) => onChange(e.target.value || null, null)} placeholder={allowNone ? 'None' : 'Choose…'}
          options={REGISTER_KEYS.map((k) => ({ value: k, label: REGISTERS[k].singular }))} />
      </Field>
      <Field label="Record" error={error}>
        <Select value={id || ''} onChange={(e) => onChange(type, e.target.value ? Number(e.target.value) : null)} disabled={!type} placeholder="Choose…"
          options={rows.map((r) => ({ value: r.id, label: r[REGISTERS[type].nameField] }))} error={error} />
      </Field>
    </div>
  );
}

export function TaskForm({ open, onClose, onSaved, task, preset = {} }) {
  const { me, can, lookups } = useAuth();
  const blank = () => ({
    title: '', description: '', category_id: '', assigned_to: me.user.id, due_at: toLocalInput(new Date(Date.now() + 86400000).toISOString()).slice(0, 11) + '09:00',
    reminder_at: '', priority: 'normal', location_id: '', linked_entity_type: null, linked_entity_id: null, notes: '', ...preset
  });
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState({}); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (!open) return;
    setErrors({}); setErr(null);
    setF(task ? { ...task, due_at: toLocalInput(task.due_at), reminder_at: toLocalInput(task.reminder_at), category_id: task.category_id || '', location_id: task.location_id || '' } : blank());
  }, [open, task]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    const localErr = {};
    if (!f.title.trim()) localErr.title = 'Give the task a short title.';
    if (!f.due_at) localErr.due_at = 'Choose when the task is due.';
    if (Object.keys(localErr).length) return setErrors(localErr);
    setBusy(true); setErr(null);
    const body = {
      title: f.title, description: f.description, category_id: f.category_id || null, assigned_to: Number(f.assigned_to),
      due_at: fromLocalInput(f.due_at), reminder_at: fromLocalInput(f.reminder_at), priority: f.priority, location_id: f.location_id || null,
      linked_entity_type: f.linked_entity_type || null, linked_entity_id: f.linked_entity_id || null, notes: f.notes
    };
    try {
      if (task) await api(`/tasks/${task.id}`, { method: 'PATCH', body });
      else await api('/tasks', { method: 'POST', body });
      toast(task ? 'Task updated' : 'Task created');
      onSaved?.(); onClose();
    } catch (e) { setErr(e.message); setErrors(e.errors || {}); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={task ? 'Edit task' : 'New task'} wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>{task ? 'Save changes' : 'Create task'}</Button></>}>
      <ErrorNote error={err} />
      <div className="grid gap-4">
        <Field label="Title" required error={errors.title}><Input value={f.title} onChange={set('title')} placeholder="e.g. Inspect Upendo Cafe" autoFocus /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" error={errors.category_id} hint="Needed for the work to count in reports.">
            <Select value={f.category_id} onChange={set('category_id')} placeholder="Choose…" options={lookups.categories.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
          <Field label="Assigned officer" error={errors.assigned_to} hint={can.lead ? '' : 'Only the ward lead can assign to others.'}>
            <Select value={f.assigned_to} onChange={set('assigned_to')} disabled={!can.lead} options={lookups.officers.map((o) => ({ value: o.id, label: o.full_name }))} />
          </Field>
          <Field label="Due date and time" required error={errors.due_at}><Input type="datetime-local" value={f.due_at} onChange={set('due_at')} /></Field>
          <Field label="Reminder" error={errors.reminder_at} hint="In app reminder at this time (Nairobi time)."><Input type="datetime-local" value={f.reminder_at || ''} onChange={set('reminder_at')} /></Field>
          <Field label="Priority"><Select value={f.priority} onChange={set('priority')} options={['low', 'normal', 'high']} /></Field>
          <Field label="Location" error={errors.location_id}>
            <Select value={f.location_id} onChange={set('location_id')} placeholder="Not specified" options={lookups.locations.map((l) => ({ value: l.id, label: locationLabel(l) }))} />
          </Field>
        </div>
        <EntityPicker type={f.linked_entity_type} id={f.linked_entity_id} error={errors.linked_entity_id}
          onChange={(t, i) => setF({ ...f, linked_entity_type: t, linked_entity_id: i })} />
        <Field label="Description"><Textarea value={f.description || ''} onChange={set('description')} rows={3} /></Field>
      </div>
    </Modal>
  );
}

export function FollowUpForm({ open, onClose, onSaved, preset = {} }) {
  const { me, lookups } = useAuth();
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({}); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (open) { setF({ action_required: '', responsible_user_id: me.user.id, due_date: addDays(todayStr(), 7), linked_entity_type: null, linked_entity_id: null, ...preset }); setErrors({}); setErr(null); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api('/follow-ups', { method: 'POST', body: f }); toast('Follow up created'); onSaved?.(); onClose(); }
    catch (e) { setErr(e.message); setErrors(e.errors || {}); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="New follow up"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Create follow up</Button></>}>
      <ErrorNote error={err} />
      <div className="grid gap-4">
        <Field label="Action required" required error={errors.action_required}><Textarea rows={2} value={f.action_required || ''} onChange={(e) => setF({ ...f, action_required: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Responsible officer" required error={errors.responsible_user_id}>
            <Select value={f.responsible_user_id || ''} onChange={(e) => setF({ ...f, responsible_user_id: Number(e.target.value) })} options={lookups.officers.map((o) => ({ value: o.id, label: o.full_name }))} />
          </Field>
          <Field label="Due date" required error={errors.due_date}><Input type="date" value={f.due_date || ''} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
        </div>
        {!preset.linked_entity_type && <EntityPicker type={f.linked_entity_type} id={f.linked_entity_id} error={errors.linked_entity_id} onChange={(t, i) => setF({ ...f, linked_entity_type: t, linked_entity_id: i })} />}
      </div>
    </Modal>
  );
}

export function NoticeForm({ open, onClose, preset = {}, onCreated }) {
  const { lookups } = useAuth();
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({}); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setF({ template_id: lookups.templates[0]?.id || '', recipient: '', findings: '', corrective_action: '', compliance_deadline: addDays(todayStr(), 14), linked_entity_type: null, linked_entity_id: null, ...preset }); setErrors({}); setErr(null); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true); setErr(null);
    try { const r = await api('/notices', { method: 'POST', body: f }); onCreated?.(r.id); onClose(); }
    catch (e) { setErr(e.message); setErrors(e.errors || {}); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Draft a notice" wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Generate draft</Button></>}>
      <div className="mb-4 rounded-lg border border-ochre-100 bg-ochre-50 px-3 py-2.5 text-[13px] text-ochre-700">
        This creates a <b>draft</b> from an approved template. It must be reviewed and approved before printing for issue. Saving or printing does not mean the notice was served.
      </div>
      <ErrorNote error={err} />
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Approved template" required error={errors.template_id}><Select value={f.template_id || ''} onChange={set('template_id')} options={lookups.templates.map((t) => ({ value: t.id, label: t.name }))} /></Field>
          <Field label="Recipient" required error={errors.recipient}><Input value={f.recipient || ''} onChange={set('recipient')} placeholder="Owner / occupier" /></Field>
        </div>
        {!preset.linked_entity_type && <EntityPicker type={f.linked_entity_type} id={f.linked_entity_id} error={errors.linked_entity_id} onChange={(t, i) => setF({ ...f, linked_entity_type: t, linked_entity_id: i })} />}
        <Field label="Findings"><Textarea rows={3} value={f.findings || ''} onChange={set('findings')} /></Field>
        <Field label="Corrective action required"><Textarea rows={3} value={f.corrective_action || ''} onChange={set('corrective_action')} /></Field>
        <Field label="Compliance deadline" error={errors.compliance_deadline}><Input type="date" value={f.compliance_deadline || ''} onChange={set('compliance_deadline')} /></Field>
      </div>
    </Modal>
  );
}
