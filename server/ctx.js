// Per request loader: fetches ward scoped collections once and joins in memory
// (Firestore has no joins). Keeps route code close to the old SQL version.
import { REGISTERS } from './registers.js';
import { isActive, sortBy } from './store.js';
import { todayNairobi } from './util.js';

export function loader(store, req) {
  const cache = new Map();
  const once = (k, fn) => {
    if (!cache.has(k)) cache.set(k, fn());
    return cache.get(k);
  };
  const ward = req.ward?.id;
  const L = {
    users: () => once('users', () => store.byId('users')),
    categories: () => once('categories', () => store.byId('categories')),
    locations: () => once('locations', () => store.byId('locations', { ward_id: ward })),
    entities: (type) => once(`entities:${type}`, () => store.byId(REGISTERS[type].table, { ward_id: ward })),
    async entityName(type, id) {
      if (!REGISTERS[type] || id === null || id === undefined) return null;
      const m = await L.entities(type);
      return m.get(Number(id))?.[REGISTERS[type].nameField] ?? null;
    },
    async entityExists(type, id) {
      if (!REGISTERS[type] || id === null || id === undefined) return false;
      return (await L.entities(type)).has(Number(id));
    },
    async userName(id) {
      return (await L.users()).get(Number(id))?.full_name ?? null;
    },
    async categoryName(id) {
      return (await L.categories()).get(Number(id))?.name ?? null;
    },
    /** Active officers / ward leads of this ward, one row per user (roles joined). */
    officers: () => once('officers', async () => {
      const today = todayNairobi();
      const [mems, users] = await Promise.all([store.find('memberships', { ward_id: ward }), L.users()]);
      const out = new Map();
      for (const m of mems) {
        if (!['officer', 'ward_lead'].includes(m.role) || (m.active_to && m.active_to < today)) continue;
        const u = users.get(m.user_id);
        if (!u || !isActive(u.active)) continue;
        const row = out.get(u.id) || { id: u.id, full_name: u.full_name, roles: new Set() };
        row.roles.add(m.role);
        out.set(u.id, row);
      }
      return sortBy([...out.values()].map((o) => ({ id: o.id, full_name: o.full_name, role: [...o.roles].join(',') })), 'full_name');
    }),
    async memberIds() {
      return new Set((await L.officers()).map((o) => o.id));
    },
  };
  return L;
}
