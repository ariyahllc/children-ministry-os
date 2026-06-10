import React from 'react';
import { useRole } from '@/lib/RoleContext';
import PageHeader from '@/components/shared/PageHeader';
import AdminDashboard from '@/pages/dashboards/AdminDashboard';
import TeacherDashboard from '@/pages/dashboards/TeacherDashboard';
import VolunteerDashboard from '@/pages/dashboards/VolunteerDashboard';
import BoardDashboard from '@/pages/dashboards/BoardDashboard';
import ParentDashboard from '@/pages/dashboards/ParentDashboard';
import { ROLE_LABELS } from '@/lib/rbac';

const DASHBOARD_MAP = {
  admin: AdminDashboard,
  co_leader: AdminDashboard,
  teacher: TeacherDashboard,
  co_teacher: TeacherDashboard,
  event_volunteer: VolunteerDashboard,
  board_rep: BoardDashboard,
  parent: ParentDashboard,
};

export default function Dashboard() {
  const { role, roleLabel, viewAsRole } = useRole();
  const DashboardComponent = DASHBOARD_MAP[role] || AdminDashboard;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle={viewAsRole ? `Previewing as: ${roleLabel}` : `${roleLabel} overview`}
      />
      <DashboardComponent />
    </div>
  );
}