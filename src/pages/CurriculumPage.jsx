import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import PageHeader from '@/components/shared/PageHeader';
import DataTable from '@/components/shared/DataTable';
import FormDialog from '@/components/shared/FormDialog';
import DeleteDialog from '@/components/shared/DeleteDialog';
import { useCurrentUser } from '@/lib/useCurrentUser';

export default function CurriculumPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [selected, setSelected] = useState(null);
  const queryClient = useQueryClient();
  const { role } = useCurrentUser();
  const isAdmin = role === 'admin';

  const { data: curriculum = [], isLoading } = useQuery({ queryKey: ['curriculum'], queryFn: () => base44.entities.Curriculum.list() });

  const saveMutation = useMutation({
    mutationFn: (data) => data.id ? base44.entities.Curriculum.update(data.id, data) : base44.entities.Curriculum.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['curriculum'] }); setFormOpen(false); }
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Curriculum.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['curriculum'] }); setDeleteOpen(false); }
  });

  const semesterColors = {
    Spring: 'bg-emerald-500/10 text-emerald-600',
    Summer: 'bg-amber-500/10 text-amber-600',
    Fall: 'bg-orange-500/10 text-orange-600',
    Winter: 'bg-blue-500/10 text-blue-600',
  };

  const columns = [
    { header: 'Title', accessor: 'title', render: row => <span className="font-medium">{row.title}</span> },
    { header: 'Lesson #', accessor: 'lesson_number' },
    { header: 'Semester', accessor: 'semester', render: row => (
      <Badge variant="outline" className={semesterColors[row.semester] || ''}>{row.semester || '—'}</Badge>
    )},
    { header: 'Category', accessor: 'category' },
    { header: 'Scripture', accessor: 'scripture' },
  ];

  const fields = [
    { name: 'title', label: 'Title', placeholder: 'Lesson title' },
    { name: 'lesson_number', label: 'Lesson Number', type: 'number', placeholder: 'e.g., 1' },
    { name: 'semester', label: 'Semester', type: 'select', options: [
      { value: 'Spring', label: 'Spring' }, { value: 'Summer', label: 'Summer' },
      { value: 'Fall', label: 'Fall' }, { value: 'Winter', label: 'Winter' }
    ]},
    { name: 'category', label: 'Category', type: 'select', options: [
      { value: 'Bible Study', label: 'Bible Study' }, { value: 'Worship', label: 'Worship' },
      { value: 'Crafts', label: 'Crafts' }, { value: 'Games', label: 'Games' },
      { value: 'Memory Verse', label: 'Memory Verse' }, { value: 'Other', label: 'Other' }
    ]},
    { name: 'scripture', label: 'Scripture Reference', placeholder: 'e.g., John 3:16' },
    { name: 'teacher_notes', label: 'Teacher Notes', type: 'textarea', placeholder: 'Notes for the teacher' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Curriculum" subtitle={`${curriculum.length} lessons`} action={isAdmin ? () => { setFormData({}); setFormOpen(true); } : undefined} actionLabel="Add Lesson" />
      <DataTable columns={columns} data={curriculum} isLoading={isLoading} onEdit={isAdmin ? (r) => { setFormData(r); setFormOpen(true); } : undefined} onDelete={isAdmin ? (r) => { setSelected(r); setDeleteOpen(true); } : undefined} searchPlaceholder="Search curriculum..." emptyMessage="No lessons added yet" />
      <FormDialog open={formOpen} onClose={setFormOpen} title={formData.id ? 'Edit Lesson' : 'Add Lesson'} fields={fields} data={formData} onChange={setFormData} onSave={() => saveMutation.mutate(formData)} saving={saveMutation.isPending} />
      <DeleteDialog open={deleteOpen} onClose={setDeleteOpen} onConfirm={() => deleteMutation.mutate(selected?.id)} />
    </div>
  );
}