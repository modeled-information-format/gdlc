import { githubRest, type GithubClientDeps } from '../github-client.js';

/** Org-wide default community health files (issue/PR templates,
 * CONTRIBUTING, CODE_OF_CONDUCT, SECURITY) are read from the org's public
 * (or internal, on Enterprise Cloud) `{org}/.github` repository --
 * `.github-private` is NOT consulted for these defaults and is a
 * separate internal-tooling repo (e.g. Copilot custom agents); this
 * module only ever targets `.github`, never `.github-private`. */

export interface ListOrgHealthFilesInput {
  org: string;
  /** Directory path within the .github repo, e.g. "ISSUE_TEMPLATE" or "" for root. */
  path?: string;
}

export interface OrgHealthFileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
}

interface RestContentsEntry {
  name: string;
  path: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
}

export async function listOrgHealthFiles(input: ListOrgHealthFilesInput, deps: GithubClientDeps = {}): Promise<OrgHealthFileEntry[]> {
  const path = input.path ?? '';
  const data = (await githubRest(`/repos/${input.org}/.github/contents/${path}`, {}, deps)) as RestContentsEntry[];
  return data
    .filter((entry): entry is RestContentsEntry & { type: 'file' | 'dir' } => entry.type === 'file' || entry.type === 'dir')
    .map((entry) => ({ name: entry.name, path: entry.path, type: entry.type }));
}

export interface GetOrgHealthFileInput {
  org: string;
  path: string;
}

export interface OrgHealthFileContent {
  path: string;
  content: string;
}

interface RestContentsFile {
  path: string;
  content: string;
  encoding: 'base64';
}

export async function getOrgHealthFile(input: GetOrgHealthFileInput, deps: GithubClientDeps = {}): Promise<OrgHealthFileContent> {
  const data = (await githubRest(`/repos/${input.org}/.github/contents/${input.path}`, {}, deps)) as RestContentsFile;
  return { path: data.path, content: Buffer.from(data.content, data.encoding).toString('utf8') };
}
