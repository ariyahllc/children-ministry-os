import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import PageHeader from '@/components/shared/PageHeader';
import DataTable from '@/components/shared/DataTable';
import FormDialog from '@/components/shared/FormDialog';
import DeleteDialog from '@/components/shared/DeleteDialog';
import { useCurrentUser } from '@/lib/useCurrentUser';

export default function Volunteers() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [selected, setSelected] = useState(null);
  const queryClient = useQueryClient();
  const { role } = useCurrentUser();
  const isAdmin = role === 'admin';

  const { data: volunteers = [], isLoading } = useQuery({ queryKey: ['volunteers'], queryFn: () => base44.entities.Volunteer.list() });

  const saveMutation = useMutation({
    mutationFn: (data) => data.id ? base44.entities.Volunteer.update(data.id, data) : base44.entities.Volunteer.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['volunteers'] }); setFormOpen(false); }
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Volunteer.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['volunteers'] }); setDeleteOpen(false); }
  });

  const bgCheckColors = {
    'Cleared': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    'Pending': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    'Expired': 'bg-destructive/10 text-destructive border-destructive/20',
    'Not Started': 'bg-muted text-muted-foreground',
  };

  const columns = [
    { header: 'Name', accessor: 'name', render: row => <span className="font-medium">{row.name}</span> },
    { header: 'Email', accessor: 'email' },
    { header: 'Phone', accessor: 'phone' },
    { header: 'Availability', accessor: 'availability' },
    { header: 'Background Check', accessor: 'background_check', render: row => (
      <Badge variant="outline" className={bgCheckColors[row.background_check] || bgCheckColors['Not Started']}>
        {row.background_check || 'Not Started'}
      </Badge>
    )}
  ];

  const fields = [
    { name: 'name', label: 'Full Name', placeholder: 'Enter full name' },
    { name: 'email', label: 'Email', type: 'email', placeholder: 'Email address' },
    { name: 'phone', label: 'Phone', placeholder: 'Phone number' },
    { name: 'availability', label: 'Availability', type: 'select', options: [
      { value: 'Weekdays', label: 'Weekdays' }, { value: 'Weekends', label: 'Weekends' },
      { value: 'Both', label: 'Both' }, { value: 'On Call', label: 'On Call' }
    ]},
    { name: 'skills', label: 'Skills', type: 'textarea', placeholder: 'Skills and abilities' },
    { name: 'background_check', label: 'Background Check', type: 'select', options: [
      { value: 'Not Started', label: 'Not Started' }, { value: 'Pending', label: 'Pending' },
      { value: 'Cleared', label: 'Cleared' }, { value: 'Expired', label: 'Expired' }
    ]},
    { name: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Volunteers" subtitle={`${volunteers.length} volunteers`} action={isAdmin ? () => { setFormData({ background_check: 'Not Started' }); setFormOpen(true); } : undefined} actionLabel="Add Volunteer" />
      <DataTable columns={columns} data={volunteers} isLoading={isLoading} onEdit={isAdmin ? (r) => { setFormData(r); setFormOpen(true); } : undefined} onDelete={isAdmin ? (r) => { setSelected(r); setDeleteOpen(true); } : undefined} searchPlaceholder="Search volunteers..." emptyMessage="No volunteers added yet" />
      <FormDialog open={formOpen} onClose={setFormOpen} title={formData.id ? 'Edit Volunteer' : 'Add Volunteer'} fields={fields} data={formData} onChange={setFormData} onSave={() => saveMutation.mutate(formData)} saving={saveMutation.isPending} />
      <DeleteDialog open={deleteOpen} onClose={setDeleteOpen} onConfirm={() => deleteMutation.mutate(selected?.id)} />
    </div>
  );
}