import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, Calendar, FileText, Bell } from 'lucide-react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import StatCard from '@/components/shared/StatCard';
import { useRole } from '@/lib/RoleContext';

export default function ParentDashboard() {
  const { user } = useRole();
  const { data: events = [] } = useQuery({ queryKey: ['events'], queryFn: () => base44.entities.Event.list('-date', 20) });
  const { data: communications = [] } = useQuery({ queryKey: ['communications'], queryFn: () => base44.entities.Communication.list('-date', 5) });

  const upcomingEvents = events.filter(e => new Date(e.date) >= new Date() && e.status !== 'Cancelled');
  const announcements = communications.filter(c => c.status === 'Sent' && c.type === 'Parent Email');

  return (
    <div className="space-y-6">
      <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl">
        <p className="text-sm font-medium">Welcome, {user?.full_name || 'Parent'}!</p>
        <p className="text-xs text-muted-foreground mt-1">View your family's ministry information and upcoming events below.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard title="Upcoming Events" value={upcomingEvents.length} icon={Calendar} color="indigo" index={0} />
        <StatCard title="Announcements" value={announcements.length} icon={Bell} color="orange" index={1} />
        <StatCard title="This Month" value={events.filter(e => {
          const d = new Date(e.date);
          const now = new Date();
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        }).length} icon={FileText} color="green" index={2} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="p-6 border-0 shadow-sm">
            <h3 className="font-heading font-semibold text-lg mb-4">Upcoming Events</h3>
            <div className="space-y-3">
              {upcomingEvents.slice(0, 6).map(event => (
                <div key={event.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{event.name}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(event.date), 'EEEE, MMM d, yyyy')}</p>
                    {event.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{event.description}</p>}
                  </div>
                  <Badge variant="outline" className="text-[10px] flex-shrink-0">{event.type}</Badge>
                </div>
              ))}
              {upcomingEvents.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No upcoming events</p>}
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="p-6 border-0 shadow-sm">
            <h3 className="font-heading font-semibold text-lg mb-4">Announcements</h3>
            <div className="space-y-3">
              {announcements.slice(0, 5).map(comm => (
                <div key={comm.id} className="p-3 rounded-lg bg-muted/30">
                  <p className="text-sm font-medium">{comm.subject}</p>
                  {comm.date && <p className="text-xs text-muted-foreground mt-1">{format(new Date(comm.date), 'MMM d, yyyy')}</p>}
                  <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{comm.content}</p>
                </div>
              ))}
              {announcements.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No announcements</p>}
            </div>
          </Card>
        </motion.div>
      </div>

      {/* Future: Registration & Parent Portal */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
        <Card className="p-6 border-0 shadow-sm border-dashed border-2 border-muted">
          <div className="text-center py-4">
            <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <h3 className="font-semibold text-sm">Parent Portal — Coming Soon</h3>
            <p className="text-xs text-muted-foreground mt-1">Online registration, child updates, and more will be available here.</p>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}