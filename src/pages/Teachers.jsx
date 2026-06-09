import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import PageHeader from '@/components/shared/PageHeader';
import DataTable from '@/components/shared/DataTable';
import FormDialog from '@/components/shared/FormDialog';
import DeleteDialog from '@/components/shared/DeleteDialog';
import { useCurrentUser } from '@/lib/useCurrentUser';

export default function Teachers() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [selected, setSelected] = useState(null);
  const queryClient = useQueryClient();
  const { role } = useCurrentUser();
  const isAdmin = role === 'admin';

  const { data: teachers = [], isLoading } = useQuery({ queryKey: ['teachers'], queryFn: () => base44.entities.Teacher.list() });
  const { data: classes = [] } = useQuery({ queryKey: ['classes'], queryFn: () => base44.entities.MinistryClass.list() });

  const saveMutation = useMutation({
    mutationFn: (data) => data.id ? base44.entities.Teacher.update(data.id, data) : base44.entities.Teacher.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['teachers'] }); setFormOpen(false); }
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Teacher.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['teachers'] }); setDeleteOpen(false); }
  });

  const className_ = (id) => classes.find(c => c.id === id)?.name || '—';

  const columns = [
    { header: 'Name', accessor: 'name', render: row => <span className="font-medium">{row.name}</span> },
    { header: 'Email', accessor: 'email' },
    { header: 'Phone', accessor: 'phone' },
    { header: 'Class', accessor: 'class_assignment', render: row => className_(row.class_assignment) },
    { header: 'Status', accessor: 'active', render: row => (
      <Badge variant="outline" className={row.active !== false ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-muted text-muted-foreground'}>
        {row.active !== false ? 'Active' : 'Inactive'}
      </Badge>
    )}
  ];

  const fields = [
    { name: 'name', label: 'Full Name', placeholder: 'Enter full name' },
    { name: 'email', label: 'Email', type: 'email', placeholder: 'Email address' },
    { name: 'phone', label: 'Phone', placeholder: 'Phone number' },
    { name: 'class_assignment', label: 'Class Assignment', type: 'select', options: classes.map(c => ({ value: c.id, label: c.name })) },
    { name: 'active', label: 'Active', type: 'switch' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Teachers" subtitle={`${teachers.length} teachers`} action={isAdmin ? () => { setFormData({ active: true }); setFormOpen(true); } : undefined} actionLabel="Add Teacher" />
      <DataTable columns={columns} data={teachers} isLoading={isLoading} onEdit={isAdmin ? (r) => { setFormData(r); setFormOpen(true); } : undefined} onDelete={isAdmin ? (r) => { setSelected(r); setDeleteOpen(true); } : undefined} searchPlaceholder="Search teachers..." emptyMessage="No teachers added yet" />
      <FormDialog open={formOpen} onClose={setFormOpen} title={formData.id ? 'Edit Teacher' : 'Add Teacher'} fields={fields} data={formData} onChange={setFormData} onSave={() => saveMutation.mutate(formData)} saving={saveMutation.isPending} />
      <DeleteDialog open={deleteOpen} onClose={setDeleteOpen} onConfirm={() => deleteMutation.mutate(selected?.id)} />
    </div>
  );
}