import { useEffect, useState } from 'react';
import { Plus, KeyRound, Trash2 } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useAuth, ROLE_LABEL } from '../lib/auth.jsx';
import { fmtDate, fmtDateTime, todayStr, humanize } from '../lib/format.js';
import { REGISTERS, REGISTER_KEYS } from '../lib/registers.js';
import { Badge, Card, PageHeader, Spinner, Button, Empty, Tabs, Select, Input, Field, Textarea, Modal, ErrorNote, useToast } from '../components/ui.jsx';
import { useLoad, locationLabel } from '../components/forms.jsx';

export default function SettingsPage() {
  const { can } = useAuth();
  const tabs = [
    ...(can.lead ? [{ value: 'targets', label: 'Targets' }] : []),
    ...(can.admin || can.lead ? [{ value: 'users', label: 'Users and roles' }] : []),
    ...(can.lead ? [{ value: 'locations', label: 'Locations' }] : []),
    ...(can.admin ? [{ value: 'categories', label: 'Categories' }, { value: 'templates', label: 'Templates and checklists' }] : []),
    ...(can.audit ? [{ value: 'audit', label: 'Audit history' }] : [])
  ];
  const [tab, setTab] = useState(tabs[0]?.value);
  if (!tabs.length) return <ErrorNote error="You do not have access to settings." />;
  return (
    <div>
      <PageHeader title="Settings" subtitle="Role gated configuration. Every change is recorded in the audit history." />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'targets' && <Targets />}
      {tab === 'users' && <Users />}
      {tab === 'locations' && <Locations />}
      {tab === 'categories' && <Categories />}
      {tab === 'templates' && <Templates />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}

function Targets() {
  const { lookups, me } = useAuth();
  const { data, loading, reload } = useLoad(() => api('/targets'), [me.ward?.id]);
  const [f, setF] = useState({ category_id: '', period_type: 'monthly', period_month: todayStr().slice(0, 7), period_date: todayStr(), target_value: '', user_id: '' });
  const [errors, setErrors] = useState({}); const [busy, setBusy] = useState(false);
  const toast = useToast();
  const add = async () => {
    setBusy(true); setErrors({});
    try { await api('/targets', { method: 'POST', body: f }); toast('Target saved'); reload(); setF({ ...f, target_value: '' }); }
    catch (e) { setErrors(e.errors || { _: e.message }); } finally { setBusy(false); }
  };
  const del = async (t) => { if (!confirm('Remove this target?')) return; await api(`/targets/${t.id}`, { method: 'DELETE' }); reload(); };
  return (
    <div className="space-y-5">
      <Card className="p-4">
        <h3 className="mb-3 font-bold">Set a target</h3>
        <ErrorNote error={errors._} />
        <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Category" error={errors.category_id} className="lg:col-span-2"><Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })} placeholder="Choose…" options={lookups.categories.map((c) => ({ value: c.id, label: c.name }))} /></Field>
          <Field label="Period"><Select value={f.period_type} onChange={(e) => setF({ ...f, period_type: e.target.value })} options={['weekly', 'monthly']} /></Field>
          {f.period_type === 'monthly'
            ? <Field label="Month" error={errors.period_month}><Input type="month" value={f.period_month} onChange={(e) => setF({ ...f, period_month: e.target.value })} /></Field>
            : <Field label="Day in week" error={errors.period_date}><Input type="date" value={f.period_date} onChange={(e) => setF({ ...f, period_date: e.target.value })} /></Field>}
          <Field label="Target" error={errors.target_value}><Input type="number" min="0" value={f.target_value} onChange={(e) => setF({ ...f, target_value: e.target.value })} /></Field>
          <Field label="For"><Select value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value })} placeholder="Whole ward" options={lookups.officers.map((o) => ({ value: o.id, label: o.full_name }))} /></Field>
        </div>
        <div className="mt-3 flex justify-end"><Button onClick={add} loading={busy}><Plus className="h-4 w-4" />Save target</Button></div>
      </Card>
      {loading && !data ? <Spinner /> : (
        <Card className="overflow-hidden">
          {data.length === 0 ? <Empty title="No targets set">Without a target, reports show achievement as N/A.</Empty> : (
            <div className="overflow-x-auto"><table className="tbl">
              <thead><tr><th>Category</th><th>Period</th><th>For</th><th className="text-right">Target</th><th>Approved by</th><th></th></tr></thead>
              <tbody>{data.map((t) => (
                <tr key={t.id}><td className="font-medium">{t.category}</td><td className="whitespace-nowrap">{humanize(t.period_type)} · {fmtDate(t.period_start)} to {fmtDate(t.period_end)}</td>
                  <td>{t.officer_name || 'Whole ward'}</td><td className="text-right font-mono font-bold">{t.target_value}</td><td className="whitespace-nowrap text-[13px]">{t.approved_by_name}<div className="text-[11px] text-ink-faint">{fmtDateTime(t.created_at)}</div></td>
                  <td><button onClick={() => del(t)} className="rounded p-1 text-ink-faint hover:text-red-600" aria-label="Remove"><Trash2 className="h-4 w-4" /></button></td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      )}
    </div>
  );
}

function Users() {
  const { can } = useAuth();
  const { data, loading, reload } = useLoad(() => api('/users'), []);
  const { data: wards } = useLoad(() => api('/wards'), []);
  const [edit, setEdit] = useState(null);
  const [temp, setTemp] = useState(null);
  const toast = useToast();
  const toggle = async (u) => {
    if (!confirm(u.active ? `Deactivate ${u.full_name}? They can no longer sign in. Their records are kept.` : `Reactivate ${u.full_name}?`)) return;
    try { await api(`/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }); toast('Updated'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const resetPw = async (u) => {
    if (!confirm(`Generate a new temporary password for ${u.full_name}?`)) return;
    const r = await api(`/users/${u.id}/reset-password`, { method: 'POST' }); setTemp({ name: u.full_name, pw: r.temporary_password });
  };
  if (loading && !data) return <Spinner />;
  return (
    <div>
      {can.admin && <div className="mb-3 flex justify-end"><Button onClick={() => setEdit({})}><Plus className="h-4 w-4" />Invite user</Button></div>}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto"><table className="tbl">
          <thead><tr><th>Name</th><th>Roles</th><th>Status</th><th className="hidden md:table-cell">Last sign in</th>{can.admin && <th></th>}</tr></thead>
          <tbody>{data.map((u) => (
            <tr key={u.id}>
              <td><div className="font-semibold">{u.full_name}</div><div className="text-[12px] text-ink-faint">{u.email}</div></td>
              <td><div className="flex flex-wrap gap-1">{u.is_admin ? <Badge tone="violet">System Administrator</Badge> : null}{u.memberships.filter((m) => !m.active_to).map((m) => <Badge key={m.id} tone="blue">{ROLE_LABEL[m.role]} · {m.ward_name}</Badge>)}</div></td>
              <td><Badge status={u.active ? 'completed' : 'cancelled'}>{u.active ? 'Active' : 'Deactivated'}</Badge></td>
              <td className="hidden md:table-cell whitespace-nowrap text-[13px]">{fmtDateTime(u.last_login_at)}</td>
              {can.admin && <td className="whitespace-nowrap text-right">
                <Button size="sm" variant="ghost" onClick={() => setEdit(u)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => resetPw(u)}><KeyRound className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="ghost" onClick={() => toggle(u)}>{u.active ? 'Deactivate' : 'Reactivate'}</Button>
              </td>}
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
      <UserModal user={edit} wards={wards || []} onClose={() => setEdit(null)} onSaved={(pw, name) => { reload(); if (pw) setTemp({ name, pw }); }} />
      <Modal open={!!temp} onClose={() => setTemp(null)} title="Temporary password" footer={<Button onClick={() => setTemp(null)}>Done</Button>}>
        <p className="text-sm text-ink-soft">Share this securely with <b>{temp?.name}</b>. Ask them to change it after signing in. It will not be shown again.</p>
        <div className="mt-3 rounded-lg bg-paper px-4 py-3 text-center font-mono text-lg font-bold tracking-wider">{temp?.pw}</div>
      </Modal>
    </div>
  );
}

function UserModal({ user, wards, onClose, onSaved }) {
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({}); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (user) setF({ full_name: user.full_name || '', email: user.email || '', phone: user.phone || '', is_admin: !!user.is_admin,
      memberships: user.memberships ? user.memberships.filter((m) => !m.active_to).map((m) => ({ ward_id: m.ward_id, role: m.role })) : [{ ward_id: wards[0]?.id, role: 'officer' }] });
    setErrors({}); setErr(null);
  }, [user]); // eslint-disable-line
  if (!user) return null;
  const isNew = !user.id;
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      if (isNew) { const r = await api('/users', { method: 'POST', body: f }); onSaved(r.temporary_password, f.full_name); }
      else { await api(`/users/${user.id}`, { method: 'PATCH', body: { full_name: f.full_name, phone: f.phone, is_admin: f.is_admin, memberships: f.memberships } }); onSaved(); }
      onClose();
    } catch (e) { setErr(e.message); setErrors(e.errors || {}); } finally { setBusy(false); }
  };
  const setM = (i, k, v) => setF({ ...f, memberships: f.memberships.map((m, j) => j === i ? { ...m, [k]: k === 'ward_id' ? Number(v) : v } : m) });
  return (
    <Modal open onClose={onClose} title={isNew ? 'Invite user' : 'Edit user'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>{isNew ? 'Create account' : 'Save'}</Button></>}>
      <ErrorNote error={err} />
      <div className="grid gap-4">
        <Field label="Full name" required error={errors.full_name}><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Email (sign in)" required error={errors.email}><Input type="email" value={f.email} disabled={!isNew} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Phone (optional)"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <div>
          <div className="label">Ward roles</div>
          {errors.memberships && <div className="mb-1 text-[13px] text-red-600">{errors.memberships}</div>}
          <div className="space-y-2">
            {f.memberships?.map((m, i) => (
              <div key={i} className="flex gap-2">
                <Select value={m.ward_id} onChange={(e) => setM(i, 'ward_id', e.target.value)} options={wards.map((w) => ({ value: w.id, label: w.name }))} />
                <Select value={m.role} onChange={(e) => setM(i, 'role', e.target.value)} options={[{ value: 'officer', label: 'PHO / Officer' }, { value: 'ward_lead', label: 'Ward PHO (lead)' }, { value: 'reviewer', label: 'Read only reviewer' }]} />
                <Button variant="ghost" onClick={() => setF({ ...f, memberships: f.memberships.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setF({ ...f, memberships: [...(f.memberships || []), { ward_id: wards[0]?.id, role: 'officer' }] })}><Plus className="h-4 w-4" />Add role</Button>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={f.is_admin} onChange={(e) => setF({ ...f, is_admin: e.target.checked })} />System Administrator (all privileged actions are logged)</label>
        {isNew && <p className="text-[12px] text-ink-faint">A temporary password is generated and shown once.</p>}
      </div>
    </Modal>
  );
}

function Locations() {
  const { lookups, reloadLookups } = useAuth();
  const [f, setF] = useState({ sub_location: '', village: '', landmark: '' });
  const [err, setErr] = useState(null);
  const toast = useToast();
  const add = async () => {
    setErr(null);
    try { await api('/locations', { method: 'POST', body: f }); toast('Location added'); setF({ sub_location: f.sub_location, village: '', landmark: '' }); reloadLookups(); } catch (e) { setErr(e.message); }
  };
  return (
    <div className="space-y-5">
      <Card className="p-4">
        <ErrorNote error={err} />
        <div className="grid items-end gap-3 sm:grid-cols-4">
          <Field label="Sub location" required><Input value={f.sub_location} onChange={(e) => setF({ ...f, sub_location: e.target.value })} /></Field>
          <Field label="Village"><Input value={f.village} onChange={(e) => setF({ ...f, village: e.target.value })} /></Field>
          <Field label="Landmark"><Input value={f.landmark} onChange={(e) => setF({ ...f, landmark: e.target.value })} /></Field>
          <Button onClick={add}><Plus className="h-4 w-4" />Add location</Button>
        </div>
      </Card>
      <Card className="overflow-hidden"><table className="tbl"><thead><tr><th>Sub location</th><th>Village</th><th>Landmark</th></tr></thead>
        <tbody>{lookups.locations.map((l) => <tr key={l.id}><td className="font-medium">{l.sub_location}</td><td>{l.village || '—'}</td><td>{l.landmark || '—'}</td></tr>)}</tbody></table></Card>
    </div>
  );
}

function Categories() {
  const { lookups, reloadLookups } = useAuth();
  const [f, setF] = useState({ name: '', description: '' });
  const toast = useToast();
  const add = async () => { try { await api('/categories', { method: 'POST', body: { ...f, module_group: 'general' } }); toast('Category added'); setF({ name: '', description: '' }); reloadLookups(); } catch (e) { toast(e.message, 'error'); } };
  const toggle = async (c) => { await api(`/categories/${c.id}`, { method: 'PATCH', body: { active: !c.active } }); reloadLookups(); };
  return (
    <div className="space-y-5">
      <Card className="p-4"><div className="grid items-end gap-3 sm:grid-cols-[1fr_2fr_auto]">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Description"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Button onClick={add}><Plus className="h-4 w-4" />Add</Button>
      </div>
      <p className="mt-2 text-[12px] text-ink-faint">Excluded areas (Innovation and Best Practices, Support Supervision, HIF Collection, Annual Performance Review, Port Health Services) must not be added as categories without a new scope decision.</p></Card>
      <Card className="overflow-hidden"><table className="tbl"><thead><tr><th>Category</th><th>Module</th><th>Status</th><th></th></tr></thead>
        <tbody>{lookups.categories.map((c) => (
          <tr key={c.id}><td><div className="font-medium">{c.name}</div><div className="text-[12px] text-ink-faint">{c.description}</div></td><td>{humanize(c.module_group)}</td>
            <td><Badge status={c.active ? 'completed' : 'cancelled'}>{c.active ? 'Active' : 'Inactive'}</Badge></td>
            <td className="text-right"><Button size="sm" variant="ghost" onClick={() => toggle(c)}>{c.active ? 'Deactivate' : 'Activate'}</Button></td></tr>
        ))}</tbody></table></Card>
    </div>
  );
}

function Templates() {
  const { reloadLookups } = useAuth();
  const { data, reload } = useLoad(() => api('/templates'), []);
  const [edit, setEdit] = useState(null);
  const [clType, setClType] = useState('premises');
  const [cl, setCl] = useState(null);
  const toast = useToast();
  useEffect(() => { api(`/checklists/${clType}`).then((c) => setCl({ ...c, text: c.items.join('\n') })); }, [clType]);
  const saveTpl = async () => {
    try { if (edit.id) await api(`/templates/${edit.id}`, { method: 'PATCH', body: edit }); else await api('/templates', { method: 'POST', body: edit }); toast('Template saved'); setEdit(null); reload(); reloadLookups(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const saveCl = async () => {
    const items = cl.text.split('\n').map((s) => s.trim()).filter(Boolean);
    try { const r = await api('/checklists', { method: 'POST', body: { entity_type: clType, items } }); toast(`Checklist saved as version ${r.version}`); setCl({ ...cl, version: r.version }); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <div className="flex items-center justify-between border-b border-line px-4 py-3"><span className="font-bold">Notice templates</span><Button size="sm" onClick={() => setEdit({ name: '', body: '' })}><Plus className="h-4 w-4" />New</Button></div>
        {(data || []).map((t) => (
          <button key={t.id} onClick={() => setEdit(t)} className="flex w-full items-center justify-between border-b border-line/70 px-4 py-3 text-left text-sm last:border-0 hover:bg-paper">
            <span className="font-medium">{t.name}</span><Badge status={t.active ? 'approved' : 'withdrawn'}>{t.active ? 'Approved' : 'Inactive'}</Badge>
          </button>
        ))}
        <p className="px-4 py-3 text-[12px] text-ink-faint">Placeholders: {'{{reference}} {{date}} {{recipient}} {{entity_name}} {{location}} {{ward}} {{findings}} {{corrective_action}} {{compliance_deadline}} {{officer_name}}'}</p>
      </Card>
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2"><span className="font-bold">Inspection checklist</span>
          <Select className="max-w-[220px]" value={clType} onChange={(e) => setClType(e.target.value)} options={REGISTER_KEYS.map((k) => ({ value: k, label: REGISTERS[k].singular }))} /></div>
        {cl && <>
          <Field label={`Items (one per line) · current version ${cl.version}`} hint="Saving creates a new version. Past inspections keep the version they used."><Textarea rows={12} value={cl.text} onChange={(e) => setCl({ ...cl, text: e.target.value })} /></Field>
          <div className="mt-3 flex justify-end"><Button onClick={saveCl}>Save new version</Button></div>
        </>}
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit template' : 'New template'} wide
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={saveTpl}>Save</Button></>}>
        {edit && <div className="grid gap-4">
          <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Body"><Textarea rows={16} className="font-mono text-[13px]" value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
          {edit.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-700" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Active (available for drafting)</label>}
        </div>}
      </Modal>
    </div>
  );
}

function Audit() {
  const [f, setF] = useState({ entity_type: '', action: '' });
  const { data, loading } = useLoad(() => api(`/audit${qs(f)}`), [JSON.stringify(f)]);
  return (
    <div>
      <div className="mb-3 grid gap-2 sm:max-w-lg sm:grid-cols-2">
        <Select value={f.entity_type} onChange={(e) => setF({ ...f, entity_type: e.target.value })} placeholder="All record types"
          options={['task', 'activity_record', 'follow_up', 'inspection', 'notice_draft', 'report', 'user', 'target', ...REGISTER_KEYS]} />
        <Select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} placeholder="All actions"
          options={['create', 'update', 'status_change', 'delete', 'export', 'login', 'login_failed', 'role_change', 'deactivate']} />
      </div>
      {loading && !data ? <Spinner /> : (
        <Card className="overflow-hidden">
          <div className="border-b border-line bg-paper/50 px-4 py-2 text-[12px] text-ink-faint">Read only. Audit events cannot be edited.</div>
          <div className="overflow-x-auto"><table className="tbl">
            <thead><tr><th>When (EAT)</th><th>Who</th><th>Action</th><th>Record</th><th className="hidden md:table-cell">Summary</th></tr></thead>
            <tbody>{data.map((a) => (
              <tr key={a.id}><td className="whitespace-nowrap text-[13px]">{fmtDateTime(a.at)}</td><td className="whitespace-nowrap">{a.actor_name || '—'}</td><td><Badge tone="gray">{humanize(a.action)}</Badge></td>
                <td className="whitespace-nowrap text-[13px]">{humanize(a.entity_type)}{a.entity_id ? ` #${a.entity_id}` : ''}</td>
                <td className="hidden max-w-md truncate font-mono text-[11px] text-ink-faint md:table-cell" title={a.change_summary}>{a.change_summary}</td></tr>
            ))}</tbody>
          </table></div>
        </Card>
      )}
    </div>
  );
}
