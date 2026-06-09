import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { Upload, FileText, Download, ExternalLink } from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';
import DataTable from '@/components/shared/DataTable';
import FormDialog from '@/components/shared/FormDialog';
import DeleteDialog from '@/components/shared/DeleteDialog';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { useToast } from '@/components/ui/use-toast';

export default function Documents() {
  const [formOpen, setFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [formData, setFormData] = useState({});
  const [selected, setSelected] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const queryClient = useQueryClient();
  const { role } = useCurrentUser();
  const isAdmin = role === 'admin';
  const { toast } = useToast();

  const { data: documents = [], isLoading } = useQuery({ queryKey: ['documents'], queryFn: () => base44.entities.Document.list('-created_date') });

  const saveMutation = useMutation({
    mutationFn: (data) => data.id ? base44.entities.Document.update(data.id, data) : base44.entities.Document.create(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['documents'] }); setFormOpen(false); }
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.Document.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['documents'] }); setDeleteOpen(false); }
  });

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    setFormData(prev => ({ ...prev, file_url }));
    setUploading(false);
    toast({ title: 'File uploaded', description: file.name });
  };

  const catColors = {
    Registration: 'bg-blue-500/10 text-blue-600',
    Curriculum: 'bg-emerald-500/10 text-emerald-600',
    'Board Reports': 'bg-purple-500/10 text-purple-600',
    Events: 'bg-amber-500/10 text-amber-600',
    Communications: 'bg-rose-500/10 text-rose-600',
  };

  const columns = [
    { header: 'Title', accessor: 'title', render: row => (
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-muted-foreground" />
        <span className="font-medium">{row.title}</span>
      </div>
    )},
    { header: 'Category', accessor: 'category', render: row => (
      <Badge variant="outline" className={catColors[row.category] || ''}>{row.category || '—'}</Badge>
    )},
    { header: 'Tags', accessor: 'tags', render: row => row.tags || '—' },
    { header: 'Date', accessor: 'created_date', render: row => row.created_date ? format(new Date(row.created_date), 'MMM d, yyyy') : '—' },
    { header: 'File', accessor: 'file_url', render: row => row.file_url ? (
      <a href={row.file_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1" onClick={e => e.stopPropagation()}>
        <ExternalLink className="w-3 h-3" />View
      </a>
    ) : '—' },
  ];

  const fields = [
    { name: 'title', label: 'Title', placeholder: 'Document title' },
    { name: 'category', label: 'Category', type: 'select', options: [
      { value: 'Registration', label: 'Registration' }, { value: 'Curriculum', label: 'Curriculum' },
      { value: 'Board Reports', label: 'Board Reports' }, { value: 'Events', label: 'Events' },
      { value: 'Communications', label: 'Communications' }
    ]},
    { name: 'tags', label: 'Tags', placeholder: 'Comma-separated tags' },
    { name: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes' },
  ];

  const handleOpen = () => {
    setFormData({});
    setFormOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Documents" subtitle={`${documents.length} documents`} action={isAdmin ? handleOpen : undefined} actionLabel="Add Document" actionIcon={Upload} />
      <DataTable columns={columns} data={documents} isLoading={isLoading} onEdit={isAdmin ? (r) => { setFormData(r); setFormOpen(true); } : undefined} onDelete={isAdmin ? (r) => { setSelected(r); setDeleteOpen(true); } : undefined} searchPlaceholder="Search documents..." emptyMessage="No documents uploaded yet" />
      <FormDialog open={formOpen} onClose={setFormOpen} title={formData.id ? 'Edit Document' : 'Add Document'} fields={fields} data={formData} onChange={setFormData}
        onSave={() => saveMutation.mutate(formData)} saving={saveMutation.isPending}>
      </FormDialog>
      {formOpen && (
        <div className="fixed bottom-24 right-8 z-50">
          <input ref={fileRef} type="file" className="hidden" onChange={handleFileUpload} />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Upload className="w-4 h-4 mr-2" />{uploading ? 'Uploading...' : 'Upload File'}
          </Button>
        </div>
      )}
      <DeleteDialog open={deleteOpen} onClose={setDeleteOpen} onConfirm={() => deleteMutation.mutate(selected?.id)} />
    </div>
  );
}