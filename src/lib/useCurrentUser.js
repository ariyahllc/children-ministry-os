import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

export function useCurrentUser() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const role = user?.role || 'volunteer';

  const can = (action) => {
    if (role === 'admin') return true;
    const permissions = {
      teacher: ['view_children', 'view_classes', 'view_attendance', 'view_curriculum', 'view_events', 'view_dashboard'],
      volunteer: ['view_events', 'view_tasks', 'view_dashboard'],
      board_member: ['view_dashboard', 'view_reports', 'view_documents'],
    };
    return (permissions[role] || []).includes(action);
  };

  return { user, loading, role, can };
}