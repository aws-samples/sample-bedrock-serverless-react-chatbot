// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState, useContext, useMemo } from 'react';
import { fetchUserAttributes } from 'aws-amplify/auth';
import { CredentialsContext } from './SessionContext';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Search, Check, RotateCcw } from 'lucide-react';
import { UserPreferencesService } from './UserPreferencesService';
import { bedrockConfig } from './aws-config';

/**
 * Component for users to set their personal default model preference.
 * This overrides the system-wide admin default for the current user only.
 * Stored in the UserPreferences DynamoDB table.
 */
function UserSettings({ topNavModels, foundationModels, userPreferences, onModelChange, onClose }) {
  const [selectedModelId, setSelectedModelId] = useState(userPreferences?.defaultModelId || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const credentials = useContext(CredentialsContext);

  const hasPersonalOverride = !!(userPreferences?.defaultModelId);

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
      const attrs = await fetchUserAttributes();
      const userId = attrs.email;

      // Find model details
      const modelInfo = topNavModels.find(m => m.id === selectedModelId);
      const fm = foundationModels.find(m => m.modelId === selectedModelId);

      const modelName = modelInfo?.text || fm?.modelName || '';
      const modelProvider = fm?.providerName || '';

      await UserPreferencesService.saveDefaultModel(userId, selectedModelId, modelName, modelProvider, credentials);

      setSuccess(`Your default model set to: ${modelInfo?.text || selectedModelId}`);
      if (onModelChange) onModelChange(selectedModelId);
    } catch (err) {
      setError(err.message || 'Failed to save preference');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const attrs = await fetchUserAttributes();
      const userId = attrs.email;

      await UserPreferencesService.clearDefaultModel(userId, credentials);

      setSelectedModelId('');
      setSuccess('Personal preference cleared. Using system default.');
      if (onModelChange) onModelChange(null);
    } catch (err) {
      setError(err.message || 'Failed to clear preference');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Set your personal default model. This overrides the system-wide default for your account only.
      </p>

      <div className="space-y-2">
        <label className="text-sm font-medium">System Default</label>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{bedrockConfig.defaultModelId || 'Not set'}</Badge>
        </div>
      </div>

      {hasPersonalOverride && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Your Current Override</label>
          <div className="flex items-center gap-2">
            <Badge variant="default">{userPreferences.defaultModelId}</Badge>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium">Select Model</label>
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

      <div className="flex justify-between">
        <Button variant="ghost" onClick={handleClear} disabled={saving || !hasPersonalOverride}>
          <RotateCcw className="h-4 w-4 mr-2" />Use System Default
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !selectedModelId}>
            {saving ? 'Saving...' : 'Save Preference'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default UserSettings;
