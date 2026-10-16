import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, ClipboardPlus, Search, AlertTriangle, CalendarClock, ChevronRight, Droplets, BadgeAlert, FlaskConical } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fmtDate, fmtTime, fmtDateTime } from '../lib/format.js';
import { Badge, Card, PageHeader, Spinner, Stat, Button, Empty } from '../components/ui.jsx';
import { useLoad, TaskForm, EntityLink } from '../components/forms.jsx';

function TaskRow({ t, overdue }) {
  const nav = useNavigate();
  return (
    <button onClick={() => nav(`/planner/${t.id}`)} className="flex w-full items-center gap-3 border-b border-line/70 px-4 py-3 text-left last:border-0 hover:bg-paper/70">
      <div className={`w-14 flex-none text-[13px] font-bold ${overdue ? 'text-red-600' : 'text-brand-700'}`}>{overdue ? fmtDate(t.due_at).slice(0, 6) : fmtTime(t.due_at)}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold">{t.title}</div>
        <div className="truncate text-[12px] text-ink-faint">{t.category || 'No category'}{t.entity_name ? ` · ${t.entity_name}` : ''}</div>
      </div>
      {t.priority === 'high' && <Badge tone="red">High</Badge>}
      <Badge status={overdue ? 'overdue' : t.status} />
    </button>
  );
}

export default function Dashboard() {
  const { me, can } = useAuth();
  const { data, loading, reload } = useLoad(() => api('/dashboard'), [me.ward?.id]);
  const [taskOpen, setTaskOpen] = useState(false);
  const nav = useNavigate();
  if (!me.ward) return null;
  if (loading && !data) return <Spinner />;
  const d = data;
  const hour = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Africa/Nairobi' }));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div>
      <PageHeader eyebrow={fmtDate(d.today)} title={`${greet}, ${me.user.full_name.split(' ')[0]}`}
        subtitle="Here is what needs your attention today."
        actions={can.write && <>
          <Button onClick={() => setTaskOpen(true)}><Plus className="h-4 w-4" />New task</Button>
          <Button variant="secondary" onClick={() => nav('/inspections/new')}><Search className="h-4 w-4" />Start inspection</Button>
          <Button variant="secondary" onClick={() => nav('/activities?new=1')}><ClipboardPlus className="h-4 w-4" />Record activity</Button>
        </>} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Due today" value={d.todayTasks.length} sub="Your tasks" onClick={() => nav('/planner?view=today')} />
        <Stat label="Overdue" value={d.overdue.length} tone={d.overdue.length ? 'red' : 'default'} sub="Your tasks past due" onClick={() => nav('/planner?status=overdue')} />
        <Stat label="Follow ups (7 days)" value={d.followUps.length} tone={d.followUps.some((f) => f.overdue) ? 'amber' : 'default'} sub={`${d.followUps.filter((f) => f.overdue).length} overdue`} onClick={() => nav('/follow-ups')} />
        {d.wardCounts
          ? <Stat label="Ward overdue" value={d.wardCounts.overdue_tasks} tone={d.wardCounts.overdue_tasks ? 'red' : 'default'} sub={`${d.wardCounts.open_tasks} open tasks in ward`} onClick={() => nav('/team')} />
          : <Stat label="Pending lab results" value={d.expiring.pending_samples} sub="Water samples" onClick={() => nav('/registers/water_source')} />}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0 space-y-5">
          <Card>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="font-bold">Today</h2>
              <Link to="/planner" className="text-[13px] font-semibold text-brand-600 hover:underline">Open planner</Link>
            </div>
            {d.todayTasks.length ? d.todayTasks.map((t) => <TaskRow key={t.id} t={t} />)
              : <Empty icon={CalendarClock} title="Nothing due today">Add a task to plan field work, or check upcoming items below.</Empty>}
          </Card>

          {d.overdue.length > 0 && (
            <Card className="border-red-200">
              <div className="flex items-center gap-2 border-b border-red-100 bg-red-50/60 px-4 py-3 text-red-700">
                <AlertTriangle className="h-4 w-4" /><h2 className="font-bold">Overdue ({d.overdue.length})</h2>
              </div>
              {d.overdue.map((t) => <TaskRow key={t.id} t={t} overdue />)}
            </Card>
          )}

          <Card>
            <div className="border-b border-line px-4 py-3"><h2 className="font-bold">Upcoming</h2></div>
            {d.upcoming.length ? d.upcoming.map((t) => (
              <Link key={t.id} to={`/planner/${t.id}`} className="flex items-center gap-3 border-b border-line/70 px-4 py-2.5 last:border-0 hover:bg-paper/70">
                <div className="w-28 flex-none text-[12px] font-semibold text-ink-soft">{fmtDateTime(t.due_at)}</div>
                <div className="min-w-0 flex-1 truncate text-sm">{t.title}</div>
                <ChevronRight className="h-4 w-4 text-ink-faint" />
              </Link>
            )) : <div className="px-4 py-6 text-center text-sm text-ink-faint">No upcoming tasks.</div>}
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="font-bold">This week's progress</h2>
              <span className="text-[12px] text-ink-faint">{fmtDate(d.week.start)} to {fmtDate(d.week.end)}</span>
            </div>
            <div className="space-y-3.5 px-4 py-4">
              {d.weekly.length === 0 && <div className="text-sm text-ink-faint">No activity recorded and no weekly targets set.</div>}
              {d.weekly.map((w) => (
                <div key={w.category}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="truncate font-semibold">{w.category}</span>
                    <span className="flex-none font-mono text-[12px] text-ink-soft">{w.achieved}{w.target !== null ? ` / ${w.target}` : ''} · {w.pct === 'N/A' ? 'N/A' : `${w.pct}%`}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-paper">
                    {w.pct !== 'N/A' && <div className={`h-full rounded-full ${w.pct >= 100 ? 'bg-brand-500' : w.pct >= 50 ? 'bg-brand-200' : 'bg-ochre-500'}`} style={{ width: `${Math.min(100, w.pct)}%` }} />}
                  </div>
                </div>
              ))}
              <p className="pt-1 text-[11px] text-ink-faint">N/A means no target is set for that category.</p>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="font-bold">Follow ups due</h2>
              <Link to="/follow-ups" className="text-[13px] font-semibold text-brand-600 hover:underline">Queue</Link>
            </div>
            {d.followUps.length ? d.followUps.map((f) => (
              <div key={f.id} className="border-b border-line/70 px-4 py-3 last:border-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[14px] font-semibold leading-snug">{f.action_required}</div>
                  <Badge status={f.overdue ? 'overdue' : 'open'}>{f.overdue ? 'Overdue' : fmtDate(f.due_date)}</Badge>
                </div>
                <div className="mt-0.5 text-[12px] text-ink-faint"><EntityLink type={f.linked_entity_type} id={f.linked_entity_id} name={f.entity_name} /> · {f.responsible_name}</div>
              </div>
            )) : <div className="px-4 py-6 text-center text-sm text-ink-faint">No follow ups due in the next 7 days.</div>}
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 font-bold">Register alerts</h2>
            <div className="grid gap-2 text-sm">
              <Link to="/registers/premises?status=expired" className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-paper"><BadgeAlert className="h-4 w-4 text-red-500" /><span className="flex-1">Licences past expiry date</span><b>{d.expiring.licences}</b></Link>
              <Link to="/registers/handler" className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-paper"><BadgeAlert className="h-4 w-4 text-ochre-500" /><span className="flex-1">Handler certificates expired</span><b>{d.expiring.certificates}</b></Link>
              <Link to="/registers/water_source" className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-paper"><FlaskConical className="h-4 w-4 text-sky-600" /><span className="flex-1">Water samples awaiting result</span><b>{d.expiring.pending_samples}</b></Link>
              {d.wardCounts && <Link to="/team" className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-paper"><Droplets className="h-4 w-4 text-red-500" /><span className="flex-1">Facilities with overdue actions</span><b>{d.wardCounts.facilities_overdue_actions}</b></Link>}
            </div>
          </Card>
        </div>
      </div>
      <TaskForm open={taskOpen} onClose={() => setTaskOpen(false)} onSaved={reload} />
    </div>
  );
}
