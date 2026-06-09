import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend } from 'recharts';
import { format } from 'date-fns';
import PageHeader from '@/components/shared/PageHeader';
import { motion } from 'framer-motion';

const COLORS = ['hsl(245, 58%, 51%)', 'hsl(30, 85%, 56%)', 'hsl(160, 60%, 45%)', 'hsl(340, 65%, 55%)', 'hsl(200, 70%, 50%)'];

export default function Reports() {
  const { data: children = [] } = useQuery({ queryKey: ['children'], queryFn: () => base44.entities.Child.list() });
  const { data: teachers = [] } = useQuery({ queryKey: ['teachers'], queryFn: () => base44.entities.Teacher.list() });
  const { data: volunteers = [] } = useQuery({ queryKey: ['volunteers'], queryFn: () => base44.entities.Volunteer.list() });
  const { data: attendance = [] } = useQuery({ queryKey: ['attendance'], queryFn: () => base44.entities.Attendance.list('-date', 500) });
  const { data: events = [] } = useQuery({ queryKey: ['events'], queryFn: () => base44.entities.Event.list() });
  const { data: classes = [] } = useQuery({ queryKey: ['classes'], queryFn: () => base44.entities.MinistryClass.list() });
  const { data: curriculum = [] } = useQuery({ queryKey: ['curriculum'], queryFn: () => base44.entities.Curriculum.list() });

  // Attendance by month
  const monthlyAttendance = {};
  attendance.forEach(a => {
    if (!a.date) return;
    const month = format(new Date(a.date), 'MMM yyyy');
    if (!monthlyAttendance[month]) monthlyAttendance[month] = { month, present: 0, absent: 0 };
    if (a.present) monthlyAttendance[month].present++;
    else monthlyAttendance[month].absent++;
  });
  const attendanceData = Object.values(monthlyAttendance).slice(-12);

  // Event participation
  const eventData = events.filter(e => e.attendance_count).map(e => ({
    name: e.name?.substring(0, 15) || 'Event',
    count: e.attendance_count || 0,
    budget: e.budget || 0,
  })).slice(0, 10);

  // Volunteer background check
  const bgData = [
    { name: 'Cleared', value: volunteers.filter(v => v.background_check === 'Cleared').length },
    { name: 'Pending', value: volunteers.filter(v => v.background_check === 'Pending').length },
    { name: 'Expired', value: volunteers.filter(v => v.background_check === 'Expired').length },
    { name: 'Not Started', value: volunteers.filter(v => !v.background_check || v.background_check === 'Not Started').length },
  ].filter(d => d.value > 0);

  // Teacher class distribution
  const teacherData = classes.map(c => ({
    name: c.name,
    children: children.filter(ch => ch.class_id === c.id).length,
    capacity: c.capacity || 0,
  }));

  // Curriculum by semester
  const semesterData = ['Spring', 'Summer', 'Fall', 'Winter'].map(s => ({
    name: s,
    count: curriculum.filter(c => c.semester === s).length,
  }));

  const ReportCard = ({ title, children: content }) => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="p-6 border-0 shadow-sm">
        <h3 className="font-heading font-semibold text-lg mb-4">{title}</h3>
        {content}
      </Card>
    </motion.div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" subtitle="Ministry analytics and insights" />
      <Tabs defaultValue="attendance" className="space-y-6">
        <TabsList className="bg-muted/50">
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="volunteers">Volunteers</TabsTrigger>
          <TabsTrigger value="classes">Classes</TabsTrigger>
          <TabsTrigger value="curriculum">Curriculum</TabsTrigger>
        </TabsList>

        <TabsContent value="attendance" className="space-y-6">
          <ReportCard title="Monthly Attendance Trends">
            {attendanceData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={attendanceData}>
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="present" fill={COLORS[0]} name="Present" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="absent" fill={COLORS[3]} name="Absent" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-muted-foreground text-center py-12">No attendance data to display</p>}
          </ReportCard>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4 border-0 shadow-sm text-center">
              <p className="text-xs text-muted-foreground">Total Records</p>
              <p className="text-2xl font-bold font-heading mt-1">{attendance.length}</p>
            </Card>
            <Card className="p-4 border-0 shadow-sm text-center">
              <p className="text-xs text-muted-foreground">Present</p>
              <p className="text-2xl font-bold font-heading mt-1 text-emerald-600">{attendance.filter(a => a.present).length}</p>
            </Card>
            <Card className="p-4 border-0 shadow-sm text-center">
              <p className="text-xs text-muted-foreground">Absent</p>
              <p className="text-2xl font-bold font-heading mt-1 text-rose-500">{attendance.filter(a => !a.present).length}</p>
            </Card>
            <Card className="p-4 border-0 shadow-sm text-center">
              <p className="text-xs text-muted-foreground">Avg Rate</p>
              <p className="text-2xl font-bold font-heading mt-1">{attendance.length > 0 ? `${Math.round((attendance.filter(a => a.present).length / attendance.length) * 100)}%` : '—'}</p>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="events">
          <ReportCard title="Event Participation">
            {eventData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={eventData}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill={COLORS[1]} name="Attendance" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-muted-foreground text-center py-12">No event data to display</p>}
          </ReportCard>
        </TabsContent>

        <TabsContent value="volunteers">
          <ReportCard title="Background Check Status">
            {bgData.length > 0 ? (
              <div className="flex flex-col lg:flex-row items-center gap-8">
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={bgData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} dataKey="value" label={({ name, value }) => `${name} (${value})`}>
                      {bgData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="text-muted-foreground text-center py-12">No volunteer data to display</p>}
          </ReportCard>
        </TabsContent>

        <TabsContent value="classes">
          <ReportCard title="Class Enrollment vs Capacity">
            {teacherData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={teacherData}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="children" fill={COLORS[0]} name="Enrolled" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="capacity" fill={COLORS[2]} name="Capacity" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-muted-foreground text-center py-12">No class data to display</p>}
          </ReportCard>
        </TabsContent>

        <TabsContent value="curriculum">
          <ReportCard title="Lessons by Semester">
            {semesterData.some(d => d.count > 0) ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={semesterData}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill={COLORS[4]} name="Lessons" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-muted-foreground text-center py-12">No curriculum data to display</p>}
          </ReportCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}