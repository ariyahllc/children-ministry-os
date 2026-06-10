import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, CheckSquare, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import StatCard from '@/components/shared/StatCard';
import { Link } from 'react-router-dom';

export default function VolunteerDashboard() {
  const { data: events = [] } = useQuery({ queryKey: ['events'], queryFn: () => base44.entities.Event.list('-date', 20) });
  const { data: tasks = [] } = useQuery({ queryKey: ['tasks'], queryFn: () => base44.entities.Task.list() });

  const upcomingEvents = events.filter(e => new Date(e.date) >= new Date() && e.status !== 'Cancelled');
  const myTasks = tasks.filter(t => t.status !== 'Completed');

  const statusColors = {
    Pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    'In Progress': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    Overdue: 'bg-destructive/10 text-destructive border-destructive/20',
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard title="Upcoming Events" value={upcomingEvents.length} icon={Calendar} color="indigo" index={0} />
        <StatCard title="My Tasks" value={myTasks.length} icon={CheckSquare} color="orange" index={1} />
        <StatCard title="Events This Month" value={events.filter(e => {
          const d = new Date(e.date);
          const now = new Date();
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        }).length} icon={Clock} color="green" index={2} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="p-6 border-0 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-semibold text-lg">Assigned Events</h3>
              <Link to="/events" className="text-xs text-primary hover:underline">View all</Link>
            </div>
            <div className="space-y-3">
              {upcomingEvents.slice(0, 6).map(event => (
                <div key={event.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{event.name}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(event.date), 'MMM d, yyyy')}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] flex-shrink-0">{event.status}</Badge>
                </div>
              ))}
              {upcomingEvents.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No upcoming events</p>}
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="p-6 border-0 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-semibold text-lg">My Tasks</h3>
              <Link to="/tasks" className="text-xs text-primary hover:underline">View all</Link>
            </div>
            <div className="space-y-3">
              {myTasks.slice(0, 6).map(task => (
                <div key={task.id} className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/30">
                  <div className="flex items-center gap-3 min-w-0">
                    <CheckSquare className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{task.title}</p>
                      {task.due_date && <p className="text-xs text-muted-foreground">{format(new Date(task.due_date), 'MMM d')}</p>}
                    </div>
                  </div>
                  <Badge variant="outline" className={`text-[10px] ${statusColors[task.status] || ''}`}>{task.status}</Badge>
                </div>
              ))}
              {myTasks.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No pending tasks!</p>}
            </div>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}