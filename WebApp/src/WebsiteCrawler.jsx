// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState, useContext } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2 } from 'lucide-react';
import { CredentialsContext } from './SessionContext';
import { addWebsiteToCrawl } from './bedrockAgent';
import { sanitizeForLog } from './utils/sanitize';
import { validateFilters } from './utils/regexValidator';
import { enforceHttps } from './utils/urlValidator';
import { bedrockConfig } from './aws-config';

const WebsiteCrawler = () => {
  const isManagedKb = bedrockConfig.vectorStore === 'managed';
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [inclusionFilters, setInclusionFilters] = useState('.*');
  const [exclusionFilters, setExclusionFilters] = useState('.*\\.pdf\n.*\\.zip\n.*\\.exe');
  const [scope, setScope] = useState('SUBDOMAINS');
  const [maxPages, setMaxPages] = useState('100');
  const [rateLimit, setRateLimit] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const credentials = useContext(CredentialsContext);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      if (!websiteUrl.match(/^https?:\/\/.+\..+/)) throw new Error('Please enter a valid URL starting with https://');
      const secureUrl = enforceHttps(websiteUrl);
      if (!validateFilters(exclusionFilters)) throw new Error('Please enter at least one valid regex pattern for exclusion filters');
      const inclusionArray = inclusionFilters.split('\n').map(f => f.trim()).filter(f => f);
      const exclusionArray = exclusionFilters.split('\n').map(f => f.trim()).filter(f => f);
      await addWebsiteToCrawl(secureUrl, inclusionArray, exclusionArray, scope, rateLimit ? Number(rateLimit) : undefined, Number(maxPages), credentials);
      setSuccess(`Successfully added ${sanitizeForLog(secureUrl)} to crawl queue. Ingestion job started.`);
      setWebsiteUrl('');
    } catch (err) {
      setError(`Failed to add website: ${sanitizeForLog(err.message)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {error && (
        <Alert variant="destructive" dismissible onDismiss={() => setError(null)}>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert variant="success" dismissible onDismiss={() => setSuccess(null)}>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label>Website URL</Label>
          <p className="text-xs text-muted-foreground">Enter the URL of the website you want to crawl (HTTPS enforced)</p>
          <Input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://example.com" disabled={loading} />
        </div>
        <div className="space-y-2">
          <Label>Inclusion Filters</Label>
          <p className="text-xs text-muted-foreground">Regex patterns for URLs to include (one per line). Default '.*' includes all.</p>
          <Textarea value={inclusionFilters} onChange={(e) => setInclusionFilters(e.target.value)} placeholder=".*" disabled={loading} rows={3} />
        </div>
        <div className="space-y-2">
          <Label>Exclusion Filters</Label>
          <p className="text-xs text-muted-foreground">Regex patterns for URLs to exclude (one per line). At least one required.</p>
          <Textarea
            value={exclusionFilters}
            onChange={(e) => setExclusionFilters(e.target.value)}
            placeholder=".*\.pdf"
            disabled={loading}
            rows={3}
            className={!exclusionFilters.trim() ? 'border-destructive' : ''}
          />
          {!exclusionFilters.trim() && <p className="text-xs text-destructive">At least one exclusion filter is required</p>}
        </div>
        <div className="space-y-2">
          <Label>Crawl Scope</Label>
          <RadioGroup value={scope} onValueChange={setScope} disabled={loading}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="HOST_ONLY" id="host-only" />
              <Label htmlFor="host-only" className="font-normal">Host only (current domain only)</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="SUBDOMAINS" id="subdomains" />
              <Label htmlFor="subdomains" className="font-normal">Include subdomains</Label>
            </div>
          </RadioGroup>
        </div>
        <div className="space-y-2">
          <Label>Max Pages</Label>
          {isManagedKb && (
            <p className="text-xs text-muted-foreground">
              Applied as the maximum links followed per URL (1-1000). A managed knowledge base has no total page cap.
            </p>
          )}
          <Input type="number" value={maxPages} onChange={(e) => setMaxPages(e.target.value)} disabled={loading} />
        </div>
        <div className="space-y-2">
          <Label>Rate Limit (optional)</Label>
          <p className="text-xs text-muted-foreground">
            {isManagedKb
              ? 'Maximum URLs crawled per minute (1-300). Leave empty for default.'
              : 'Maximum requests per second. Leave empty for default.'}
          </p>
          <Input type="number" value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} placeholder="Optional" disabled={loading} />
        </div>
        <Button type="submit" disabled={loading || !websiteUrl.trim() || !exclusionFilters.trim()}>
          {loading ? <><Loader2 className="h-4 w-4 animate-spin" />Adding...</> : "Add Website"}
        </Button>
      </form>
    </div>
  );
};

export default WebsiteCrawler;
