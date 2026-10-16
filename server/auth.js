import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { isActive } from './store.js';
import { todayNairobi } from './util.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me-' + 'afyatrack';
export const SESSION_HOURS = Number(process.env.SESSION_HOURS || 10);
export const COOKIE = 'afyatrack_session';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET must be set in production. See README.');
  process.exit(1);
}

export function signToken(user) {
  return jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: `${SESSION_HOURS}h` });
}

export function hashToken(t) {
  return crypto.createHash('sha256').update(t).digest('hex');
}

/** Active memberships of a user (ward + role), with ward names. */
export async function membershipsOf(store, userId) {
  const today = todayNairobi();
  const [mems, wards] = await Promise.all([store.find('memberships', { user_id: userId }), store.find('wards', { status: 'active' })]);
  const wardMap = new Map(wards.map((w) => [w.id, w]));
  return mems
    .filter((m) => wardMap.has(m.ward_id) && (!m.active_to || m.active_to >= today))
    .map((m) => ({ ...m, ward: wardMap.get(m.ward_id) }));
}

// Loads the user and resolves the active ward + role. Access is enforced here, server side.
export function authenticate(store) {
  return async (req, res, next) => {
    try {
      const header = req.get('authorization');
      const token = header?.startsWith('Bearer ') ? header.slice(7) : req.cookies?.[COOKIE];
      if (!token) return res.status(401).json({ error: 'Please sign in.' });
      let payload;
      try { payload = jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ error: 'Your session has expired. Please sign in again.' }); }
      const u = await store.get('users', payload.sub);
      if (!u || !isActive(u.active)) return res.status(401).json({ error: 'This account is not active.' });
      const user = { id: u.id, full_name: u.full_name, email: u.email, phone: u.phone ?? null, active: u.active, is_admin: u.is_admin ? 1 : 0 };

      const wards = new Map();
      for (const m of await membershipsOf(store, user.id)) {
        if (!wards.has(m.ward_id)) wards.set(m.ward_id, { id: m.ward_id, name: m.ward.name, code: m.ward.code, roles: [] });
        wards.get(m.ward_id).roles.push(m.role);
      }
      if (user.is_admin) {
        const all = (await store.find('wards', { status: 'active' })).sort((a, b) => a.id - b.id);
        for (const w of all) {
          if (!wards.has(w.id)) wards.set(w.id, { id: w.id, name: w.name, code: w.code, roles: [] });
          wards.get(w.id).roles.push('admin');
        }
      }
      const requested = Number(req.get('x-ward-id') || req.query.ward_id || 0);
      const ward = requested ? wards.get(requested) : wards.values().next().value;
      if (requested && !ward) return res.status(403).json({ error: 'You are not authorised for that ward.' });

      req.user = user;
      req.wards = [...wards.values()];
      req.ward = ward || null;
      const roles = ward?.roles || [];
      req.roles = roles;
      req.role = roles.includes('admin') ? 'admin' : roles.includes('ward_lead') ? 'ward_lead' : roles.includes('officer') ? 'officer' : roles.includes('reviewer') ? 'reviewer' : null;
      next();
    } catch (e) {
      next(e);
    }
  };
}

export const RANK = { reviewer: 1, officer: 2, ward_lead: 3, admin: 4 };

// requireRole('officer') => officer, ward_lead or admin. Reviewer is read only.
export function requireRole(min) {
  return (req, res, next) => {
    if (!req.ward && min !== 'admin') return res.status(403).json({ error: 'No ward assigned to your account. Ask an administrator.' });
    if (!req.role || RANK[req.role] < RANK[min]) return res.status(403).json({ error: 'You do not have permission for this action.' });
    next();
  };
}

export function requireWard(req, res, next) {
  if (!req.ward) return res.status(403).json({ error: 'No ward assigned to your account. Ask an administrator.' });
  next();
}

export const isLead = (req) => req.role === 'ward_lead' || req.role === 'admin';
