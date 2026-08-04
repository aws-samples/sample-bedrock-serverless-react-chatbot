// Copyright 2026 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Parses the S3 location URIs that Amazon Bedrock Knowledge Bases return in
 * citations into an explicit bucket and key.
 *
 * The format differs by knowledge base type:
 *
 *   Customer-managed (OpenSearch Serverless, S3 Vectors)
 *     s3://my-bucket/My Document.pdf
 *
 *   Bedrock Managed Knowledge Base
 *     https://my-bucket.s3.us-west-2.amazonaws.com/My%20Document.pdf
 *
 * Naively stripping an "s3://" prefix and splitting on the first "/" yields
 * Bucket="https:" for the managed form, which the S3 client then re-encodes into a
 * malformed path-style request. Both forms are handled here instead.
 *
 * @param {string} uri
 * @returns {{bucket: string, key: string} | null} null when the URI is not an S3 location
 */
export const parseS3Uri = (uri) => {
  if (!uri || typeof uri !== 'string') return null;

  // Canonical S3 URI. Keys are literal here, so they are not percent-decoded:
  // doing so would corrupt any key legitimately containing a '%'.
  if (uri.startsWith('s3://')) {
    const withoutScheme = uri.slice('s3://'.length);
    const separator = withoutScheme.indexOf('/');
    if (separator < 1 || separator === withoutScheme.length - 1) return null;
    return { bucket: withoutScheme.slice(0, separator), key: withoutScheme.slice(separator + 1) };
  }

  if (!uri.startsWith('https://') && !uri.startsWith('http://')) return null;

  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }

  const host = parsed.hostname;
  // Keys are percent-encoded in the HTTPS form and must be decoded before being
  // handed to the S3 client, which encodes them again when signing.
  let path = parsed.pathname.replace(/^\/+/, '');
  try {
    path = decodeURIComponent(path);
  } catch {
    // Leave the raw path in place if it is not valid percent-encoding.
  }
  if (!path) return null;

  // Virtual-hosted-style, including dualstack and legacy 's3-<region>' hosts:
  //   my-bucket.s3.us-west-2.amazonaws.com
  //   my-bucket.s3.dualstack.us-west-2.amazonaws.com
  //   my-bucket.s3-us-west-2.amazonaws.com
  const regionalVirtualHost = host.match(/^(.+?)\.s3[.-](.+)\.amazonaws\.com$/);
  if (regionalVirtualHost) return { bucket: regionalVirtualHost[1], key: path };

  // Global virtual-hosted-style: my-bucket.s3.amazonaws.com
  const globalVirtualHost = host.match(/^(.+?)\.s3\.amazonaws\.com$/);
  if (globalVirtualHost) return { bucket: globalVirtualHost[1], key: path };

  // Path-style: s3.us-west-2.amazonaws.com/my-bucket/My Document.pdf
  if (/^s3[.-]/.test(host)) {
    const separator = path.indexOf('/');
    if (separator < 1 || separator === path.length - 1) return null;
    return { bucket: path.slice(0, separator), key: path.slice(separator + 1) };
  }

  return null;
};

/**
 * Normalizes any supported S3 location URI to the canonical s3://bucket/key form so
 * that citations look the same regardless of knowledge base type. Returns the input
 * unchanged when it is not an S3 location (for example a web crawler URL).
 *
 * @param {string} uri
 * @returns {string}
 */
export const toCanonicalS3Uri = (uri) => {
  const parsed = parseS3Uri(uri);
  return parsed ? `s3://${parsed.bucket}/${parsed.key}` : uri;
};
