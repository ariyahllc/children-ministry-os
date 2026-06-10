import React, { createContext, useContext, useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { can as checkCan, ROLE_LABELS } from '@/lib/rbac';

const RoleContext = createContext(null);

export function RoleProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewAsRole, setViewAsRole] = useState(null); // for "View As Role" feature

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const actualRole = user?.role || 'event_volunteer';
  // If viewAsRole is set (and user is admin/co_leader), use that for UI rendering
  const effectiveRole = viewAsRole || actualRole;

  const can = (permission) => checkCan(effectiveRole, permission);
  const canActual = (permission) => checkCan(actualRole, permission);

  const canViewAs = ['admin', 'co_leader'].includes(actualRole);

  return (
    <RoleContext.Provider value={{
      user,
      loading,
      role: effectiveRole,
      actualRole,
      roleLabel: ROLE_LABELS[effectiveRole] || effectiveRole,
      can,
      canActual,
      viewAsRole,
      setViewAsRole: canViewAs ? setViewAsRole : null,
      canViewAs,
    }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error('useRole must be used within RoleProvider');
  return ctx;
}