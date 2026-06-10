import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Users, Search, Pencil, Shield, Save, X } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { ROLE_LABELS, ROLES } from '@/lib/rbac';
import { useRole } from '@/lib/RoleContext';

const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));

const roleBadgeColors = {
  admin: 'bg-red-100 text-red-700 border-red-200',
  co_leader: 'bg-purple-100 text-purple-700 border-purple-200',
  teacher: 'bg-blue-100 text-blue-700 border-blue-200',
  co_teacher: 'bg-sky-100 text-sky-700 border-sky-200',
  event_volunteer: 'bg-amber-100 text-amber-700 border-amber-200',
  board_rep: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  parent: 'bg-muted text-muted-foreground border-border',
};

export default function UserManagement() {
  const { can } = useRole();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editUser, setEditUser] = useState(null);
  const [editData, setEditData] = useState({});

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.User.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setEditUser(null);
    },
  });

  const filtered = users.filter(u =>
    !search ||
    (u.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (u.email || '').toLowerCase().includes(search.toLowerCase()) ||
    (u.role || '').toLowerCase().includes(search.toLowerCase())
  );

  const openEdit = (u) => {
    setEditUser(u);
    setEditData({ role: u.role || 'event_volunteer', active: u.active !== false });
  };

  if (!can('view_users')) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Shield className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">Access Restricted</p>
          <p className="text-sm text-muted-foreground mt-1">You don't have permission to view user management.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="User Management" subtitle="Manage roles and permissions for ministry members" />

      <Card className="border-0 shadow-sm overflow-hidden">
        <div className="p-4 border-b flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search users by name, email, or role..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 bg-muted/50 border-0"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">Loading users...</div>
        ) : (
          <div className="divide-y">
            {filtered.map(u => (
              <div key={u.id} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-semibold text-primary">
                      {(u.full_name || u.email || '?')[0].toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{u.full_name || '(No name)'}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <Badge variant="outline" className={`text-xs ${roleBadgeColors[u.role] || roleBadgeColors.parent}`}>
                    {ROLE_LABELS[u.role] || u.role || 'No role'}
                  </Badge>
                  {u.active === false && (
                    <Badge variant="outline" className="text-xs bg-muted text-muted-foreground">Inactive</Badge>
                  )}
                  {can('edit_users') && (
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(u)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="p-12 text-center">
                <Users className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No users found</p>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Role legend */}
      <Card className="p-4 border-0 shadow-sm">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Role Permissions Summary</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {ROLE_OPTIONS.map(({ value, label }) => (
            <div key={value} className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${roleBadgeColors[value]?.split(' ')[0] || 'bg-muted'}`} />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editUser} onOpenChange={() => setEditUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User — {editUser?.full_name || editUser?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={editData.role} onValueChange={v => setEditData(d => ({ ...d, role: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch checked={editData.active} onCheckedChange={v => setEditData(d => ({ ...d, active: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}><X className="w-4 h-4 mr-2" />Cancel</Button>
            <Button
              onClick={() => updateMutation.mutate({ id: editUser.id, data: editData })}
              disabled={updateMutation.isPending}
            >
              <Save className="w-4 h-4 mr-2" />{updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}