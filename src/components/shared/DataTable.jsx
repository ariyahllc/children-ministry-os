import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Search, MoreVertical, Pencil, Trash2, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { motion, AnimatePresence } from 'framer-motion';

const PAGE_SIZE = 10;

export default function DataTable({ columns, data, isLoading, onEdit, onDelete, onView, searchPlaceholder = "Search...", emptyMessage = "No records found" }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const filtered = data?.filter(row =>
    columns.some(col => {
      const val = col.accessor ? row[col.accessor] : '';
      return String(val || '').toLowerCase().includes(search.toLowerCase());
    })
  ) || [];

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      <div className="p-4 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            className="pl-10 bg-muted/50 border-0"
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              {columns.map(col => (
                <TableHead key={col.accessor || col.header} className="text-xs font-semibold uppercase tracking-wider">
                  {col.header}
                </TableHead>
              ))}
              {(onEdit || onDelete || onView) && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array(5).fill(0).map((_, i) => (
                <TableRow key={i}>
                  {columns.map((col, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-24" /></TableCell>
                  ))}
                  {(onEdit || onDelete || onView) && <TableCell><Skeleton className="h-4 w-4" /></TableCell>}
                </TableRow>
              ))
            ) : paged.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="text-center py-12 text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              <AnimatePresence>
                {paged.map((row, i) => (
                  <motion.tr
                    key={row.id || i}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="border-b hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => onView?.(row)}
                  >
                    {columns.map(col => (
                      <TableCell key={col.accessor || col.header} className="text-sm">
                        {col.render ? col.render(row) : row[col.accessor]}
                      </TableCell>
                    ))}
                    {(onEdit || onDelete || onView) && (
                      <TableCell onClick={e => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {onView && (
                              <DropdownMenuItem onClick={() => onView(row)}>
                                <Eye className="w-4 h-4 mr-2" />View
                              </DropdownMenuItem>
                            )}
                            {onEdit && (
                              <DropdownMenuItem onClick={() => onEdit(row)}>
                                <Pencil className="w-4 h-4 mr-2" />Edit
                              </DropdownMenuItem>
                            )}
                            {onDelete && (
                              <DropdownMenuItem onClick={() => onDelete(row)} className="text-destructive">
                                <Trash2 className="w-4 h-4 mr-2" />Delete
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </motion.tr>
                ))}
              </AnimatePresence>
            )}
          </TableBody>
        </Table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t">
          <p className="text-xs text-muted-foreground">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 0}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs text-muted-foreground">
              {page + 1} of {totalPages}
            </span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}