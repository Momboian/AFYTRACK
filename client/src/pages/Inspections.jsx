import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, ArrowLeft, Trash2, FileText, Lock, Check, X, Minus } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, todayStr, addDays, humanize, ENTITY_LABEL } from '../lib/format.js';
import { REGISTERS, REGISTER_KEYS, FACILITY_STATUS_FIELDS } from '../lib/registers.js';
import { Badge, Card, PageHeader, Spinner, Button, Empty, Select, Input, Field, Textarea, ErrorNote, useToast } from '../components/ui.jsx';
import { useLoad, EntityLink, NoticeForm } from '../components/forms.jsx';

const INSPECTABLE = REGISTER_KEYS.filter((k) => k !== 'handler').concat('handler');

export default function Inspections() {
  const { can, lookups, me } = useAuth();
  const [f, setF] = useState({ entity_type: '', from: addDays(todayStr(), -60), to: todayStr(), risk_level: '', officer_id: '' });
  const { data, loading } = useLoad(() => api(`/inspections${qs(f)}`), [JSON.stringify(f), me.ward?.id]);
  const nav = useNavigate();
  return (
    <div>
      <PageHeader title="Inspections" subtitle="Each inspection is a separate, dated record that stays in the entity's history."
        actions={can.write && <Button onClick={() => nav('/inspections/new')}><Plus className="h-4 w-4" />New inspection</Button>} />
      <div className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Field label="Type"><Select value={f.entity_type} onChange={(e) => setF({ ...f, entity_type: e.target.value })} placeholder="All" options={INSPECTABLE.map((k) => ({ value: k, label: REGISTERS[k].singular }))} /></Field>
        <Field label="From"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="To"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        <Field label="Risk"><Select value={f.risk_level} onChange={(e) => setF({ ...f, risk_level: e.target.value })} placeholder="Any" options={['low', 'medium', 'high', 'unknown']} /></Field>
        <Field label="Officer"><Select value={f.officer_id} onChange={(e) => setF({ ...f, officer_id: e.target.value })} placeholder="Any" options={lookups.officers.map((o) => ({ value: o.id, label: o.full_name }))} /></Field>
      </div>
      {loading && !data ? <Spinner /> : (
        <Card className="overflow-hidden">
          {data.length === 0 ? <Empty title="No inspections in this period" /> : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Date</th><th>Entity</th><th className="hidden md:table-cell">Outcome</th><th>Risk</th><th className="hidden sm:table-cell">Open findings</th><th className="hidden lg:table-cell">Officer</th></tr></thead>
                <tbody>
                  {data.map((i) => (
                    <tr key={i.id} className="clickable" onClick={() => nav(`/inspections/${i.id}`)}>
                      <td className="whitespace-nowrap font-semibold">{fmtDate(i.inspection_date)}</td>
                      <td><div className="font-medium">{i.entity_name}</div><div className="text-[12px] text-ink-faint">{ENTITY_LABEL[i.entity_type]}</div></td>
                      <td className="hidden md:table-cell">{i.outcome || '—'}</td>
                      <td><Badge status={i.risk_level} /></td>
                      <td className="hidden sm:table-cell">{i.open_findings ? <Badge tone="amber">{i.open_findings} of {i.finding_count}</Badge> : <span className="text-ink-faint">{i.finding_count ? 'All resolved' : 'None'}</span>}</td>
                      <td className="hidden lg:table-cell whitespace-nowrap">{i.officer_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

export function InspectionForm() {
  const [params] = useSearchParams();
  const { me, lookups } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [type, setType] = useState(params.get('entity_type') || 'premises');
  const [entityId, setEntityId] = useState(params.get('entity_id') || '');
  const [entities, setEntities] = useState([]);
  const [checklist, setChecklist] = useState({ version: 0, items: [] });
  const [results, setResults] = useState({});
  const [f, setF] = useState({ inspection_date: todayStr(), risk_level: 'low', outcome: '', findings: '', next_visit_due: '', notice_required: false, create_follow_ups: true });
  const [facility, setFacility] = useState({});
  const [findings, setFindings] = useState([]);
  const [errors, setErrors] = useState({}); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/registers/${type}`).then(setEntities).catch(() => setEntities([]));
    api(`/checklists/${type}`).then((c) => { setChecklist(c); setResults({}); });
  }, [type]);

  const addFinding = (text = '') => setFindings((x) => [...x, { finding: text, required_action: '', deadline: addDays(todayStr(), 14), responsible_user_id: me.user.id }]);
  const setResult = (item, result) => {
    setResults((r) => ({ ...r, [item]: { ...(r[item] || {}), result } }));
    if (result === 'no' && !findings.some((x) => x.finding === item)) addFinding(`Not met: ${item}`);
  };

  const save = async () => {
    setBusy(true); setErr(null);
    const body = {
      entity_type: type, entity_id: Number(entityId), ...f,
      checklist_results: checklist.items.map((item) => ({ item, result: results[item]?.result || 'not_checked', note: results[item]?.note || '' })),
      findings_list: findings, facility_status: type === 'facility' ? facility : undefined
    };
    try { const r = await api('/inspections', { method: 'POST', body }); toast('Inspection saved'); nav(`/inspections/${r.id}`); }
    catch (e) { setErr(e.message); setErrors(e.errors || {}); window.scrollTo({ top: 0, behavior: 'smooth' }); } finally { setBusy(false); }
  };
  const isVisit = type === 'household';

  return (
    <div className="max-w-4xl">
      <Link to="/inspections" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink"><ArrowLeft className="h-4 w-4" />Inspections</Link>
      <PageHeader title={isVisit ? 'Household visit' : 'New inspection'} subtitle="Saved inspections cannot be edited later; findings and follow ups track progress." />
      <ErrorNote error={err} />
      <div className="space-y-5">
        <Card className="p-5">
          <h2 className="mb-4 font-bold">1. What and when</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Type" required><Select value={type} onChange={(e) => { setType(e.target.value); setEntityId(''); }} options={INSPECTABLE.map((k) => ({ value: k, label: REGISTERS[k].singular }))} /></Field>
            <Field label={REGISTERS[type].singular} required error={errors.entity_id}>
              <Select value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="Choose…" error={errors.entity_id}
                options={entities.map((x) => ({ value: x.id, label: x[REGISTERS[type].nameField] }))} />
            </Field>
            <Field label="Date" required error={errors.inspection_date}><Input type="date" max={todayStr()} value={f.inspection_date} onChange={(e) => setF({ ...f, inspection_date: e.target.value })} /></Field>
          </div>
          {!entities.length && <p className="mt-2 text-[13px] text-ink-faint">No {REGISTERS[type].label.toLowerCase()} yet. <Link className="font-semibold text-brand-700" to={`/registers/${type}`}>Add one in the register</Link> first.</p>}
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-baseline justify-between"><h2 className="font-bold">2. Checklist</h2><span className="text-[12px] text-ink-faint">Version {checklist.version || 'none'} · configured by admin</span></div>
          {checklist.items.length === 0 ? <p className="text-sm text-ink-faint">No checklist configured for this type. Record findings below.</p> : (
            <div className="divide-y divide-line">
              {checklist.items.map((item) => {
                const r = results[item]?.result;
                const btn = (val, Icon, tone, label) => (
                  <button type="button" onClick={() => setResult(item, val)} aria-label={label}
                    className={`flex h-10 w-12 items-center justify-center rounded-lg border text-sm font-semibold transition ${r === val ? tone : 'border-line bg-white text-ink-faint hover:bg-paper'}`}><Icon className="h-4 w-4" /></button>
                );
                return (
                  <div key={item} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                    <div className="flex-1 text-sm">{item}</div>
                    <div className="flex gap-1.5">
                      {btn('yes', Check, 'border-brand-500 bg-brand-500 text-white', 'Yes')}
                      {btn('no', X, 'border-red-500 bg-red-500 text-white', 'No')}
                      {btn('na', Minus, 'border-stone-400 bg-stone-400 text-white', 'Not applicable')}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-2 text-[12px] text-ink-faint">Marking an item “No” adds a finding below for you to complete.</p>
        </Card>

        {type === 'facility' && (
          <Card className="p-5">
            <h2 className="mb-1 font-bold">3. Facility sanitation status</h2>
            <p className="mb-4 text-[13px] text-ink-faint">Updates the facility's current status. Leave blank to keep the existing value.</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FACILITY_STATUS_FIELDS.map((fld) => (
                <Field key={fld.key} label={fld.label}><Select value={facility[fld.key] || ''} onChange={(e) => setFacility({ ...facility, [fld.key]: e.target.value })} placeholder="No change" options={fld.options} /></Field>
              ))}
            </div>
          </Card>
        )}

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">{type === 'facility' ? '4' : '3'}. Findings and corrective actions</h2>
            <Button size="sm" variant="secondary" onClick={() => addFinding()}><Plus className="h-4 w-4" />Add finding</Button>
          </div>
          {findings.length === 0 && <p className="text-sm text-ink-faint">No defects recorded.</p>}
          <div className="space-y-3">
            {findings.map((x, idx) => (
              <div key={idx} className="rounded-lg border border-line bg-paper/40 p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={`Finding ${idx + 1}`} error={errors[`finding_${idx}`]} className="sm:col-span-2"><Input value={x.finding} onChange={(e) => setFindings(findings.map((y, j) => j === idx ? { ...y, finding: e.target.value } : y))} /></Field>
                  <Field label="Required action" className="sm:col-span-2"><Input value={x.required_action} onChange={(e) => setFindings(findings.map((y, j) => j === idx ? { ...y, required_action: e.target.value } : y))} /></Field>
                  <Field label="Deadline"><Input type="date" value={x.deadline} onChange={(e) => setFindings(findings.map((y, j) => j === idx ? { ...y, deadline: e.target.value } : y))} /></Field>
                  <Field label="Responsible officer"><Select value={x.responsible_user_id} onChange={(e) => setFindings(findings.map((y, j) => j === idx ? { ...y, responsible_user_id: Number(e.target.value) } : y))} options={lookups.officers.map((o) => ({ value: o.id, label: o.full_name }))} /></Field>
                </div>
                <button onClick={() => setFindings(findings.filter((_, j) => j !== idx))} className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-red-600"><Trash2 className="h-3.5 w-3.5" />Remove</button>
              </div>
            ))}
          </div>
          {findings.length > 0 && (
            <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={f.create_follow_ups} onChange={(e) => setF({ ...f, create_follow_ups: e.target.checked })} />Create a follow up for each finding with a deadline</label>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-bold">Outcome</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Risk level" error={errors.risk_level}><Select value={f.risk_level} onChange={(e) => setF({ ...f, risk_level: e.target.value })} options={['low', 'medium', 'high', 'unknown']} /></Field>
            <Field label="Outcome"><Select value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} placeholder="Choose…" options={['Compliant', 'Partially compliant', 'Non compliant', 'Needs improvement', 'Closed / not operating']} /></Field>
            <Field label="Next visit due" error={errors.next_visit_due} hint="Creates a revisit task in your planner."><Input type="date" value={f.next_visit_due} onChange={(e) => setF({ ...f, next_visit_due: e.target.value })} /></Field>
            <Field label="Summary / observations" className="sm:col-span-3"><Textarea rows={3} value={f.findings} onChange={(e) => setF({ ...f, findings: e.target.value })} /></Field>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={f.notice_required} onChange={(e) => setF({ ...f, notice_required: e.target.checked })} />A notice draft is required</label>
        </Card>
        <div className="sticky bottom-20 z-10 flex justify-end gap-2 rounded-xl border border-line bg-white/95 p-3 shadow-lg backdrop-blur lg:bottom-4">
          <Button variant="secondary" onClick={() => nav(-1)}>Cancel</Button>
          <Button onClick={save} loading={busy}>Save {isVisit ? 'visit' : 'inspection'}</Button>
        </div>
      </div>
    </div>
  );
}

export function InspectionDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data: i, loading, error, reload } = useLoad(() => api(`/inspections/${id}`), [id]);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const nav = useNavigate();
  const toast = useToast();
  if (loading && !i) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  const setStatus = async (f, status) => {
    try { await api(`/findings/${f.id}`, { method: 'PATCH', body: { status } }); toast('Finding updated'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const icon = { yes: <Check className="h-4 w-4 text-brand-600" />, no: <X className="h-4 w-4 text-red-600" />, na: <Minus className="h-4 w-4 text-stone-400" /> };
  return (
    <div className="max-w-5xl">
      <Link to="/inspections" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink"><ArrowLeft className="h-4 w-4" />Inspections</Link>
      <PageHeader eyebrow={`${ENTITY_LABEL[i.entity_type]} inspection · ${fmtDate(i.inspection_date)}`} title={<EntityLink type={i.entity_type} id={i.entity_id} name={i.entity_name} />}
        actions={can.write && i.entity_type !== 'handler' && <Button variant="secondary" onClick={() => setNoticeOpen(true)}><FileText className="h-4 w-4" />Draft notice</Button>} />
      <div className="mb-4 flex items-center gap-2 text-[13px] text-ink-faint"><Lock className="h-3.5 w-3.5" />Historical record. It cannot be edited; record a new inspection for a revisit.</div>
      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <div className="space-y-5">
          <Card className="p-5">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div><dt className="label">Officer</dt><dd>{i.officer_name}</dd></div>
              <div><dt className="label">Risk</dt><dd><Badge status={i.risk_level} /></dd></div>
              <div><dt className="label">Outcome</dt><dd>{i.outcome || '—'}</dd></div>
              <div><dt className="label">Next visit</dt><dd>{fmtDate(i.next_visit_due)}</dd></div>
              <div><dt className="label">Notice required</dt><dd>{i.notice_required ? 'Yes' : 'No'}</dd></div>
              <div><dt className="label">Checklist version</dt><dd>{i.checklist_version ?? '—'}</dd></div>
              {i.findings && <div className="col-span-2"><dt className="label">Summary</dt><dd className="whitespace-pre-wrap">{i.findings}</dd></div>}
            </dl>
          </Card>
          <Card>
            <div className="border-b border-line px-4 py-3 font-bold">Checklist</div>
            {i.checklist_results.length === 0 ? <div className="px-4 py-4 text-sm text-ink-faint">No checklist recorded.</div> : i.checklist_results.map((c, k) => (
              <div key={k} className="flex items-center gap-3 border-b border-line/60 px-4 py-2 text-sm last:border-0">{icon[c.result] || <span className="w-4 text-center text-ink-faint">·</span>}<span className={c.result === 'no' ? 'font-semibold' : ''}>{c.item}</span></div>
            ))}
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <div className="border-b border-line px-4 py-3 font-bold">Findings and corrective actions ({i.findings.length})</div>
            {i.findings.length === 0 ? <div className="px-4 py-5 text-sm text-ink-faint">No defects recorded.</div> : i.findings.map((f) => (
              <div key={f.id} className="border-b border-line/70 px-4 py-3 last:border-0">
                <div className="flex items-start justify-between gap-2"><div className="font-semibold">{f.finding}</div><Badge status={f.status} /></div>
                {f.required_action && <div className="mt-1 text-sm text-ink-soft">Action: {f.required_action}</div>}
                <div className="mt-1 text-[12px] text-ink-faint">Deadline {fmtDate(f.deadline)} · {f.responsible_name || '—'}</div>
                {can.write && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {['resolved', 'partially_resolved', 'unresolved', 'open'].filter((s) => s !== f.status).map((s) => (
                      <button key={s} onClick={() => setStatus(f, s)} className="rounded-md border border-line px-2 py-1 text-[12px] font-semibold text-ink-soft hover:bg-paper">Mark {humanize(s).toLowerCase()}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </Card>
          <Card>
            <div className="border-b border-line px-4 py-3 font-bold">Follow ups</div>
            {i.followUps.length === 0 ? <div className="px-4 py-5 text-sm text-ink-faint">None.</div> : i.followUps.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-2 border-b border-line/70 px-4 py-2.5 text-sm last:border-0">
                <div><div>{f.action_required}</div><div className="text-[12px] text-ink-faint">{f.responsible_name} · due {fmtDate(f.due_date)}</div></div>
                <Badge status={f.status === 'open' && f.due_date < todayStr() ? 'overdue' : f.outcome || f.status} />
              </div>
            ))}
          </Card>
          {i.notices.length > 0 && (
            <Card>
              <div className="border-b border-line px-4 py-3 font-bold">Notices</div>
              {i.notices.map((n) => <Link key={n.id} to={`/notices/${n.id}`} className="flex justify-between px-4 py-2.5 text-sm hover:bg-paper"><span className="font-mono text-[12px]">{n.draft_reference}</span><Badge status={n.status} /></Link>)}
            </Card>
          )}
        </div>
      </div>
      <NoticeForm open={noticeOpen} onClose={() => setNoticeOpen(false)} onCreated={(nid) => nav(`/notices/${nid}`)}
        preset={{ linked_entity_type: i.entity_type, linked_entity_id: i.entity_id, inspection_id: i.id, findings: i.findings.map((f) => f.finding).join('\n'), corrective_action: i.findings.map((f) => f.required_action).filter(Boolean).join('\n') }} />
    </div>
  );
}
