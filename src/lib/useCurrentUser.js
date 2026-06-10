// Compatibility shim — delegates to RoleContext
// New code should import useRole from '@/lib/RoleContext' directly
import { useRole } from '@/lib/RoleContext';

export function useCurrentUser() {
  const { user, loading, role, can } = useRole();
  return { user, loading, role, can };
}