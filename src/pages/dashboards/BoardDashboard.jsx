import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Users, TrendingUp, Calendar, UserCheck, BookOpen } from 'lucide-react';
import { format } from 'date-fns';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { motion } from 'framer-motion';
import StatCard from '@/components/shared/StatCard';

export default function BoardDashboard() {
  const { data: children = [] } = useQuery({ queryKey: ['children'], queryFn: () => base44.entities.Child.list() });
  const { data: events = [] } = useQuery({ queryKey: ['events'], queryFn: () => base44.entities.Event.list() });
  const { data: volunteers = [] } = useQuery({ queryKey: ['volunteers'], queryFn: () => base44.entities.Volunteer.list() });
  const { data: attendance = [] } = useQuery({ queryKey: ['attendance'], queryFn: () => base44.entities.Attendance.list('-date', 100) });
  const { data: curriculum = [] } = useQuery({ queryKey: ['curriculum'], queryFn: () => base44.entities.Curriculum.list() });

  const activeChildren = children.filter(c => c.status === 'Active').length;
  const completedEvents = events.filter(e => e.status === 'Completed').length;
  const clearedVols = volunteers.filter(v => v.background_check === 'Cleared').length;

  // Attendance trend
  const attendanceByDate = {};
  attendance.forEach(a => {
    if (!a.date) return;
    if (!attendanceByDate[a.date]) attendanceByDate[a.date] = { date: a.date, present: 0, total: 0 };
    attendanceByDate[a.date].total++;
    if (a.present) attendanceByDate[a.date].present++;
  });
  const trendData = Object.values(attendanceByDate)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-10)
    .map(d => ({ ...d, label: format(new Date(d.date), 'MMM d'), rate: d.total ? Math.round((d.present / d.total) * 100) : 0 }));

  // Curriculum by category
  const catMap = {};
  curriculum.forEach(c => { catMap[c.category] = (catMap[c.category] || 0) + 1; });
  const curriculumData = Object.entries(catMap).map(([name, count]) => ({ name, count }));

  const COLORS = ['hsl(245,58%,51%)', 'hsl(30,85%,56%)', 'hsl(160,60%,45%)', 'hsl(340,65%,55%)', 'hsl(200,70%,50%)'];

  return (
    <div className="space-y-6">
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700">
        <strong>Board Representative View</strong> — Read-only aggregated ministry metrics. Individual records are not accessible from this view.
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Active Children" value={activeChildren} icon={Users} color="indigo" index={0} />
        <StatCard title="Completed Events" value={completedEvents} icon={Calendar} color="green" index={1} />
        <StatCard title="Cleared Volunteers" value={clearedVols} icon={UserCheck} color="orange" index={2} />
        <StatCard title="Curriculum Units" value={curriculum.length} icon={BookOpen} color="purple" index={3} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="p-6 border-0 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-semibold text-lg">Attendance Rate Trends</h3>
              <TrendingUp className="w-5 h-5 text-primary" />
            </div>
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="gradRate" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(245, 58%, 51%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(245, 58%, 51%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 100]} unit="%" />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Area type="monotone" dataKey="rate" stroke="hsl(245, 58%, 51%)" fillOpacity={1} fill="url(#gradRate)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">No data yet</div>
            )}
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="p-6 border-0 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-semibold text-lg">Curriculum Coverage</h3>
              <BookOpen className="w-5 h-5 text-primary" />
            </div>
            {curriculumData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={curriculumData}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {curriculumData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground text-sm">No curriculum data</div>
            )}
          </Card>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
        <Card className="p-6 border-0 shadow-sm">
          <h3 className="font-heading font-semibold text-lg mb-4">Event Participation</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {['Planning', 'Upcoming', 'Completed', 'Cancelled'].map(status => (
              <div key={status} className="p-4 rounded-lg bg-muted/30 text-center">
                <p className="text-2xl font-bold">{events.filter(e => e.status === status).length}</p>
                <p className="text-xs text-muted-foreground mt-1">{status}</p>
              </div>
            ))}
          </div>
        </Card>
      </motion.div>
    </div>
  );
}