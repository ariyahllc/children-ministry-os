import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import ViewAsRoleBanner from '@/components/shared/ViewAsRoleBanner';

export default function AppLayout() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto flex flex-col">
        <ViewAsRoleBanner />
        <div className="flex-1 p-4 lg:p-8 pt-16 lg:pt-8 max-w-[1600px] mx-auto w-full">
          <Outlet />
        </div>
      </main>
    </div>
  );
}