import React from 'react';
import { useRole } from '@/lib/RoleContext';
import { ROLE_LABELS } from '@/lib/rbac';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Eye, X } from 'lucide-react';

const ALL_ROLES = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));

export default function ViewAsRoleBanner() {
  const { canViewAs, viewAsRole, setViewAsRole, actualRole } = useRole();

  if (!canViewAs) return null;

  return (
    <div className={`flex items-center gap-3 px-4 py-2 text-sm ${viewAsRole ? 'bg-amber-50 border-b border-amber-200 text-amber-800' : 'bg-muted/40 border-b border-border text-muted-foreground'}`}>
      <Eye className="w-4 h-4 flex-shrink-0" />
      <span className="font-medium text-xs hidden sm:inline">View As Role:</span>
      <Select
        value={viewAsRole || '__actual__'}
        onValueChange={v => setViewAsRole(v === '__actual__' ? null : v)}
      >
        <SelectTrigger className="h-7 text-xs w-44 bg-white border-border">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__actual__">— My actual role —</SelectItem>
          {ALL_ROLES.map(r => (
            <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {viewAsRole && (
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-amber-700 hover:text-amber-900" onClick={() => setViewAsRole(null)}>
          <X className="w-3 h-3 mr-1" /> Reset
        </Button>
      )}
      {viewAsRole && (
        <span className="text-xs hidden md:inline">Previewing as <strong>{ROLE_LABELS[viewAsRole]}</strong> — changes are not saved</span>
      )}
    </div>
  );
}