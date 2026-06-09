import React from 'react';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { motion } from 'framer-motion';

export default function PageHeader({ title, subtitle, action, actionLabel, actionIcon: ActionIcon = Plus, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6"
    >
      <div>
        <h1 className="text-2xl lg:text-3xl font-heading font-bold text-foreground">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        {children}
        {action && (
          <Button onClick={action} className="shadow-md shadow-primary/20">
            <ActionIcon className="w-4 h-4 mr-2" />
            {actionLabel}
          </Button>
        )}
      </div>
    </motion.div>
  );
}