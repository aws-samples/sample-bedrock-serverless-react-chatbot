// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { useState, useEffect, useContext } from 'react';
import { CredentialsContext } from './SessionContext';
import { fetchUserAttributes } from 'aws-amplify/auth';
import { PersonaService } from './PersonaService';
import PersonaDocumentUpload from './PersonaDocumentUpload';
import { config } from './aws-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Plus, Trash2, RotateCcw, RefreshCw, Pencil } from 'lucide-react';

const PersonaManager = ({ onPersonasChange }) => {
  const [personas, setPersonas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingPersona, setEditingPersona] = useState(null);
  const [formData, setFormData] = useState({ name: '', description: '', prompt: '', chatType: 'LLM', documents: [] });
  const [formErrors, setFormErrors] = useState({});
  const [alert, setAlert] = useState(null);
  const [userEmail, setUserEmail] = useState('');
  const credentials = useContext(CredentialsContext);

  useEffect(() => {
    const initializeUser = async () => {
      try { const attributes = await fetchUserAttributes(); setUserEmail(attributes.email); }
      catch (error) { console.error('Error fetching user attributes:', error); }
    };
    initializeUser();
  }, []);

  useEffect(() => { if (userEmail && credentials) loadPersonas(); }, [userEmail, credentials]);

  const loadPersonas = async () => {
    try {
      setLoading(true);
      await PersonaService.initializeDefaultPersonas(userEmail, credentials);
      const userPersonas = await PersonaService.getUserPersonas(userEmail, credentials);
      setPersonas(userPersonas);
      if (onPersonasChange) onPersonasChange();
    } catch (error) {
      console.error('Error loading personas:', error);
      setAlert({ type: 'destructive', content: 'Failed to load personas. Please try again.' });
    } finally { setLoading(false); }
  };

  const validateForm = () => {
    const errors = {};
    if (!formData.name.trim()) errors.name = 'Name is required';
    if (!formData.description.trim()) errors.description = 'Description is required';
    if (!formData.prompt.trim()) errors.prompt = 'Prompt is required';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreatePersona = async () => {
    if (!validateForm()) return;
    try {
      await PersonaService.savePersona(userEmail, { ...formData, isDefault: false, isSystem: false }, credentials);
      setAlert({ type: 'success', content: 'Persona created successfully!' });
      setShowCreateModal(false); resetForm(); await loadPersonas();
    } catch (error) { setAlert({ type: 'destructive', content: 'Failed to create persona.' }); }
  };

  const handleEditPersona = async () => {
    if (!validateForm()) return;
    try {
      await PersonaService.savePersona(userEmail, { ...editingPersona, ...formData }, credentials);
      setAlert({ type: 'success', content: 'Persona updated successfully!' });
      setShowEditModal(false); setEditingPersona(null); resetForm(); await loadPersonas();
    } catch (error) { setAlert({ type: 'destructive', content: 'Failed to update persona.' }); }
  };

  const handleDeletePersonas = async () => {
    try {
      const toDelete = personas.filter(p => selectedIds.has(p.id) && !p.isSystem);
      for (const persona of toDelete) await PersonaService.deletePersona(userEmail, persona.id, credentials);
      setAlert({ type: 'success', content: `Deleted ${toDelete.length} persona(s)!` });
      setSelectedIds(new Set()); await loadPersonas();
    } catch (error) { setAlert({ type: 'destructive', content: 'Failed to delete some personas.' }); }
  };

  const handleResetToDefaults = async () => {
    try {
      await PersonaService.resetToDefaultPersonas(userEmail, credentials);
      setAlert({ type: 'success', content: 'Reset to default personas!' });
      setSelectedIds(new Set()); await loadPersonas();
    } catch (error) { setAlert({ type: 'destructive', content: 'Failed to reset to defaults.' }); }
  };

  const openEditModal = (persona) => {
    setEditingPersona(persona);
    setFormData({ name: persona.name, description: persona.description, prompt: persona.prompt, chatType: persona.chatType || 'LLM', documents: persona.documents || [] });
    setShowEditModal(true);
  };

  const resetForm = () => { setFormData({ name: '', description: '', prompt: '', chatType: 'LLM', documents: [] }); setFormErrors({}); };
  const toggleSelection = (id) => { setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; }); };
  const canDeleteSelected = selectedIds.size > 0 && personas.some(p => selectedIds.has(p.id) && !p.isSystem);

  const personaFormContent = (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Name</Label>
        <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g., Marketing Expert" />
        {formErrors.name && <p className="text-xs text-destructive">{formErrors.name}</p>}
      </div>
      <div className="space-y-2">
        <Label>Description</Label>
        <Input value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="e.g., Specializes in marketing strategy" />
        {formErrors.description && <p className="text-xs text-destructive">{formErrors.description}</p>}
      </div>
      <div className="space-y-2">
        <Label>Default Chat Type</Label>
        <p className="text-xs text-muted-foreground">Automatically switch to this chat mode when this persona is selected</p>
        <Select value={formData.chatType} onValueChange={(val) => setFormData({ ...formData, chatType: val })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="LLM">General Chat</SelectItem>
            <SelectItem value="RAG">Knowledge Base Chat (RAG)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>System Prompt</Label>
        <Textarea value={formData.prompt} onChange={(e) => setFormData({ ...formData, prompt: e.target.value })} placeholder="You are a marketing expert..." rows={6} />
        {formErrors.prompt && <p className="text-xs text-destructive">{formErrors.prompt}</p>}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Persona Management</h2>
          <p className="text-sm text-muted-foreground">Manage your AI personas. Create custom personas or modify existing ones.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setShowCreateModal(true)}><Plus className="h-4 w-4" />Create Persona</Button>
          <Button variant="outline" onClick={handleDeletePersonas} disabled={!canDeleteSelected}><Trash2 className="h-4 w-4" />Delete Selected</Button>
          <Button variant="outline" onClick={handleResetToDefaults}><RotateCcw className="h-4 w-4" />Reset to Defaults</Button>
          <Button variant="outline" onClick={loadPersonas} loading={loading}><RefreshCw className="h-4 w-4" />Refresh</Button>
        </div>
      </div>

      {alert && (
        <Alert variant={alert.type} dismissible onDismiss={() => setAlert(null)}>
          <AlertDescription>{alert.content}</AlertDescription>
        </Alert>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10"></TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Chat Type</TableHead>
            <TableHead>Documents</TableHead>
            <TableHead>Prompt</TableHead>
            <TableHead className="w-20">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {personas.length === 0 ? (
            <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No personas found. Create your first custom persona to get started.</TableCell></TableRow>
          ) : personas.map(item => (
            <TableRow key={item.id}>
              <TableCell><Checkbox checked={selectedIds.has(item.id)} onCheckedChange={() => toggleSelection(item.id)} /></TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span>{item.name}</span>
                  {item.isDefault && <Badge variant="success">Default</Badge>}
                  {item.isSystem && <Badge variant="info">System</Badge>}
                  {!item.isSystem && !item.isDefault && <Badge variant="warning">Custom</Badge>}
                </div>
              </TableCell>
              <TableCell>{item.description}</TableCell>
              <TableCell><Badge variant={item.chatType === 'RAG' ? 'info' : 'secondary'}>{item.chatType === 'RAG' ? 'RAG' : 'General'}</Badge></TableCell>
              <TableCell>
                {item.documents?.length > 0
                  ? <Badge variant="success">{item.documents.length} doc{item.documents.length !== 1 ? 's' : ''}</Badge>
                  : <Badge variant="secondary">None</Badge>}
              </TableCell>
              <TableCell>
                {item.prompt ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="text-sm text-primary hover:underline text-left truncate max-w-[200px] block">
                        {item.prompt.length > 50 ? `${item.prompt.substring(0, 47)}...` : item.prompt}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80">
                      <p className="text-xs font-semibold mb-1">System Prompt:</p>
                      <p className="text-xs text-muted-foreground">{item.prompt}</p>
                    </PopoverContent>
                  </Popover>
                ) : <span className="text-muted-foreground text-sm">No prompt</span>}
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="icon" onClick={() => openEditModal(item)}><Pencil className="h-4 w-4" /></Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Create Modal */}
      <Dialog open={showCreateModal} onOpenChange={(open) => { if (!open) { setShowCreateModal(false); resetForm(); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create New Persona</DialogTitle></DialogHeader>
          {personaFormContent}
          <PersonaDocumentUpload persona={{ s3Prefix: `personas/${userEmail}/new/`, documents: formData.documents }} onDocumentsChange={(docs) => setFormData({ ...formData, documents: docs })} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreateModal(false); resetForm(); }}>Cancel</Button>
            <Button onClick={handleCreatePersona}>Create Persona</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Modal */}
      <Dialog open={showEditModal} onOpenChange={(open) => { if (!open) { setShowEditModal(false); setEditingPersona(null); resetForm(); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Persona: {editingPersona?.name || ''}</DialogTitle></DialogHeader>
          {personaFormContent}
          {editingPersona && <PersonaDocumentUpload persona={editingPersona} onDocumentsChange={(docs) => setFormData({ ...formData, documents: docs })} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowEditModal(false); setEditingPersona(null); resetForm(); }}>Cancel</Button>
            <Button onClick={handleEditPersona}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PersonaManager;
