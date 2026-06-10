// Role-Based Access Control definitions

export const ROLES = {
  ADMIN: 'admin',
  CO_LEADER: 'co_leader',
  TEACHER: 'teacher',
  VOLUNTEER: 'volunteer',
  BOARD_REP: 'board_rep',
  PARENT: 'parent',
};

export const ROLE_LABELS = {
  admin: 'Administrator',
  co_leader: 'Co-Leader',
  teacher: 'Teacher',
  volunteer: 'Volunteer',
  board_rep: 'Board Representative',
  parent: 'Parent',
};

// Permissions granted per role
const ROLE_PERMISSIONS = {
  admin: [
    'view_dashboard', 'view_children', 'edit_children', 'delete_children',
    'view_parents', 'edit_parents', 'view_medical', 'view_parent_contact',
    'view_classes', 'edit_classes', 'view_all_classes',
    'view_attendance', 'edit_attendance',
    'view_curriculum', 'edit_curriculum',
    'view_events', 'edit_events',
    'view_documents', 'edit_documents',
    'view_communications', 'edit_communications',
    'view_tasks', 'edit_tasks',
    'view_reports', 'view_users', 'edit_users',
    'view_teachers', 'edit_teachers',
    'view_volunteers', 'edit_volunteers',
    'view_as_role',
  ],
  co_leader: [
    'view_dashboard', 'view_children', 'edit_children', 'delete_children',
    'view_parents', 'edit_parents', 'view_medical', 'view_parent_contact',
    'view_classes', 'edit_classes', 'view_all_classes',
    'view_attendance', 'edit_attendance',
    'view_curriculum', 'edit_curriculum',
    'view_events', 'edit_events',
    'view_documents', 'edit_documents',
    'view_communications', 'edit_communications',
    'view_tasks', 'edit_tasks',
    'view_reports', 'view_teachers', 'edit_teachers',
    'view_volunteers', 'edit_volunteers',
    'view_as_role',
  ],
  teacher: [
    'view_dashboard',
    'view_children',        // only assigned class children
    'view_parents',         // only assigned class parents
    'view_medical',         // only assigned class children
    'view_parent_contact',  // only assigned class parents
    'view_classes',         // only their class
    'view_attendance', 'edit_attendance', // only their class
    'view_curriculum',      // only assigned curriculum
    'view_events',          // only related events
    'view_communications',  // teacher comms only
    'view_tasks',
  ],
  volunteer: [
    'view_dashboard',
    'view_events',          // only assigned events
    'view_tasks', 'edit_tasks',
    'view_communications',  // volunteer comms only
  ],
  board_rep: [
    'view_dashboard',
    'view_reports',
    'view_documents',       // board documents only
    'view_attendance',      // aggregated only
    'view_events',
  ],
  parent: [
    'view_dashboard',
    'view_events',          // parent-visible events only
    'view_communications',  // parent announcements only
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
  return ['admin', 'co_leader', 'teacher'].includes(role);
}

// Which roles can see parent contact info
export function canViewParentContact(role) {
  return ['admin', 'co_leader', 'teacher'].includes(role);
}

// Which roles have full management access
export function isManagementRole(role) {
  return ['admin', 'co_leader'].includes(role);
}