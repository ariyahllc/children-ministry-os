import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Users, UserCheck, Heart, GraduationCap,
  BookOpen, Calendar, ClipboardList, FileText, MessageSquare,
  CheckSquare, BarChart3, ChevronLeft, ChevronRight, LogOut,
  Church, Menu, X, Sparkles, Globe, UserPlus, CalendarClock,
  Mail, MessageCircle
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/', permission: 'view_dashboard' },
  { label: 'Children', icon: Users, path: '/children', permission: 'view_children' },
  { label: 'Parents', icon: Heart, path: '/parents', permission: 'view_children' },
  { label: 'Teachers', icon: GraduationCap, path: '/teachers', permission: 'view_children' },
  { label: 'Volunteers', icon: UserCheck, path: '/volunteers', permission: 'view_events' },
  { label: 'Classes', icon: BookOpen, path: '/classes', permission: 'view_classes' },
  { label: 'Attendance', icon: ClipboardList, path: '/attendance', permission: 'view_attendance' },
  { label: 'Events', icon: Calendar, path: '/events', permission: 'view_events' },
  { label: 'Curriculum', icon: GraduationCap, path: '/curriculum', permission: 'view_curriculum' },
  { label: 'Documents', icon: FileText, path: '/documents', permission: 'view_documents' },
  { label: 'Communications', icon: MessageSquare, path: '/communications', permission: 'view_children' },
  { label: 'Tasks', icon: CheckSquare, path: '/tasks', permission: 'view_tasks' },
  { label: 'Reports', icon: BarChart3, path: '/reports', permission: 'view_reports' },
];

const futureItems = [
  { label: 'AI Assistant', icon: Sparkles },
  { label: 'Parent Portal', icon: Globe },
  { label: 'Registration', icon: UserPlus },
  { label: 'Scheduling', icon: CalendarClock },
  { label: 'Email Automation', icon: Mail },
  { label: 'WhatsApp', icon: MessageCircle },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { user, role, can } = useCurrentUser();

  const filteredNav = navItems.filter(item => role === 'admin' || can(item.permission));

  const roleLabels = {
    admin: 'Administrator',
    teacher: 'Teacher',
    volunteer: 'Volunteer',
    board_member: 'Board Member'
  };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-sidebar-primary flex items-center justify-center flex-shrink-0">
          <Church className="w-5 h-5 text-sidebar-primary-foreground" />
        </div>
        {!collapsed && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="overflow-hidden">
            <h1 className="text-sm font-heading font-bold text-sidebar-foreground leading-tight">Children</h1>
            <p className="text-xs text-sidebar-foreground/60">Ministry OS</p>
          </motion.div>
        )}
      </div>

      {/* User Info */}
      {!collapsed && user && (
        <div className="mx-4 mb-4 p-3 rounded-lg bg-sidebar-accent/50 border border-sidebar-border">
          <p className="text-sm font-medium text-sidebar-foreground truncate">{user.full_name || user.email}</p>
          <Badge variant="outline" className="mt-1 text-[10px] border-sidebar-primary/40 text-sidebar-primary">
            {roleLabels[role] || role}
          </Badge>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
        <p className={`text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40 px-3 pt-2 pb-1 ${collapsed ? 'text-center' : ''}`}>
          {collapsed ? '•' : 'Main'}
        </p>
        {filteredNav.map(item => {
          const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
          return (
            <TooltipProvider key={item.path} delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to={item.path}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200
                      ${isActive
                        ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-sidebar-primary/20'
                        : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                      }
                      ${collapsed ? 'justify-center' : ''}`}
                  >
                    <item.icon className="w-4 h-4 flex-shrink-0" />
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                </TooltipTrigger>
                {collapsed && <TooltipContent side="right">{item.label}</TooltipContent>}
              </Tooltip>
            </TooltipProvider>
          );
        })}

        {/* Future Features */}
        {role === 'admin' && (
          <>
            <p className={`text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40 px-3 pt-4 pb-1 ${collapsed ? 'text-center' : ''}`}>
              {collapsed ? '•' : 'Coming Soon'}
            </p>
            {futureItems.map(item => (
              <div
                key={item.label}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-sidebar-foreground/30 cursor-not-allowed ${collapsed ? 'justify-center' : ''}`}
              >
                <item.icon className="w-4 h-4 flex-shrink-0" />
                {!collapsed && (
                  <span className="flex items-center gap-2">
                    {item.label}
                    <Badge variant="outline" className="text-[9px] border-sidebar-foreground/20 text-sidebar-foreground/30 px-1">Soon</Badge>
                  </span>
                )}
              </div>
            ))}
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-sidebar-border">
        <button
          onClick={() => base44.auth.logout()}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors w-full ${collapsed ? 'justify-center' : ''}`}
        >
          <LogOut className="w-4 h-4" />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-card shadow-lg border"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="lg:hidden fixed inset-0 bg-black/50 z-40"
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 25 }}
              className="lg:hidden fixed inset-y-0 left-0 z-50 w-[260px] bg-sidebar"
            >
              <button onClick={() => setMobileOpen(false)} className="absolute top-4 right-4 text-sidebar-foreground/60">
                <X className="w-5 h-5" />
              </button>
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <aside className={`hidden lg:flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 ${collapsed ? 'w-[68px]' : 'w-[260px]'} relative flex-shrink-0`}>
        {sidebarContent}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-card border shadow-sm flex items-center justify-center hover:bg-muted transition-colors"
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>
      </aside>
    </>
  );
}