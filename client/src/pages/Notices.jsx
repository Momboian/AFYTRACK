import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, ArrowLeft, Printer, FileDown, CheckCircle2, Send, PackageCheck, Ban, Pencil } from 'lucide-react';
import { api, qs, download } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, fmtDateTime, todayStr, humanize } from '../lib/format.js';
import { Badge, Card, PageHeader, Spinner, Button, Empty, Tabs, Input, Field, Textarea, Modal, ErrorNote, useToast } from '../components/ui.jsx';
import { useLoad, EntityLink, NoticeForm } from '../components/forms.jsx';

export default function Notices() {
  const { can, me } = useAuth();
  const [status, setStatus] = useState('');
  const { data, loading } = useLoad(() => api(`/notices${qs({ status })}`), [status, me.ward?.id]);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  return (
    <div>
      <PageHeader title="Notice drafts" subtitle="Drafts from approved templates. Draft, approved, issued and served are separate steps recorded only when they actually happen."
        actions={can.write && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Draft notice</Button>} />
      <Tabs value={status} onChange={setStatus} tabs={[{ value: '', label: 'All' }, ...['draft', 'approved', 'issued', 'served', 'withdrawn'].map((s) => ({ value: s, label: humanize(s) }))]} />
      {loading && !data ? <Spinner /> : (
        <Card className="overflow-hidden">
          {data.length === 0 ? <Empty title="No notices here" /> : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Reference</th><th>Record</th><th className="hidden md:table-cell">Template</th><th className="hidden sm:table-cell">Deadline</th><th>Status</th></tr></thead>
                <tbody>
                  {data.map((n) => (
                    <tr key={n.id} className="clickable" onClick={() => nav(`/notices/${n.id}`)}>
                      <td className="font-mono text-[12px] font-semibold">{n.draft_reference}</td>
                      <td><div className="font-medium">{n.entity_name || n.recipient}</div><div className="text-[12px] text-ink-faint">{n.prepared_by_name} · {fmtDateTime(n.created_at)}</div></td>
                      <td className="hidden md:table-cell">{n.template_name}</td>
                      <td className="hidden sm:table-cell">{fmtDate(n.compliance_deadline)}</td>
                      <td><Badge status={n.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      <NoticeForm open={open} onClose={() => setOpen(false)} onCreated={(id) => nav(`/notices/${id}`)} />
    </div>
  );
}

const STEPS = ['draft', 'approved', 'issued', 'served'];

export function NoticeDetail() {
  const { id } = useParams();
  const { can, me } = useAuth();
  const { data: n, loading, error, reload } = useLoad(() => api(`/notices/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState('');
  const [modal, setModal] = useState(null);
  const toast = useToast();
  useEffect(() => { if (n) setContent(n.content || ''); }, [n]);
  if (loading && !n) return <Spinner />;
  if (error) return <ErrorNote error={error} />;

  const saveContent = async () => {
    try { await api(`/notices/${id}`, { method: 'PATCH', body: { content } }); toast('Draft saved'); setEditing(false); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const approve = async () => {
    if (!confirm('Approve this notice? The text will be locked and the reference changes from DRAFT to NTC.')) return;
    try { await api(`/notices/${id}/approve`, { method: 'POST', body: {} }); toast('Notice approved'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const withdraw = async () => {
    if (!confirm('Withdraw this notice?')) return;
    try { await api(`/notices/${id}/withdraw`, { method: 'POST', body: {} }); toast('Notice withdrawn'); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const stepIdx = STEPS.indexOf(n.status);

  return (
    <div className="max-w-5xl">
      <Link to="/notices" className="no-print mb-3 inline-flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink"><ArrowLeft className="h-4 w-4" />Notices</Link>
      <div className="no-print">
        <PageHeader eyebrow={n.template_name} title={<span className="font-mono text-[20px] sm:text-[24px]">{n.draft_reference}</span>}
          actions={<>
            {n.status === 'draft' && can.write && !editing && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Edit text</Button>}
            {n.status === 'draft' && can.lead && <Button onClick={approve}><CheckCircle2 className="h-4 w-4" />Approve</Button>}
            {n.status === 'approved' && can.write && <Button onClick={() => setModal('issue')}><Send className="h-4 w-4" />Record issue</Button>}
            {n.status === 'issued' && can.write && <Button onClick={() => setModal('serve')}><PackageCheck className="h-4 w-4" />Record service</Button>}
            <Button variant="secondary" onClick={() => { window.print(); }}><Printer className="h-4 w-4" />Print / PDF</Button>
            <Button variant="secondary" onClick={() => download(`/notices/${id}/word`, 'notice.doc')}><FileDown className="h-4 w-4" />Word</Button>
            {!['served', 'withdrawn'].includes(n.status) && (can.lead || n.prepared_by === me.user.id) && <Button variant="ghost" onClick={withdraw}><Ban className="h-4 w-4" />Withdraw</Button>}
          </>} />

        <Card className="mb-5 p-4">
          {n.status === 'withdrawn' ? <div className="text-sm font-semibold text-ink-soft">This notice was withdrawn.</div> : (
            <ol className="grid grid-cols-4 gap-2">
              {STEPS.map((s, i) => (
                <li key={s} className="text-center">
                  <div className={`mx-auto mb-1.5 h-1.5 rounded-full ${i <= stepIdx ? 'bg-brand-500' : 'bg-line'}`} />
                  <div className={`text-[13px] font-bold ${i <= stepIdx ? 'text-brand-700' : 'text-ink-faint'}`}>{humanize(s)}</div>
                  <div className="text-[11px] text-ink-faint">
                    {s === 'draft' && n.prepared_by_name}
                    {s === 'approved' && (n.reviewed_by_name || 'Ward lead review')}
                    {s === 'issued' && (n.issue_date ? fmtDate(n.issue_date) : 'After approval')}
                    {s === 'served' && (n.service_date ? `${fmtDate(n.service_date)} · ${n.service_method}` : 'Only when actually served')}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
        {n.status === 'draft' && <div className="mb-4 rounded-lg border border-ochre-100 bg-ochre-50 px-3 py-2.5 text-[13px] text-ochre-700">Draft: review every field before approval. Printing a draft does not issue or serve it.</div>}
      </div>

      {editing ? (
        <Card className="p-4">
          <Textarea className="min-h-[420px] font-mono text-[13px]" value={content} onChange={(e) => setContent(e.target.value)} />
          <div className="mt-3 flex justify-end gap-2"><Button variant="secondary" onClick={() => { setEditing(false); setContent(n.content); }}>Cancel</Button><Button onClick={saveContent}>Save draft (v{n.version + 1})</Button></div>
        </Card>
      ) : (
        <div className="print-area relative mx-auto max-w-[780px] rounded-sm border border-line bg-white px-8 py-10 shadow-card sm:px-14">
          {n.status === 'draft' && <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"><span className="rotate-[-24deg] text-[90px] font-black tracking-widest text-ochre-500/10">DRAFT</span></div>}
          <pre className="relative whitespace-pre-wrap font-sans text-[14.5px] leading-relaxed">{n.content}</pre>
          <div className="relative mt-8 border-t border-line pt-3 text-[11px] text-ink-faint">Status: {humanize(n.status)} · version {n.version} · linked: {n.entity_name || '—'}</div>
        </div>
      )}
      <div className="no-print mt-4 text-sm text-ink-soft">Linked record: <EntityLink type={n.linked_entity_type} id={n.linked_entity_id} name={n.entity_name} />{n.inspection_id && <> · <Link className="text-brand-700 hover:underline" to={`/inspections/${n.inspection_id}`}>Inspection</Link></>}</div>
      <ServiceModal mode={modal} notice={n} onClose={() => setModal(null)} onDone={reload} />
    </div>
  );
}

function ServiceModal({ mode, notice, onClose, onDone }) {
  const [f, setF] = useState({});
  const [err, setErr] = useState(null); const [errors, setErrors] = useState({}); const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { if (mode) { setF({ issue_date: todayStr(), service_date: todayStr(), service_method: '', service_notes: '' }); setErr(null); setErrors({}); } }, [mode]);
  if (!mode) return null;
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api(`/notices/${notice.id}/${mode}`, { method: 'POST', body: f }); toast(mode === 'issue' ? 'Issue recorded' : 'Service recorded'); onDone(); onClose(); }
    catch (e) { setErr(e.message); setErrors(e.errors || {}); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={mode === 'issue' ? 'Record issue' : 'Record service'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Confirm</Button></>}>
      <p className="mb-4 rounded-lg bg-paper px-3 py-2.5 text-[13px] text-ink-soft">Record this only after the real world action has happened. The system does not decide whether an enforcement step is legally valid.</p>
      <ErrorNote error={err} />
      {mode === 'issue' ? (
        <Field label="Actual issue date" required error={errors.issue_date}><Input type="date" max={todayStr()} value={f.issue_date} onChange={(e) => setF({ ...f, issue_date: e.target.value })} /></Field>
      ) : (
        <div className="space-y-4">
          <Field label="Actual service date" required error={errors.service_date}><Input type="date" max={todayStr()} value={f.service_date} onChange={(e) => setF({ ...f, service_date: e.target.value })} /></Field>
          <Field label="Service method" required error={errors.service_method}><Input value={f.service_method} onChange={(e) => setF({ ...f, service_method: e.target.value })} placeholder="e.g. Hand delivered to owner" /></Field>
          <Field label="Notes"><Textarea rows={2} value={f.service_notes} onChange={(e) => setF({ ...f, service_notes: e.target.value })} /></Field>
        </div>
      )}
    </Modal>
  );
}
