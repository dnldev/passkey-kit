#!/usr/bin/env node

/**
 * @ai_context Cross-repo post-commit hook script for Code Dojo ingestion.
 *
 * Drop this file into any repo and wire it into a husky post-commit hook:
 *   npx husky add .husky/post-commit "node scripts/push-to-dojo.cjs"
 *
 * On each commit, it sends the git diff to the Code Dojo ingestion API,
 * which uses DeepSeek to generate a quiz question from the changes.
 *
 * Environment: DOJO_INGEST_TOKEN must be set (shared secret).
 * The script is intentionally fire-and-forget — failures don't block commits.
 */

const { execSync } = require('node:child_process');
const https = require('node:https');
const http = require('node:http');
const path = require('node:path');

const DOJO_API_URL = process.env.DOJO_API_URL || 'https://dojo.danieltech.dev/api/ingest';
const DOJO_INGEST_TOKEN = process.env.DOJO_INGEST_TOKEN;
const MIN_DIFF_LINES = 10;
const MAX_DIFF_BYTES = 10000;

function getRepoName() {
  try {
    const remote = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
    const match = remote.match(/\/([^/]+?)(?:\.git)?$/);
    return match ? match[1] : path.basename(process.cwd());
  } catch {
    return path.basename(process.cwd());
  }
}

function getDiff() {
  try {
    return execSync('git diff HEAD~1 HEAD', { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  } catch {
    return '';
  }
}

async function postToDojo(diff, repoName) {
  const body = JSON.stringify({ diff, repoName });
  const url = new URL(DOJO_API_URL);
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Dojo-Token': DOJO_INGEST_TOKEN || '',
        },
        timeout: 30000,
      },
      (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
          resolve({ status: response.statusCode, data });
        });
      },
    );
    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Request timed out'));
    });
    request.write(body);
    request.end();
  });
}

async function main() {
  if (!DOJO_INGEST_TOKEN) {
    // Silently skip if no token configured
    return;
  }

  const diff = getDiff();
  const diffLines = diff.split('\n').length;

  if (diffLines < MIN_DIFF_LINES) {
    // Too small to generate a meaningful question
    return;
  }

  const repoName = getRepoName();
  const truncatedDiff = diff.length > MAX_DIFF_BYTES
    ? diff.slice(0, MAX_DIFF_BYTES) + '\n... (truncated)'
    : diff;

  try {
    const result = await postToDojo(truncatedDiff, repoName);
    if (result.status === 201) {
      const parsed = JSON.parse(result.data);
      console.log(`⛩️  Code Dojo: Generated question "${parsed.question?.id || 'unknown'}" from ${repoName}`);
    }
    // Silently ignore non-201 responses
  } catch {
    // Fire-and-forget — never block commits
  }
}

main().catch(() => {});
