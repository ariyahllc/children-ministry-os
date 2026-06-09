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

export default function Events() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [selected, setSelected] = useState(null);
  const queryClient = useQueryClient();
  const { role } = useCurrentUser();
  const isAdmin = role === 'admin';

  const { data: events = [], isLoading } = useQuery({ queryKey: ['events'], queryFn: () => base44.entities.Event.list('-date') });

  const saveMutation = useMutation({
    mutationFn: (data) => data.id ? base44.entities.Event.update(data.id, data) : base44.entities.Event.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['events'] }); setFormOpen(false); }
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Event.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['events'] }); setDeleteOpen(false); }
  });

  const statusColors = {
    Planning: 'bg-muted text-muted-foreground',
    Upcoming: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    'In Progress': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    Completed: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    Cancelled: 'bg-destructive/10 text-destructive border-destructive/20',
  };

  const columns = [
    { header: 'Event', accessor: 'name', render: row => <span className="font-medium">{row.name}</span> },
    { header: 'Date', accessor: 'date', render: row => row.date ? format(new Date(row.date), 'MMM d, yyyy') : '—' },
    { header: 'Type', accessor: 'type' },
    { header: 'Budget', accessor: 'budget', render: row => row.budget ? `$${Number(row.budget).toLocaleString()}` : '—' },
    { header: 'Attendance', accessor: 'attendance_count', render: row => row.attendance_count || '—' },
    { header: 'Status', accessor: 'status', render: row => (
      <Badge variant="outline" className={statusColors[row.status] || statusColors.Planning}>{row.status || 'Planning'}</Badge>
    )},
  ];

  const fields = [
    { name: 'name', label: 'Event Name', placeholder: 'e.g., VBS 2025' },
    { name: 'date', label: 'Date', type: 'date' },
    { name: 'type', label: 'Type', type: 'select', options: [
      { value: 'VBS', label: 'VBS' }, { value: "Children's Sunday", label: "Children's Sunday" },
      { value: 'Offertory', label: 'Offertory' }, { value: 'Outreach', label: 'Outreach' },
      { value: 'Conference', label: 'Conference' }, { value: 'Special', label: 'Special' },
      { value: 'Other', label: 'Other' }
    ]},
    { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Event description' },
    { name: 'budget', label: 'Budget', type: 'number', placeholder: 'Budget amount' },
    { name: 'attendance_count', label: 'Attendance Count', type: 'number', placeholder: 'Number attended' },
    { name: 'status', label: 'Status', type: 'select', options: [
      { value: 'Planning', label: 'Planning' }, { value: 'Upcoming', label: 'Upcoming' },
      { value: 'In Progress', label: 'In Progress' }, { value: 'Completed', label: 'Completed' },
      { value: 'Cancelled', label: 'Cancelled' }
    ]},
    { name: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Events" subtitle={`${events.length} events`} action={isAdmin ? () => { setFormData({ status: 'Planning' }); setFormOpen(true); } : undefined} actionLabel="Add Event" />
      <DataTable columns={columns} data={events} isLoading={isLoading} onEdit={isAdmin ? (r) => { setFormData(r); setFormOpen(true); } : undefined} onDelete={isAdmin ? (r) => { setSelected(r); setDeleteOpen(true); } : undefined} searchPlaceholder="Search events..." emptyMessage="No events created yet" />
      <FormDialog open={formOpen} onClose={setFormOpen} title={formData.id ? 'Edit Event' : 'Add Event'} fields={fields} data={formData} onChange={setFormData} onSave={() => saveMutation.mutate(formData)} saving={saveMutation.isPending} />
      <DeleteDialog open={deleteOpen} onClose={setDeleteOpen} onConfirm={() => deleteMutation.mutate(selected?.id)} />
    </div>
  );
}