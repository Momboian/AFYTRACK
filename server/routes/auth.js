import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { signToken, hashToken, COOKIE, SESSION_HOURS, authenticate } from '../auth.js';
import { makeAudit, asyncRouter } from '../util.js';
import { isActive, nowIso } from '../store.js';

export function authRoutes(store) {
  const r = asyncRouter(express.Router());
  const audit = makeAudit(store);
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.AUTH_RATE_LIMIT || 30), standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait a few minutes and try again.' } });

  const cookieOpts = {
    httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true',
    maxAge: SESSION_HOURS * 3600 * 1000, path: '/'
  };
  const ctx = (req, user) => ({ user, ip: req.ip, get: req.get.bind(req) });
  const findUserByEmail = async (email) => {
    const e = String(email || '').trim().toLowerCase();
    return e ? store.findOne('users', { email_lower: e }) : null;
  };

  r.post('/login', limiter, async (req, res) => {
    const email = String(req.body?.email || '').trim();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Enter your email and password.' });
    const user = await findUserByEmail(email);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      await audit(ctx(req, null), 'login_failed', 'user', user?.id, { email });
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    if (!isActive(user.active)) {
      await audit(ctx(req, user), 'login_blocked_inactive', 'user', user.id);
      return res.status(403).json({ error: 'This account has been deactivated. Contact your administrator.' });
    }
    await store.update('users', user.id, { last_login_at: nowIso() }, { touch: false });
    const token = signToken(user);
    res.cookie(COOKIE, token, cookieOpts);
    await audit(ctx(req, user), 'login', 'user', user.id);
    // token is also returned for the Android app (Bearer header)
    res.json({ ok: true, token });
  });

  r.post('/logout', (req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // Forgot password: always responds the same way so emails cannot be discovered.
  r.post('/forgot', limiter, async (req, res) => {
    const user = await findUserByEmail(req.body?.email);
    if (user && isActive(user.active)) {
      const token = crypto.randomBytes(24).toString('hex');
      await store.insert('password_resets', {
        user_id: user.id, token_hash: hashToken(token), used_at: null,
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString()
      });
      const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      const link = `${base}/reset-password?token=${token}`;
      // No email provider configured in the MVP: the link is written to the server log for the administrator to send.
      console.log(`[password reset] ${user.email}: ${link}`);
      await audit(ctx(req, user), 'password_reset_requested', 'user', user.id);
    }
    res.json({ ok: true, message: 'If that email belongs to an active account, a reset link has been sent to your administrator / inbox.' });
  });

  r.post('/reset', limiter, async (req, res) => {
    const { token, password } = req.body || {};
    if (!token || !password || String(password).length < 8)
      return res.status(400).json({ error: 'Use a password with at least 8 characters.' });
    const row = await store.findOne('password_resets', { token_hash: hashToken(token), used_at: null });
    if (!row || row.expires_at <= nowIso()) return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
    await store.update('users', row.user_id, { password_hash: bcrypt.hashSync(password, 11) });
    await store.update('password_resets', row.id, { used_at: nowIso() });
    await audit(ctx(req, { id: row.user_id }), 'password_reset_completed', 'user', row.user_id);
    res.json({ ok: true });
  });

  const auth = authenticate(store);

  r.get('/me', auth, (req, res) => {
    res.json({ user: req.user, wards: req.wards, ward: req.ward, role: req.role, roles: req.roles });
  });

  r.post('/change-password', auth, async (req, res) => {
    const { current, password } = req.body || {};
    const u = await store.get('users', req.user.id);
    if (!bcrypt.compareSync(String(current || ''), u.password_hash)) return res.status(400).json({ error: 'Current password is incorrect.' });
    if (!password || String(password).length < 8) return res.status(400).json({ error: 'Use a password with at least 8 characters.' });
    await store.update('users', req.user.id, { password_hash: bcrypt.hashSync(password, 11) });
    await audit(req, 'password_changed', 'user', req.user.id);
    res.json({ ok: true });
  });

  return r;
}
