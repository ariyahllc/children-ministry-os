import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/shared/PageHeader';
import DataTable from '@/components/shared/DataTable';
import FormDialog from '@/components/shared/FormDialog';
import DeleteDialog from '@/components/shared/DeleteDialog';
import { useCurrentUser } from '@/lib/useCurrentUser';

export default function Parents() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [selected, setSelected] = useState(null);
  const queryClient = useQueryClient();
  const { role } = useCurrentUser();
  const isAdmin = role === 'admin';

  const { data: parents = [], isLoading } = useQuery({ queryKey: ['parents'], queryFn: () => base44.entities.Parent.list() });

  const saveMutation = useMutation({
    mutationFn: (data) => data.id ? base44.entities.Parent.update(data.id, data) : base44.entities.Parent.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['parents'] }); setFormOpen(false); }
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Parent.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['parents'] }); setDeleteOpen(false); }
  });

  const columns = [
    { header: 'Name', accessor: 'name', render: row => <span className="font-medium">{row.name}</span> },
    { header: 'Email', accessor: 'email' },
    { header: 'Phone', accessor: 'phone' },
    { header: 'Relationship', accessor: 'relationship' },
    { header: 'Emergency Contact', accessor: 'emergency_contact' },
  ];

  const fields = [
    { name: 'name', label: 'Full Name', placeholder: 'Enter full name' },
    { name: 'email', label: 'Email', type: 'email', placeholder: 'Email address' },
    { name: 'phone', label: 'Phone', placeholder: 'Phone number' },
    { name: 'address', label: 'Address', type: 'textarea', placeholder: 'Home address' },
    { name: 'emergency_contact', label: 'Emergency Contact', placeholder: 'Emergency contact info' },
    { name: 'relationship', label: 'Relationship', type: 'select', options: [
      { value: 'Mother', label: 'Mother' }, { value: 'Father', label: 'Father' },
      { value: 'Guardian', label: 'Guardian' }, { value: 'Grandparent', label: 'Grandparent' },
      { value: 'Other', label: 'Other' }
    ]},
    { name: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Parents" subtitle={`${parents.length} parents registered`} action={isAdmin ? () => { setFormData({}); setFormOpen(true); } : undefined} actionLabel="Add Parent" />
      <DataTable columns={columns} data={parents} isLoading={isLoading} onEdit={isAdmin ? (r) => { setFormData(r); setFormOpen(true); } : undefined} onDelete={isAdmin ? (r) => { setSelected(r); setDeleteOpen(true); } : undefined} searchPlaceholder="Search parents..." emptyMessage="No parents registered yet" />
      <FormDialog open={formOpen} onClose={setFormOpen} title={formData.id ? 'Edit Parent' : 'Add Parent'} fields={fields} data={formData} onChange={setFormData} onSave={() => saveMutation.mutate(formData)} saving={saveMutation.isPending} />
      <DeleteDialog open={deleteOpen} onClose={setDeleteOpen} onConfirm={() => deleteMutation.mutate(selected?.id)} />
    </div>
  );
}