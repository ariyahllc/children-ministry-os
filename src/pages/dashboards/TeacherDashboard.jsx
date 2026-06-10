import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BookOpen, Users, Calendar, ClipboardList, MessageSquare } from 'lucide-react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import StatCard from '@/components/shared/StatCard';
import { useRole } from '@/lib/RoleContext';
import { Link } from 'react-router-dom';

export default function TeacherDashboard() {
  const { user } = useRole();
  const { data: classes = [] } = useQuery({ queryKey: ['classes'], queryFn: () => base44.entities.MinistryClass.list() });
  const { data: children = [] } = useQuery({ queryKey: ['children'], queryFn: () => base44.entities.Child.list() });
  const { data: attendance = [] } = useQuery({ queryKey: ['attendance'], queryFn: () => base44.entities.Attendance.list('-date', 100) });
  const { data: curriculum = [] } = useQuery({ queryKey: ['curriculum'], queryFn: () => base44.entities.Curriculum.list() });
  const { data: events = [] } = useQuery({ queryKey: ['events'], queryFn: () => base44.entities.Event.list('-date', 20) });
  const { data: communications = [] } = useQuery({ queryKey: ['communications'], queryFn: () => base44.entities.Communication.list('-date', 10) });

  const upcomingEvents = events.filter(e => new Date(e.date) >= new Date() && e.status !== 'Cancelled');
  const activeChildren = children.filter(c => c.status === 'Active').length;

  // Recent attendance summary
  const recentDates = [...new Set(attendance.map(a => a.date))].sort().reverse().slice(0, 4);
  const attendanceSummary = recentDates.map(date => {
    const records = attendance.filter(a => a.date === date);
    const present = records.filter(a => a.present).length;
    return { date, present, total: records.length };
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="My Classes" value={classes.length} icon={BookOpen} color="indigo" index={0} />
        <StatCard title="Children" value={activeChildren} icon={Users} color="green" index={1} />
        <StatCard title="Upcoming Events" value={upcomingEvents.length} icon={Calendar} color="orange" index={2} />
        <StatCard title="Lessons" value={curriculum.length} icon={ClipboardList} color="purple" index={3} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="p-6 border-0 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-semibold text-lg">My Classes</h3>
              <Link to="/classes" className="text-xs text-primary hover:underline">View all</Link>
            </div>
            <div className="space-y-3">
              {classes.map(cls => (
                <div key={cls.id} className="p-4 rounded-lg bg-muted/30 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{cls.name}</p>
                    <p className="text-xs text-muted-foreground">Ages {cls.age_range} · Capacity {cls.capacity}</p>
                  </div>
                  <Badge variant="outline" className="text-xs">{cls.active !== false ? 'Active' : 'Inactive'}</Badge>
                </div>
              ))}
              {classes.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No classes assigned yet</p>}
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="p-6 border-0 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-semibold text-lg">Recent Attendance</h3>
              <Link to="/attendance" className="text-xs text-primary hover:underline">Take attendance</Link>
            </div>
            <div className="space-y-3">
              {attendanceSummary.map(({ date, present, total }) => (
                <div key={date} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                  <p className="text-sm font-medium">{format(new Date(date), 'MMM d, yyyy')}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-emerald-600">{present}</span>
                    <span className="text-xs text-muted-foreground">/ {total} present</span>
                  </div>
                </div>
              ))}
              {attendanceSummary.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No attendance recorded yet</p>}
            </div>
          </Card>
        </motion.div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="p-6 border-0 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-semibold text-lg">Upcoming Lessons</h3>
              <Link to="/curriculum" className="text-xs text-primary hover:underline">View all</Link>
            </div>
            <div className="space-y-3">
              {curriculum.slice(0, 5).map(lesson => (
                <div key={lesson.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                  <div className="w-7 h-7 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 text-xs font-bold text-primary">
                    {lesson.lesson_number || '—'}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{lesson.title}</p>
                    <p className="text-xs text-muted-foreground">{lesson.scripture}</p>
                  </div>
                </div>
              ))}
              {curriculum.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No lessons yet</p>}
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <Card className="p-6 border-0 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-semibold text-lg">Upcoming Events</h3>
              <Link to="/events" className="text-xs text-primary hover:underline">View all</Link>
            </div>
            <div className="space-y-3">
              {upcomingEvents.slice(0, 5).map(event => (
                <div key={event.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                  <Calendar className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{event.name}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(event.date), 'MMM d, yyyy')}</p>
                  </div>
                </div>
              ))}
              {upcomingEvents.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No upcoming events</p>}
            </div>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}