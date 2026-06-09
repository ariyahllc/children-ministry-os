import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Save, X } from 'lucide-react';

export default function FormDialog({ open, onClose, title, fields, data, onChange, onSave, saving }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading">{title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {fields.map(field => (
            <div key={field.name} className="space-y-2">
              <Label htmlFor={field.name} className="text-sm font-medium">{field.label}</Label>
              {field.type === 'select' ? (
                <Select
                  value={data[field.name] || ''}
                  onValueChange={val => onChange({ ...data, [field.name]: val })}
                >
                  <SelectTrigger><SelectValue placeholder={`Select ${field.label.toLowerCase()}`} /></SelectTrigger>
                  <SelectContent>
                    {field.options.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : field.type === 'textarea' ? (
                <Textarea
                  id={field.name}
                  value={data[field.name] || ''}
                  onChange={e => onChange({ ...data, [field.name]: e.target.value })}
                  placeholder={field.placeholder}
                  rows={3}
                />
              ) : field.type === 'switch' ? (
                <Switch
                  checked={data[field.name] || false}
                  onCheckedChange={val => onChange({ ...data, [field.name]: val })}
                />
              ) : (
                <Input
                  id={field.name}
                  type={field.type || 'text'}
                  value={data[field.name] || ''}
                  onChange={e => onChange({ ...data, [field.name]: e.target.value })}
                  placeholder={field.placeholder}
                />
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>
            <X className="w-4 h-4 mr-2" />Cancel
          </Button>
          <Button onClick={onSave} disabled={saving}>
            <Save className="w-4 h-4 mr-2" />{saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}