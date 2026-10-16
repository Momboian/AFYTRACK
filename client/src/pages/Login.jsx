import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Lock, Mail, ArrowRight, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { Button, Field, Input, ErrorNote } from '../components/ui.jsx';

const DEMO = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_ACCOUNTS === 'true';
const DEMO_ACCOUNTS = [
  ['Ward PHO (lead)', 'lead@afyatrack.test', 'Lead@2026'],
  ['PHO / Officer', 'officer@afyatrack.test', 'Officer@2026'],
  ['Administrator', 'admin@afyatrack.test', 'Admin@2026'],
  ['Reviewer', 'reviewer@afyatrack.test', 'Reviewer@2026']
];

export function Logo({ light }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 64 64" className="h-9 w-9" aria-hidden>
        <rect width="64" height="64" rx="14" fill={light ? '#F5F4EE' : '#0F4C40'} />
        <path d="M14 34h10l5-12 7 22 5-14 3 4h6" fill="none" stroke={light ? '#0F4C40' : '#F5F4EE'} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="50" cy="34" r="4" fill="#D98E04" />
      </svg>
      <div className="leading-tight">
        <div className={`text-[17px] font-extrabold tracking-tight ${light ? 'text-white' : 'text-ink'}`}>AfyaTrack <span className="text-ochre-500">PHO</span></div>
        <div className={`text-[11px] font-medium uppercase tracking-[0.14em] ${light ? 'text-brand-100/80' : 'text-ink-faint'}`}>Ward public health work</div>
      </div>
    </div>
  );
}

function AuthShell({ children }) {
  const questions = ['What is due today?', 'What is overdue?', 'Which premises, households or water sources need follow up?', 'What have I completed this week?', 'What goes into my report?'];
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-brand-800 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '22px 22px' }} />
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-600/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-ochre-500/20 blur-3xl" />
        <div className="relative"><Logo light /></div>
        <div className="relative max-w-md">
          <p className="mb-4 text-[12px] font-semibold uppercase tracking-[0.18em] text-ochre-100/90">Open AfyaTrack and know</p>
          <ul className="space-y-3">
            {questions.map((q, i) => (
              <li key={q} className="flex items-start gap-3 text-[19px] font-semibold leading-snug" style={{ opacity: 1 - i * 0.1 }}>
                <CheckCircle2 className="mt-1 h-5 w-5 flex-none text-ochre-500" />{q}
              </li>
            ))}
          </ul>
          <p className="mt-8 max-w-sm text-sm leading-relaxed text-brand-100/80">Plan work, get reminders, keep field records and registers, follow up corrective actions and generate weekly and monthly reports from saved records.</p>
        </div>
        <div className="relative flex items-center gap-2 text-[12px] text-brand-100/70">
          <ShieldCheck className="h-4 w-4" /> Access is limited to your ward and role. All important changes are logged.
        </div>
      </aside>
      <main className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 lg:hidden"><Logo /></div>
          {children}
        </div>
      </main>
    </div>
  );
}

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    if (!email || !password) return setErr('Enter your email and password.');
    setBusy(true);
    try { await login(email.trim(), password); nav('/', { replace: true }); }
    catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };

  return (
    <AuthShell>
      <h1 className="text-[28px] font-extrabold tracking-tight">Sign in</h1>
      <p className="mb-7 mt-1.5 text-sm text-ink-soft">Use the account your administrator created for you.</p>
      <ErrorNote error={err} />
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email or username">
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <Input type="email" autoComplete="username" placeholder="name@county.go.ke" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" autoFocus />
          </div>
        </Field>
        <Field label={<span className="flex items-center justify-between"><span>Password</span><Link to="/forgot-password" className="text-[13px] font-semibold text-brand-600 hover:underline">Forgot password?</Link></span>}>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <Input type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} className="px-9" />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-faint hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={busy}>Sign in <ArrowRight className="h-4 w-4" /></Button>
      </form>
      <p className="mt-6 text-center text-[13px] text-ink-faint">No public sign up. New accounts are invited by the System Administrator.</p>

      {DEMO && (
        <div className="mt-8 rounded-xl border border-dashed border-ochre-500/50 bg-ochre-50/60 p-4">
          <div className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ochre-700">Demo accounts (synthetic data)</div>
          <div className="grid gap-1.5">
            {DEMO_ACCOUNTS.map(([label, e, p]) => (
              <button key={e} type="button" onClick={() => { setEmail(e); setPassword(p); }}
                className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-left text-[13px] ring-1 ring-ochre-100 hover:ring-ochre-500">
                <span className="font-semibold">{label}</span><span className="font-mono text-[12px] text-ink-soft">{e}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </AuthShell>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Enter a valid email address.');
    setBusy(true);
    try { const r = await api('/auth/forgot', { method: 'POST', body: { email } }); setDone(r.message); }
    catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <AuthShell>
      <h1 className="text-[26px] font-extrabold tracking-tight">Reset your password</h1>
      <p className="mb-6 mt-1.5 text-sm text-ink-soft">Enter your account email. A reset link valid for one hour will be issued.</p>
      <ErrorNote error={err} />
      {done ? (
        <div className="rounded-lg border border-brand-200 bg-brand-50 p-4 text-sm text-brand-800">{done}</div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
          <Button type="submit" size="lg" className="w-full" loading={busy}>Send reset link</Button>
        </form>
      )}
      <Link to="/login" className="mt-6 block text-center text-sm font-semibold text-brand-600 hover:underline">Back to sign in</Link>
    </AuthShell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false); const [ok, setOk] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(null);
    if (pw.length < 8) return setErr('Use at least 8 characters.');
    if (pw !== pw2) return setErr('The two passwords do not match.');
    setBusy(true);
    try { await api('/auth/reset', { method: 'POST', body: { token: params.get('token'), password: pw } }); setOk(true); setTimeout(() => nav('/login'), 1800); }
    catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <AuthShell>
      <h1 className="text-[26px] font-extrabold tracking-tight">Choose a new password</h1>
      <p className="mb-6 mt-1.5 text-sm text-ink-soft">At least 8 characters. Avoid reusing old passwords.</p>
      <ErrorNote error={err} />
      {ok ? <div className="rounded-lg border border-brand-200 bg-brand-50 p-4 text-sm text-brand-800">Password updated. Taking you to sign in…</div> : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="New password"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Confirm new password"><Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
          <Button type="submit" size="lg" className="w-full" loading={busy}>Update password</Button>
        </form>
      )}
    </AuthShell>
  );
}
