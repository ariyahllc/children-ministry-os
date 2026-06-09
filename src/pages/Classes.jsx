import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import PageHeader from '@/components/shared/PageHeader';
import DataTable from '@/components/shared/DataTable';
import FormDialog from '@/components/shared/FormDialog';
import DeleteDialog from '@/components/shared/DeleteDialog';
import { useCurrentUser } from '@/lib/useCurrentUser';

export default function Classes() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [selected, setSelected] = useState(null);
  const queryClient = useQueryClient();
  const { role } = useCurrentUser();
  const isAdmin = role === 'admin';

  const { data: classes = [], isLoading } = useQuery({ queryKey: ['classes'], queryFn: () => base44.entities.MinistryClass.list() });
  const { data: teachers = [] } = useQuery({ queryKey: ['teachers'], queryFn: () => base44.entities.Teacher.list() });
  const { data: children = [] } = useQuery({ queryKey: ['children'], queryFn: () => base44.entities.Child.list() });

  const saveMutation = useMutation({
    mutationFn: (data) => data.id ? base44.entities.MinistryClass.update(data.id, data) : base44.entities.MinistryClass.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['classes'] }); setFormOpen(false); }
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.MinistryClass.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['classes'] }); setDeleteOpen(false); }
  });

  const teacherName = (id) => teachers.find(t => t.id === id)?.name || '—';
  const childCount = (classId) => children.filter(c => c.class_id === classId).length;

  const columns = [
    { header: 'Name', accessor: 'name', render: row => <span className="font-medium">{row.name}</span> },
    { header: 'Age Range', accessor: 'age_range' },
    { header: 'Teacher', accessor: 'teacher_id', render: row => teacherName(row.teacher_id) },
    { header: 'Enrolled', accessor: 'id', render: row => `${childCount(row.id)}${row.capacity ? ` / ${row.capacity}` : ''}` },
    { header: 'Notes', accessor: 'notes', render: row => <span className="text-muted-foreground truncate block max-w-[200px]">{row.notes || '—'}</span> },
  ];

  const fields = [
    { name: 'name', label: 'Class Name', placeholder: 'e.g., Toddlers, Pre-K' },
    { name: 'age_range', label: 'Age Range', placeholder: 'e.g., 3-5 years' },
    { name: 'teacher_id', label: 'Teacher', type: 'select', options: teachers.map(t => ({ value: t.id, label: t.name })) },
    { name: 'capacity', label: 'Capacity', type: 'number', placeholder: 'Max children' },
    { name: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Classes" subtitle={`${classes.length} classes`} action={isAdmin ? () => { setFormData({}); setFormOpen(true); } : undefined} actionLabel="Add Class" />
      <DataTable columns={columns} data={classes} isLoading={isLoading} onEdit={isAdmin ? (r) => { setFormData(r); setFormOpen(true); } : undefined} onDelete={isAdmin ? (r) => { setSelected(r); setDeleteOpen(true); } : undefined} searchPlaceholder="Search classes..." emptyMessage="No classes created yet" />
      <FormDialog open={formOpen} onClose={setFormOpen} title={formData.id ? 'Edit Class' : 'Add Class'} fields={fields} data={formData} onChange={setFormData} onSave={() => saveMutation.mutate(formData)} saving={saveMutation.isPending} />
      <DeleteDialog open={deleteOpen} onClose={setDeleteOpen} onConfirm={() => deleteMutation.mutate(selected?.id)} />
    </div>
  );
}