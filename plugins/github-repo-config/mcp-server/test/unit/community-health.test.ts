import { describe, it, expect } from 'vitest';
import { mockRest } from '../helpers.js';
import { listOrgHealthFiles, getOrgHealthFile } from '../../src/tools/community-health.js';

describe('listOrgHealthFiles', () => {
  it('lists files and dirs, defaulting path to root', async () => {
    mockRest('get', '/repos/acme/.github/contents/', [
      { name: 'CONTRIBUTING.md', path: 'CONTRIBUTING.md', type: 'file' },
      { name: 'ISSUE_TEMPLATE', path: 'ISSUE_TEMPLATE', type: 'dir' },
    ]);
    const result = await listOrgHealthFiles({ org: 'acme' });
    expect(result).toEqual([
      { name: 'CONTRIBUTING.md', path: 'CONTRIBUTING.md', type: 'file' },
      { name: 'ISSUE_TEMPLATE', path: 'ISSUE_TEMPLATE', type: 'dir' },
    ]);
  });

  it('lists a named subdirectory and filters out non-file/dir entries', async () => {
    mockRest('get', '/repos/acme/.github/contents/ISSUE_TEMPLATE', [
      { name: 'bug.yml', path: 'ISSUE_TEMPLATE/bug.yml', type: 'file' },
      { name: 'weird-link', path: 'ISSUE_TEMPLATE/weird-link', type: 'symlink' },
    ]);
    const result = await listOrgHealthFiles({ org: 'acme', path: 'ISSUE_TEMPLATE' });
    expect(result).toEqual([{ name: 'bug.yml', path: 'ISSUE_TEMPLATE/bug.yml', type: 'file' }]);
  });
});

describe('getOrgHealthFile', () => {
  it('decodes base64 content', async () => {
    const content = Buffer.from('# Contributing\n', 'utf8').toString('base64');
    mockRest('get', '/repos/acme/.github/contents/CONTRIBUTING.md', { path: 'CONTRIBUTING.md', content, encoding: 'base64' });
    const result = await getOrgHealthFile({ org: 'acme', path: 'CONTRIBUTING.md' });
    expect(result).toEqual({ path: 'CONTRIBUTING.md', content: '# Contributing\n' });
  });
});
