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
import { MessageSquare } from 'lucide-react';

export default function Communications() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [selected, setSelected] = useState(null);
  const queryClient = useQueryClient();
  const { role } = useCurrentUser();
  const isAdmin = role === 'admin';

  const { data: comms = [], isLoading } = useQuery({ queryKey: ['communications'], queryFn: () => base44.entities.Communication.list('-created_date') });

  const saveMutation = useMutation({
    mutationFn: (data) => data.id ? base44.entities.Communication.update(data.id, data) : base44.entities.Communication.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['communications'] }); setFormOpen(false); }
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Communication.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['communications'] }); setDeleteOpen(false); }
  });

  const statusColors = {
    Draft: 'bg-muted text-muted-foreground',
    Sent: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    Scheduled: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  };

  const columns = [
    { header: 'Subject', accessor: 'subject', render: row => <span className="font-medium">{row.subject}</span> },
    { header: 'Type', accessor: 'type' },
    { header: 'Audience', accessor: 'audience' },
    { header: 'Date', accessor: 'date', render: row => row.date ? format(new Date(row.date), 'MMM d, yyyy') : '—' },
    { header: 'Status', accessor: 'status', render: row => (
      <Badge variant="outline" className={statusColors[row.status] || statusColors.Draft}>{row.status || 'Draft'}</Badge>
    )},
  ];

  const fields = [
    { name: 'subject', label: 'Subject', placeholder: 'Message subject' },
    { name: 'type', label: 'Type', type: 'select', options: [
      { value: 'Parent Email', label: 'Parent Email' }, { value: 'WhatsApp Message', label: 'WhatsApp Message' },
      { value: 'Teacher Update', label: 'Teacher Update' }, { value: 'Board Update', label: 'Board Update' }
    ]},
    { name: 'audience', label: 'Audience', placeholder: 'Target audience' },
    { name: 'content', label: 'Content', type: 'textarea', placeholder: 'Message content' },
    { name: 'date', label: 'Date', type: 'date' },
    { name: 'status', label: 'Status', type: 'select', options: [
      { value: 'Draft', label: 'Draft' }, { value: 'Sent', label: 'Sent' }, { value: 'Scheduled', label: 'Scheduled' }
    ]},
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Communications" subtitle={`${comms.length} messages`} action={isAdmin ? () => { setFormData({ status: 'Draft' }); setFormOpen(true); } : undefined} actionLabel="New Message" actionIcon={MessageSquare} />
      <DataTable columns={columns} data={comms} isLoading={isLoading} onEdit={isAdmin ? (r) => { setFormData(r); setFormOpen(true); } : undefined} onDelete={isAdmin ? (r) => { setSelected(r); setDeleteOpen(true); } : undefined} searchPlaceholder="Search communications..." emptyMessage="No communications yet" />
      <FormDialog open={formOpen} onClose={setFormOpen} title={formData.id ? 'Edit Message' : 'New Message'} fields={fields} data={formData} onChange={setFormData} onSave={() => saveMutation.mutate(formData)} saving={saveMutation.isPending} />
      <DeleteDialog open={deleteOpen} onClose={setDeleteOpen} onConfirm={() => deleteMutation.mutate(selected?.id)} />
    </div>
  );
}