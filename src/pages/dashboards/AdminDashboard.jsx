import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, GraduationCap, UserCheck, Calendar, CheckSquare, FileText, TrendingUp, Clock, Heart } from 'lucide-react';
import { format } from 'date-fns';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import StatCard from '@/components/shared/StatCard';
import { Link } from 'react-router-dom';

export default function AdminDashboard() {
  const { data: children = [] } = useQuery({ queryKey: ['children'], queryFn: () => base44.entities.Child.list() });
  const { data: parents = [] } = useQuery({ queryKey: ['parents'], queryFn: () => base44.entities.Parent.list() });
  const { data: teachers = [] } = useQuery({ queryKey: ['teachers'], queryFn: () => base44.entities.Teacher.list() });
  const { data: volunteers = [] } = useQuery({ queryKey: ['volunteers'], queryFn: () => base44.entities.Volunteer.list() });
  const { data: events = [] } = useQuery({ queryKey: ['events'], queryFn: () => base44.entities.Event.list('-date', 50) });
  const { data: tasks = [] } = useQuery({ queryKey: ['tasks'], queryFn: () => base44.entities.Task.list() });
  const { data: attendance = [] } = useQuery({ queryKey: ['attendance'], queryFn: () => base44.entities.Attendance.list('-date', 100) });
  const { data: documents = [] } = useQuery({ queryKey: ['documents'], queryFn: () => base44.entities.Document.list('-created_date', 5) });

  const activeChildren = children.filter(c => c.status === 'Active').length;
  const activeTeachers = teachers.filter(t => t.active !== false).length;
  const upcomingEvents = events.filter(e => new Date(e.date) >= new Date() && e.status !== 'Cancelled');
  const pendingTasks = tasks.filter(t => t.status === 'Pending' || t.status === 'In Progress');

  const attendanceByDate = {};
  attendance.forEach(a => {
    if (!a.date) return;
    if (!attendanceByDate[a.date]) attendanceByDate[a.date] = { date: a.date, present: 0, absent: 0 };
    if (a.present) attendanceByDate[a.date].present++;
    else attendanceByDate[a.date].absent++;
  });
  const trendData = Object.values(attendanceByDate)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-12)
    .map(d => ({ ...d, label: format(new Date(d.date), 'MMM d') }));

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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Active Children" value={activeChildren} icon={Users} color="indigo" subtitle={`${children.length} total`} index={0} />
        <StatCard title="Families" value={parents.length} icon={Heart} color="purple" index={1} />
        <StatCard title="Teachers" value={activeTeachers} icon={GraduationCap} color="green" index={2} />
        <StatCard title="Volunteers" value={volunteers.length} icon={UserCheck} color="orange" index={3} />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="lg:col-span-2">
          <Card className="p-6 border-0 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-heading font-semibold text-lg">Attendance Trends</h3>
                <p className="text-xs text-muted-foreground">Recent attendance data</p>
              </div>
              <TrendingUp className="w-5 h-5 text-primary" />
            </div>
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="gradPresent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(245, 58%, 51%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(245, 58%, 51%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Area type="monotone" dataKey="present" stroke="hsl(245, 58%, 51%)" fillOpacity={1} fill="url(#gradPresent)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[220px] text-muted-foreground text-sm">No attendance data yet</div>
            )}
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="p-6 border-0 shadow-sm h-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-semibold text-lg">Upcoming Events</h3>
              <Link to="/events" className="text-xs text-primary hover:underline">View all</Link>
            </div>
            <div className="space-y-3">
              {upcomingEvents.slice(0, 5).map(event => (
                <div key={event.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{event.name}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(event.date), 'MMM d, yyyy')}</p>
                  </div>
                </div>
              ))}
              {upcomingEvents.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No upcoming events</p>}
            </div>
          </Card>
        </motion.div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="p-6 border-0 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-semibold text-lg">Pending Tasks</h3>
              <Link to="/tasks" className="text-xs text-primary hover:underline">View all</Link>
            </div>
            <div className="space-y-2">
              {pendingTasks.slice(0, 5).map(task => (
                <div key={task.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/30">
                  <div className="flex items-center gap-3 min-w-0">
                    <CheckSquare className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{task.title}</p>
                      {task.due_date && <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" />{format(new Date(task.due_date), 'MMM d')}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-[10px] ${priorityColors[task.priority] || ''}`}>{task.priority}</Badge>
                    <Badge variant="outline" className={`text-[10px] ${statusColors[task.status] || ''}`}>{task.status}</Badge>
                  </div>
                </div>
              ))}
              {pendingTasks.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">All caught up!</p>}
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <Card className="p-6 border-0 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-semibold text-lg">Recent Documents</h3>
              <Link to="/documents" className="text-xs text-primary hover:underline">View all</Link>
            </div>
            <div className="space-y-2">
              {documents.slice(0, 5).map(doc => (
                <div key={doc.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/30">
                  <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{doc.title}</p>
                    <p className="text-xs text-muted-foreground">{doc.category}</p>
                  </div>
                </div>
              ))}
              {documents.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No documents yet</p>}
            </div>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}