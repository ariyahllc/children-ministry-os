import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { format } from 'date-fns';
import { CheckCircle, XCircle, Save, CalendarDays } from 'lucide-react';
import { motion } from 'framer-motion';
import PageHeader from '@/components/shared/PageHeader';
import DataTable from '@/components/shared/DataTable';
import { useCurrentUser } from '@/lib/useCurrentUser';

export default function AttendancePage() {
  const [mode, setMode] = useState('view'); // 'view' or 'take'
  const [selectedClass, setSelectedClass] = useState('all');
  const [attendanceDate, setAttendanceDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [marks, setMarks] = useState({});
  const queryClient = useQueryClient();
  const { role } = useCurrentUser();
  const canEdit = role === 'admin' || role === 'teacher';

  const { data: attendance = [], isLoading } = useQuery({ queryKey: ['attendance'], queryFn: () => base44.entities.Attendance.list('-date', 200) });
  const { data: children = [] } = useQuery({ queryKey: ['children'], queryFn: () => base44.entities.Child.list() });
  const { data: classes = [] } = useQuery({ queryKey: ['classes'], queryFn: () => base44.entities.MinistryClass.list() });

  const activeChildren = children.filter(c => c.status === 'Active');
  const classChildren = selectedClass === 'all' ? activeChildren : activeChildren.filter(c => c.class_id === selectedClass);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const records = classChildren.map(child => ({
        child_id: child.id,
        child_name: `${child.first_name} ${child.last_name}`,
        class_id: child.class_id || '',
        date: attendanceDate,
        present: marks[child.id] || false,
      }));
      await base44.entities.Attendance.bulkCreate(records);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
      setMode('view');
      setMarks({});
    }
  });

  const className_ = (id) => classes.find(c => c.id === id)?.name || '—';

  const columns = [
    { header: 'Child', accessor: 'child_name', render: row => <span className="font-medium">{row.child_name}</span> },
    { header: 'Date', accessor: 'date', render: row => row.date ? format(new Date(row.date), 'MMM d, yyyy') : '—' },
    { header: 'Class', accessor: 'class_id', render: row => className_(row.class_id) },
    { header: 'Status', accessor: 'present', render: row => (
      <Badge variant="outline" className={row.present ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-destructive/10 text-destructive border-destructive/20'}>
        {row.present ? 'Present' : 'Absent'}
      </Badge>
    )},
    { header: 'Notes', accessor: 'notes' },
  ];

  if (mode === 'take') {
    return (
      <div className="space-y-6">
        <PageHeader title="Take Attendance" subtitle={format(new Date(attendanceDate), 'MMMM d, yyyy')} />
        <Card className="p-6 border-0 shadow-sm">
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <Input type="date" value={attendanceDate} onChange={e => setAttendanceDate(e.target.value)} className="w-auto" />
            <Select value={selectedClass} onValueChange={setSelectedClass}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="All classes" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {classes.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            {classChildren.map((child, i) => (
              <motion.div key={child.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.02 }}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
                    {child.first_name[0]}{child.last_name[0]}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{child.first_name} {child.last_name}</p>
                    <p className="text-xs text-muted-foreground">{className_(child.class_id)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {marks[child.id] ? (
                    <CheckCircle className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <XCircle className="w-4 h-4 text-muted-foreground" />
                  )}
                  <Switch checked={marks[child.id] || false} onCheckedChange={val => setMarks(prev => ({ ...prev, [child.id]: val }))} />
                </div>
              </motion.div>
            ))}
            {classChildren.length === 0 && <p className="text-center text-muted-foreground py-8">No children in selected class</p>}
          </div>
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
            <Button variant="outline" onClick={() => setMode('view')}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              <Save className="w-4 h-4 mr-2" />{saveMutation.isPending ? 'Saving...' : 'Save Attendance'}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        subtitle={`${attendance.length} records`}
        action={canEdit ? () => setMode('take') : undefined}
        actionLabel="Take Attendance"
        actionIcon={CalendarDays}
      />
      <DataTable columns={columns} data={attendance} isLoading={isLoading} searchPlaceholder="Search attendance..." emptyMessage="No attendance records yet" />
    </div>
  );
}