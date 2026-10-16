// A small in-memory stand in for the subset of the Firestore Admin API that AfyaTrack uses.
// Used by the automated tests (DB_DRIVER=memory) so they run without a Firebase project.
// Supported: collection().doc(), add(), where(field, op, value) with == != < <= > >= in, limit(),
// get(), doc get/set(merge)/update/create/delete, runTransaction (get/set/update/create/delete), batch().

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const stripUndefined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

class AlreadyExists extends Error {
  constructor(path) { super(`6 ALREADY_EXISTS: Document already exists: ${path}`); this.code = 6; }
}
class NotFound extends Error {
  constructor(path) { super(`5 NOT_FOUND: No document to update: ${path}`); this.code = 5; }
}

function snapshot(store, name, id, ref) {
  const data = store.get(name)?.get(id);
  return { id, ref, exists: data !== undefined, data: () => clone(data) };
}

function compare(a, op, b) {
  switch (op) {
    case '==': return a === b || (a == null && b == null);
    case '!=': return a !== b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
    case 'in': return Array.isArray(b) && b.includes(a);
    default: throw new Error(`Unsupported operator ${op}`);
  }
}

export function createMemoryFirestore() {
  const store = new Map(); // collection -> Map(id -> data)
  let autoId = 0;
  const table = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  };

  const docRef = (name, id) => {
    const ref = {
      id,
      path: `${name}/${id}`,
      async get() { return snapshot(store, name, id, ref); },
      async set(data, opts = {}) {
        const t = table(name);
        const prev = opts.merge ? t.get(id) || {} : {};
        t.set(id, clone({ ...prev, ...stripUndefined(data) }));
      },
      async update(patch) {
        const t = table(name);
        if (!t.has(id)) throw new NotFound(ref.path);
        t.set(id, clone({ ...t.get(id), ...stripUndefined(patch) }));
      },
      async create(data) {
        const t = table(name);
        if (t.has(id)) throw new AlreadyExists(ref.path);
        t.set(id, clone(stripUndefined(data)));
      },
      async delete() { table(name).delete(id); },
    };
    return ref;
  };

  const query = (name, filters = [], max = null) => ({
    where(field, op, value) { return query(name, [...filters, { field, op, value }], max); },
    limit(n) { return query(name, filters, n); },
    async get() {
      let docs = [...table(name).entries()]
        .filter(([, d]) => filters.every((f) => compare(d[f.field] ?? null, f.op, f.value)))
        .map(([id]) => snapshot(store, name, id, docRef(name, id)));
      if (max != null) docs = docs.slice(0, max);
      return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn) => docs.forEach(fn) };
    },
  });

  const collection = (name) => ({
    ...query(name),
    doc: (id) => docRef(name, id ?? `auto${++autoId}`),
    async add(data) { const ref = docRef(name, `auto${++autoId}`); await ref.set(data); return ref; },
  });

  // Transactions run one at a time (Node is single threaded), so they are trivially serialisable here.
  let chain = Promise.resolve();
  const runTransaction = (fn) => {
    const run = async () => {
      const writes = [];
      const tx = {
        get: (refOrQuery) => refOrQuery.get(),
        set: (ref, data, opts) => { writes.push(() => ref.set(data, opts)); return tx; },
        update: (ref, data) => { writes.push(() => ref.update(data)); return tx; },
        create: (ref, data) => { writes.push(() => ref.create(data)); return tx; },
        delete: (ref) => { writes.push(() => ref.delete()); return tx; },
      };
      const result = await fn(tx);
      for (const w of writes) await w();
      return result;
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  };

  const batch = () => {
    const writes = [];
    const b = {
      set: (ref, data, opts) => { writes.push(() => ref.set(data, opts)); return b; },
      update: (ref, data) => { writes.push(() => ref.update(data)); return b; },
      create: (ref, data) => { writes.push(() => ref.create(data)); return b; },
      delete: (ref) => { writes.push(() => ref.delete()); return b; },
      async commit() { for (const w of writes) await w(); },
    };
    return b;
  };

  return {
    isMemory: true,
    collection,
    runTransaction,
    batch,
    async listCollections() { return [...store.keys()].map((id) => ({ id })); },
    settings() {},
    _dump: () => Object.fromEntries([...store].map(([k, m]) => [k, Object.fromEntries(m)])),
    _load: (dump) => { store.clear(); for (const [k, docs] of Object.entries(dump)) store.set(k, new Map(Object.entries(docs))); },
  };
}
