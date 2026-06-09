import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import PageHeader from '@/components/shared/PageHeader';
import DataTable from '@/components/shared/DataTable';
import FormDialog from '@/components/shared/FormDialog';
import DeleteDialog from '@/components/shared/DeleteDialog';
import { useCurrentUser } from '@/lib/useCurrentUser';

export default function Children() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [selected, setSelected] = useState(null);
  const queryClient = useQueryClient();
  const { role } = useCurrentUser();
  const isAdmin = role === 'admin';

  const { data: children = [], isLoading } = useQuery({ queryKey: ['children'], queryFn: () => base44.entities.Child.list() });
  const { data: parents = [] } = useQuery({ queryKey: ['parents'], queryFn: () => base44.entities.Parent.list() });
  const { data: classes = [] } = useQuery({ queryKey: ['classes'], queryFn: () => base44.entities.MinistryClass.list() });

  const saveMutation = useMutation({
    mutationFn: (data) => data.id ? base44.entities.Child.update(data.id, data) : base44.entities.Child.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['children'] }); setFormOpen(false); }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Child.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['children'] }); setDeleteOpen(false); }
  });

  const parentName = (id) => parents.find(p => p.id === id)?.name || '—';
  const className_ = (id) => classes.find(c => c.id === id)?.name || '—';

  const columns = [
    { header: 'Name', accessor: 'first_name', render: row => <span className="font-medium">{row.first_name} {row.last_name}</span> },
    { header: 'Age', accessor: 'date_of_birth', render: row => row.date_of_birth ? `${Math.floor((Date.now() - new Date(row.date_of_birth)) / 31557600000)}y` : '—' },
    { header: 'Gender', accessor: 'gender' },
    { header: 'Class', accessor: 'class_id', render: row => className_(row.class_id) },
    { header: 'Parent', accessor: 'parent_id', render: row => parentName(row.parent_id) },
    { header: 'Status', accessor: 'status', render: row => (
      <Badge variant="outline" className={row.status === 'Active' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-muted text-muted-foreground'}>
        {row.status || 'Active'}
      </Badge>
    )}
  ];

  const fields = [
    { name: 'first_name', label: 'First Name', placeholder: 'Enter first name' },
    { name: 'last_name', label: 'Last Name', placeholder: 'Enter last name' },
    { name: 'date_of_birth', label: 'Date of Birth', type: 'date' },
    { name: 'gender', label: 'Gender', type: 'select', options: [{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }] },
    { name: 'class_id', label: 'Class', type: 'select', options: classes.map(c => ({ value: c.id, label: c.name })) },
    { name: 'parent_id', label: 'Parent', type: 'select', options: parents.map(p => ({ value: p.id, label: p.name })) },
    { name: 'allergies', label: 'Allergies', placeholder: 'Known allergies' },
    { name: 'medical_notes', label: 'Medical Notes', type: 'textarea', placeholder: 'Any medical information' },
    { name: 'photo_consent', label: 'Photo Consent', type: 'switch' },
    { name: 'status', label: 'Status', type: 'select', options: [{ value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }] },
    { name: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes' },
  ];

  const handleNew = () => { setFormData({ status: 'Active' }); setFormOpen(true); };
  const handleEdit = (row) => { setFormData(row); setFormOpen(true); };
  const handleDelete = (row) => { setSelected(row); setDeleteOpen(true); };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Children"
        subtitle={`${children.length} children registered`}
        action={isAdmin ? handleNew : undefined}
        actionLabel="Add Child"
      />
      <DataTable
        columns={columns}
        data={children}
        isLoading={isLoading}
        onEdit={isAdmin ? handleEdit : undefined}
        onDelete={isAdmin ? handleDelete : undefined}
        searchPlaceholder="Search children..."
        emptyMessage="No children registered yet"
      />
      <FormDialog
        open={formOpen}
        onClose={setFormOpen}
        title={formData.id ? 'Edit Child' : 'Add Child'}
        fields={fields}
        data={formData}
        onChange={setFormData}
        onSave={() => saveMutation.mutate(formData)}
        saving={saveMutation.isPending}
      />
      <DeleteDialog
        open={deleteOpen}
        onClose={setDeleteOpen}
        onConfirm={() => deleteMutation.mutate(selected?.id)}
      />
    </div>
  );
}