// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState } from 'react';
import {
  Header,
  SpaceBetween,
  Form,
  FormField,
  Input,
  Button,
  Alert,
  Spinner,
  Textarea,
  RadioGroup
} from '@cloudscape-design/components';
import { useContext } from 'react';
import { CredentialsContext } from './SessionContext';
import { addWebsiteToCrawl } from './bedrockAgent';
import { sanitizeForLog } from './utils/sanitize';
import { validateFilters } from './utils/regexValidator';
import { enforceHttps } from './utils/urlValidator';

const WebsiteCrawler = () => {
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
      // Validate URL format
      if (!websiteUrl.match(/^https?:\/\/.+\..+/)) {
        throw new Error('Please enter a valid URL starting with https://');
      }

      // Enforce HTTPS protocol for security
      const secureUrl = enforceHttps(websiteUrl);

      // Validate filters
      if (!validateFilters(exclusionFilters)) {
        throw new Error('Please enter at least one valid regex pattern for exclusion filters');
      }

      // Parse filters into arrays
      const inclusionArray = inclusionFilters.split('\n').map(f => f.trim()).filter(f => f);
      const exclusionArray = exclusionFilters.split('\n').map(f => f.trim()).filter(f => f);

      // Call the function to add website to crawl
      const result = await addWebsiteToCrawl(
        secureUrl, 
        inclusionArray, 
        exclusionArray,
        scope,
        rateLimit ? Number(rateLimit) : undefined,
        Number(maxPages),
        credentials
      );
      
      setSuccess(`Successfully added ${sanitizeForLog(secureUrl)} to crawl queue. Ingestion job started.`);
      setWebsiteUrl(''); // Clear the input field
    } catch (err) {
      setError(`Failed to add website: ${sanitizeForLog(err.message)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
      <SpaceBetween size="l" className="website-crawler-content">
        
        {error && (
          <Alert type="error" dismissible onDismiss={() => setError(null)}>
            {error}
          </Alert>
        )}
        
        {success && (
          <Alert type="success" dismissible onDismiss={() => setSuccess(null)}>
            {success}
          </Alert>
        )}
        
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button 
                variant="primary" 
                onClick={handleSubmit} 
                disabled={loading || !websiteUrl.trim() || !exclusionFilters.trim()}
              >
                {loading ? <Spinner /> : "Add Website"}
              </Button>
            </SpaceBetween>
          }
        >
          <FormField
            label="Website URL"
            description="Enter the URL of the website you want to crawl and add to your knowledge base"
            constraintText="Must be a valid URL (HTTPS will be enforced for security)"
          >
            <Input
              value={websiteUrl}
              onChange={({ detail }) => setWebsiteUrl(detail.value)}
              placeholder="https://example.com"
              disabled={loading}
            />
          </FormField>
          
          <FormField
            label="Inclusion Filters"
            description="Regex patterns for URLs to include in the crawl (one per line)"
            constraintText="Default is '.*' which includes all URLs"
          >
            <Textarea
              value={inclusionFilters}
              onChange={({ detail }) => setInclusionFilters(detail.value)}
              placeholder=".*"
              disabled={loading}
            />
          </FormField>
          
          <FormField
            label="Exclusion Filters"
            description="Regex patterns for URLs to exclude from the crawl (one per line)"
            constraintText="At least one valid regex pattern is required"
            errorText={exclusionFilters.trim() ? undefined : "At least one exclusion filter is required"}
          >
            <Textarea
              value={exclusionFilters}
              onChange={({ detail }) => setExclusionFilters(detail.value)}
              placeholder=".*\\.pdf"
              disabled={loading}
              invalid={!exclusionFilters.trim()}
            />
          </FormField>
          
          <FormField
            label="Crawl Scope"
            description="Define the scope of the web crawler"
          >
            <RadioGroup
              onChange={({ detail }) => setScope(detail.value)}
              value={scope}
              items={[
                { value: "HOST_ONLY", label: "Host only (current domain only)" },
                { value: "SUBDOMAINS", label: "Include subdomains" }
              ]}
              disabled={loading}
            />
          </FormField>
          
          <FormField
            label="Max Pages"
            description="Maximum number of pages to crawl"
            constraintText="Must be a positive number"
          >
            <Input
              value={maxPages}
              onChange={({ detail }) => setMaxPages(detail.value)}
              type="number"
              disabled={loading}
            />
          </FormField>
          
          <FormField
            label="Rate Limit (optional)"
            description="Maximum number of requests per second"
            constraintText="Leave empty for default rate limiting"
          >
            <Input
              value={rateLimit}
              onChange={({ detail }) => setRateLimit(detail.value)}
              type="number"
              placeholder="Optional"
              disabled={loading}
            />
          </FormField>
        </Form>
      </SpaceBetween>
  );
};

export default WebsiteCrawler;