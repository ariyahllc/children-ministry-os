// Role-Based Access Control definitions

export const ROLES = {
  ADMIN: 'admin',
  CO_LEADER: 'co_leader',
  TEACHER: 'teacher',
  CO_TEACHER: 'co_teacher',
  EVENT_VOLUNTEER: 'event_volunteer',
  BOARD_REP: 'board_rep',
  PARENT: 'parent',
};

export const ROLE_LABELS = {
  admin: 'Administrator',
  co_leader: 'Co-Leader',
  teacher: 'Teacher',
  co_teacher: 'Co-Teacher',
  event_volunteer: 'Event Volunteer',
  board_rep: 'Board Representative',
  parent: 'Parent',
};

// Permissions granted per role
const ROLE_PERMISSIONS = {
  admin: [
    'view_dashboard', 'view_children', 'edit_children', 'delete_children',
    'view_parents', 'edit_parents', 'view_medical', 'view_classes', 'edit_classes',
    'view_attendance', 'edit_attendance', 'view_curriculum', 'edit_curriculum',
    'view_events', 'edit_events', 'view_documents', 'edit_documents',
    'view_communications', 'edit_communications', 'view_tasks', 'edit_tasks',
    'view_reports', 'view_users', 'edit_users', 'view_teachers', 'edit_teachers',
    'view_volunteers', 'edit_volunteers', 'view_all_classes', 'view_as_role',
  ],
  co_leader: [
    'view_dashboard', 'view_children', 'edit_children', 'delete_children',
    'view_parents', 'edit_parents', 'view_medical', 'view_classes', 'edit_classes',
    'view_attendance', 'edit_attendance', 'view_curriculum', 'edit_curriculum',
    'view_events', 'edit_events', 'view_documents', 'edit_documents',
    'view_communications', 'edit_communications', 'view_tasks', 'edit_tasks',
    'view_reports', 'view_teachers', 'edit_teachers', 'view_volunteers', 'edit_volunteers',
    'view_all_classes', 'view_as_role',
  ],
  teacher: [
    'view_dashboard', 'view_children', 'view_parents', 'view_medical',
    'view_classes', 'view_attendance', 'edit_attendance', 'view_curriculum',
    'view_events', 'view_communications', 'view_tasks',
  ],
  co_teacher: [
    'view_dashboard', 'view_children', 'view_parents', 'view_medical',
    'view_classes', 'view_attendance', 'edit_attendance', 'view_curriculum',
    'view_events', 'view_communications', 'view_tasks',
  ],
  event_volunteer: [
    'view_dashboard', 'view_events', 'view_tasks', 'edit_tasks',
    'view_communications',
  ],
  board_rep: [
    'view_dashboard', 'view_reports', 'view_documents', 'view_attendance',
    'view_events',
  ],
  parent: [
    'view_dashboard', 'view_events',
  ],
};

export function getPermissions(role) {
  return ROLE_PERMISSIONS[role] || [];
}

export function can(role, permission) {
  return getPermissions(role).includes(permission);
}

// Which roles can see medical/allergy data
export function canViewMedical(role) {
  return ['admin', 'co_leader', 'teacher', 'co_teacher'].includes(role);
}

// Which roles can see parent contact info
export function canViewParentContact(role) {
  return ['admin', 'co_leader', 'teacher', 'co_teacher'].includes(role);
}

// Which roles have full management access
export function isManagementRole(role) {
  return ['admin', 'co_leader'].includes(role);
}