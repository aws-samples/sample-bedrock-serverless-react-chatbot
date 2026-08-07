// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Search, Shield, Check } from 'lucide-react';
import { AdminService } from './AdminService';
import { bedrockConfig } from './aws-config';

/**
 * Admin-only component for updating the system-wide default model.
 * Changes are persisted to SSM Parameter Store via the Config API.
 */
function AdminSettings({ topNavModels, foundationModels, onModelChange, onClose }) {
  const [selectedModelId, setSelectedModelId] = useState(bedrockConfig.defaultModelId || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const modelOptions = useMemo(() =>
    topNavModels.map(m => ({ label: m.text, value: m.id, detail: m.detail })),
    [topNavModels]
  );

  const filteredModels = useMemo(() => {
    if (!searchQuery.trim()) return modelOptions;
    const q = searchQuery.toLowerCase();
    return modelOptions.filter(m =>
      m.label.toLowerCase().includes(q) || m.detail?.toLowerCase().includes(q)
    );
  }, [modelOptions, searchQuery]);

  const handleSave = async () => {
    if (!selectedModelId) {
      setError('Please select a model');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      // Find model details for the selected model
      const modelInfo = topNavModels.find(m => m.id === selectedModelId);
      const fm = foundationModels.find(m => m.modelId === selectedModelId);

      const modelName = modelInfo?.text || fm?.modelName || '';
      const modelProvider = fm?.providerName || '';

      await AdminService.updateDefaultModel(selectedModelId, modelName, modelProvider);

      setSuccess(`System default model updated to: ${modelInfo?.text || selectedModelId}`);
      if (onModelChange) onModelChange(selectedModelId);
    } catch (err) {
      setError(err.message || 'Failed to update default model');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Shield className="h-4 w-4" />
        <span>This changes the default model for all users who have not set a personal preference.</span>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Current System Default</label>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{bedrockConfig.defaultModelId || 'Not set'}</Badge>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">New Default Model</label>
        <div className="relative mb-2">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search models..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="max-h-48 overflow-y-auto border rounded-md">
          {filteredModels.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No models found</p>
          ) : (
            filteredModels.map(model => (
              <button
                key={model.value}
                onClick={() => setSelectedModelId(model.value)}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left hover:bg-accent transition-colors ${
                  selectedModelId === model.value ? 'bg-accent' : ''
                }`}
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{model.label}</p>
                  <p className="text-xs text-muted-foreground truncate">{model.detail}</p>
                </div>
                {selectedModelId === model.value && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            ))
          )}
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert>
          <AlertDescription className="text-green-600 dark:text-green-400">{success}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving || !selectedModelId}>
          {saving ? 'Saving...' : 'Update System Default'}
        </Button>
      </div>
    </div>
  );
}

export default AdminSettings;
