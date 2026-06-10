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
import { Checkbox } from '@/components/ui/checkbox';
import { Users, Search, Pencil, Shield, Save, X, BookOpen, Calendar } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import { ROLE_LABELS } from '@/lib/rbac';
import { useRole } from '@/lib/RoleContext';

const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));

const roleBadgeColors = {
  admin: 'bg-red-100 text-red-700 border-red-200',
  co_leader: 'bg-purple-100 text-purple-700 border-purple-200',
  teacher: 'bg-blue-100 text-blue-700 border-blue-200',
  volunteer: 'bg-amber-100 text-amber-700 border-amber-200',
  board_rep: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  parent: 'bg-muted text-muted-foreground border-border',
};

export default function UserManagement() {
  const { can } = useRole();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [editUser, setEditUser] = useState(null);
  const [editData, setEditData] = useState({});

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list(),
  });
  const { data: classes = [] } = useQuery({
    queryKey: ['classes'],
    queryFn: () => base44.entities.MinistryClass.list(),
  });
  const { data: events = [] } = useQuery({
    queryKey: ['events'],
    queryFn: () => base44.entities.Event.list('-date', 50),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.User.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setEditUser(null);
    },
  });

  const filtered = users.filter(u => {
    const matchSearch = !search ||
      (u.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
      (u.email || '').toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const openEdit = (u) => {
    setEditUser(u);
    setEditData({
      role: u.role || 'volunteer',
      active: u.active !== false,
      assigned_class_id: u.assigned_class_id || '',
      assigned_event_ids: u.assigned_event_ids || [],
    });
  };

  const toggleEvent = (eventId) => {
    setEditData(d => ({
      ...d,
      assigned_event_ids: d.assigned_event_ids.includes(eventId)
        ? d.assigned_event_ids.filter(id => id !== eventId)
        : [...d.assigned_event_ids, eventId],
    }));
  };

  const getClassName = (id) => classes.find(c => c.id === id)?.name;
  const getEventNames = (ids = []) => ids.map(id => events.find(e => e.id === id)?.name).filter(Boolean).join(', ');

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
      <PageHeader
        title="User Management"
        subtitle="Manage roles, assignments, and permissions for ministry members"
      />

      {/* Summary cards */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
        {ROLE_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setRoleFilter(roleFilter === value ? 'all' : value)}
            className={`p-3 rounded-xl border text-left transition-all ${roleFilter === value ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/30'}`}
          >
            <p className="text-xl font-bold">{users.filter(u => u.role === value).length}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{label}</p>
          </button>
        ))}
      </div>

      <Card className="border-0 shadow-sm overflow-hidden">
        <div className="p-4 border-b flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 bg-muted/50 border-0"
            />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Filter by role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              {ROLE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
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
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {u.assigned_class_id && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                          <BookOpen className="w-3 h-3" />{getClassName(u.assigned_class_id) || 'Class'}
                        </span>
                      )}
                      {u.assigned_event_ids?.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                          <Calendar className="w-3 h-3" />{u.assigned_event_ids.length} event{u.assigned_event_ids.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <Badge variant="outline" className={`text-xs hidden sm:flex ${roleBadgeColors[u.role] || roleBadgeColors.parent}`}>
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

      {/* Edit Dialog */}
      <Dialog open={!!editUser} onOpenChange={() => setEditUser(null)}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-heading">Edit User</DialogTitle>
            <p className="text-sm text-muted-foreground">{editUser?.full_name || editUser?.email}</p>
          </DialogHeader>
          <div className="space-y-5 py-4">
            {/* Role */}
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

            {/* Assigned Class — show for teacher */}
            {(editData.role === 'teacher') && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2"><BookOpen className="w-4 h-4" /> Assigned Class</Label>
                <Select
                  value={editData.assigned_class_id || '__none__'}
                  onValueChange={v => setEditData(d => ({ ...d, assigned_class_id: v === '__none__' ? '' : v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select class" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Assigned Events — show for volunteer */}
            {editData.role === 'volunteer' && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2"><Calendar className="w-4 h-4" /> Assigned Events</Label>
                <div className="max-h-40 overflow-y-auto border rounded-lg p-3 space-y-2">
                  {events.length === 0 && <p className="text-xs text-muted-foreground">No events available</p>}
                  {events.map(e => (
                    <div key={e.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`evt-${e.id}`}
                        checked={(editData.assigned_event_ids || []).includes(e.id)}
                        onCheckedChange={() => toggleEvent(e.id)}
                      />
                      <label htmlFor={`evt-${e.id}`} className="text-sm cursor-pointer">{e.name}</label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Active toggle */}
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