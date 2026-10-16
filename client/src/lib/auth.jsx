import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setWardId, getWardId, setUnauthorizedHandler } from './api.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, me: null });
  const [lookups, setLookups] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const me = await api('/auth/me');
      if (me.ward && String(me.ward.id) !== getWardId()) setWardId(me.ward.id);
      // Load lookups first so pages never render without them
      const lk = me.ward ? await api('/lookups') : { categories: [], officers: [], locations: [], templates: [], premises: [] };
      setLookups(lk);
      setState({ loading: false, me });
    } catch {
      setState({ loading: false, me: null });
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setState((s) => (s.me ? { loading: false, me: null } : s)));
    refresh();
  }, [refresh]);

  const login = async (email, password) => {
    await api('/auth/login', { method: 'POST', body: { email, password } });
    setWardId(null);
    await refresh();
  };
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setWardId(null);
    setState({ loading: false, me: null });
  };
  const switchWard = async (id) => { setWardId(id); await refresh(); };
  const reloadLookups = async () => setLookups(await api('/lookups'));

  const me = state.me;
  const role = me?.role;
  const can = {
    write: ['officer', 'ward_lead', 'admin'].includes(role),
    lead: ['ward_lead', 'admin'].includes(role),
    admin: !!me?.user?.is_admin,
    audit: !!me?.user?.is_admin || ['reviewer', 'ward_lead'].includes(role)
  };

  return (
    <AuthCtx.Provider value={{ ...state, role, can, login, logout, refresh, switchWard, lookups, reloadLookups }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const ROLE_LABEL = { officer: 'PHO / Officer', ward_lead: 'Ward PHO', admin: 'System Administrator', reviewer: 'Read only reviewer' };
