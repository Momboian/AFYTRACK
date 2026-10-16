// Thin data layer over Cloud Firestore.
// Each former SQL table is a top level collection. Documents keep a numeric `id` (doc id = String(id))
// so the website and Android app keep the same API. Ids come from counters in `_counters`.
// Queries use equality filters only (served by Firestore's automatic single field indexes, so no
// composite indexes are needed); ranges, joins and sorting are done in memory. Data is ward scoped,
// which keeps result sets small for a ward pilot.
import { getFirestore } from './firestore.js';

export const nowIso = () => new Date().toISOString();

export function makeStore(db) {
  const col = (c) => db.collection(c);
  const ref = (c, id) => col(c).doc(String(id));

  const store = {
    db,

    async nextId(c) {
      const counter = col('_counters').doc(c);
      return db.runTransaction(async (tx) => {
        const s = await tx.get(counter);
        const n = (s.exists ? Number(s.data().value) || 0 : 0) + 1;
        tx.set(counter, { value: n });
        return n;
      });
    },

    /** Inserts a document and returns its new numeric id. */
    async insert(c, data, { timestamps = true } = {}) {
      const id = await store.nextId(c);
      const t = nowIso();
      const doc = { ...(timestamps ? { created_at: t, updated_at: t } : {}), ...data, id };
      await ref(c, id).set(doc);
      return id;
    },

    async get(c, id) {
      if (id === null || id === undefined || id === '') return null;
      const s = await ref(c, id).get();
      return s.exists ? s.data() : null;
    },

    /** Equality filters only, e.g. find('tasks', { ward_id: 1, deleted_at: null }). */
    async find(c, where = {}) {
      let q = col(c);
      for (const [k, v] of Object.entries(where)) if (v !== undefined) q = q.where(k, '==', v);
      const snap = await q.get();
      return snap.docs.map((d) => d.data());
    },

    async findOne(c, where) {
      return (await store.find(c, where))[0] || null;
    },

    async all(c) {
      const snap = await col(c).get();
      return snap.docs.map((d) => d.data());
    },

    async update(c, id, patch, { touch = true } = {}) {
      await ref(c, id).update({ ...patch, ...(touch ? { updated_at: nowIso() } : {}) });
    },

    async remove(c, id) {
      await ref(c, id).delete();
    },

    /** Claims a unique key once (e.g. "activity_task_12"). Returns false if already claimed. */
    async claim(key) {
      try {
        await col('_unique').doc(key).create({ at: nowIso() });
        return true;
      } catch (e) {
        if (e.code === 6 || /ALREADY_EXISTS/.test(e.message)) return false;
        throw e;
      }
    },

    async release(key) {
      await col('_unique').doc(key).delete();
    },

    /** Map of id -> document for a collection filtered by equality. */
    async byId(c, where = {}) {
      return new Map((await store.find(c, where)).map((d) => [d.id, d]));
    },
  };
  return store;
}

let storePromise;
export function getStore() {
  if (!storePromise) storePromise = getFirestore().then(makeStore);
  return storePromise;
}

// ---- small in memory helpers used by the routes ----
export const byKey = (rows, key = 'id') => new Map(rows.map((r) => [r[key], r]));
export const sortBy = (rows, ...keys) =>
  [...rows].sort((a, b) => {
    for (const k of keys) {
      const desc = k.startsWith('-');
      const f = desc ? k.slice(1) : k;
      const av = a[f] ?? '', bv = b[f] ?? '';
      if (av < bv) return desc ? 1 : -1;
      if (av > bv) return desc ? -1 : 1;
    }
    return 0;
  });
export const isActive = (v) => v === 1 || v === true || v === '1';
