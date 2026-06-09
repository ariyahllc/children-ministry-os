import React from 'react';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';

export default function StatCard({ title, value, icon: Icon, color, subtitle, index = 0 }) {
  const colorClasses = {
    indigo: 'bg-primary/10 text-primary',
    orange: 'bg-accent/10 text-accent',
    green: 'bg-emerald-500/10 text-emerald-600',
    rose: 'bg-rose-500/10 text-rose-600',
    blue: 'bg-blue-500/10 text-blue-600',
    purple: 'bg-purple-500/10 text-purple-600',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card className="p-5 hover:shadow-lg transition-shadow duration-300 border-0 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <p className="text-3xl font-bold mt-2 font-heading">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          <div className={`p-3 rounded-xl ${colorClasses[color] || colorClasses.indigo}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </Card>
    </motion.div>
  );
}