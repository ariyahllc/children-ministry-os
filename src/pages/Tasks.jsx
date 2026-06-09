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

export default function Tasks() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [selected, setSelected] = useState(null);
  const queryClient = useQueryClient();
  const { role } = useCurrentUser();
  const canEdit = role === 'admin' || role === 'teacher' || role === 'volunteer';

  const { data: tasks = [], isLoading } = useQuery({ queryKey: ['tasks'], queryFn: () => base44.entities.Task.list('-created_date') });

  const saveMutation = useMutation({
    mutationFn: (data) => data.id ? base44.entities.Task.update(data.id, data) : base44.entities.Task.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tasks'] }); setFormOpen(false); }
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Task.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tasks'] }); setDeleteOpen(false); }
  });

  const statusColors = {
    Pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    'In Progress': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    Completed: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    Overdue: 'bg-destructive/10 text-destructive border-destructive/20',
  };
  const priorityColors = {
    Low: 'bg-muted text-muted-foreground',
    Medium: 'bg-amber-500/10 text-amber-600',
    High: 'bg-orange-500/10 text-orange-600',
    Urgent: 'bg-destructive/10 text-destructive',
  };

  const columns = [
    { header: 'Task', accessor: 'title', render: row => <span className="font-medium">{row.title}</span> },
    { header: 'Owner', accessor: 'owner' },
    { header: 'Due Date', accessor: 'due_date', render: row => row.due_date ? format(new Date(row.due_date), 'MMM d, yyyy') : '—' },
    { header: 'Priority', accessor: 'priority', render: row => (
      <Badge variant="outline" className={priorityColors[row.priority] || ''}>{row.priority || 'Medium'}</Badge>
    )},
    { header: 'Status', accessor: 'status', render: row => (
      <Badge variant="outline" className={statusColors[row.status] || statusColors.Pending}>{row.status || 'Pending'}</Badge>
    )},
  ];

  const fields = [
    { name: 'title', label: 'Task Title', placeholder: 'What needs to be done?' },
    { name: 'owner', label: 'Assigned To', placeholder: 'Person responsible' },
    { name: 'due_date', label: 'Due Date', type: 'date' },
    { name: 'priority', label: 'Priority', type: 'select', options: [
      { value: 'Low', label: 'Low' }, { value: 'Medium', label: 'Medium' },
      { value: 'High', label: 'High' }, { value: 'Urgent', label: 'Urgent' }
    ]},
    { name: 'status', label: 'Status', type: 'select', options: [
      { value: 'Pending', label: 'Pending' }, { value: 'In Progress', label: 'In Progress' },
      { value: 'Completed', label: 'Completed' }, { value: 'Overdue', label: 'Overdue' }
    ]},
    { name: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional details' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Tasks" subtitle={`${tasks.length} tasks`} action={canEdit ? () => { setFormData({ status: 'Pending', priority: 'Medium' }); setFormOpen(true); } : undefined} actionLabel="Add Task" />
      <DataTable columns={columns} data={tasks} isLoading={isLoading} onEdit={canEdit ? (r) => { setFormData(r); setFormOpen(true); } : undefined} onDelete={role === 'admin' ? (r) => { setSelected(r); setDeleteOpen(true); } : undefined} searchPlaceholder="Search tasks..." emptyMessage="No tasks yet" />
      <FormDialog open={formOpen} onClose={setFormOpen} title={formData.id ? 'Edit Task' : 'Add Task'} fields={fields} data={formData} onChange={setFormData} onSave={() => saveMutation.mutate(formData)} saving={saveMutation.isPending} />
      <DeleteDialog open={deleteOpen} onClose={setDeleteOpen} onConfirm={() => deleteMutation.mutate(selected?.id)} />
    </div>
  );
}