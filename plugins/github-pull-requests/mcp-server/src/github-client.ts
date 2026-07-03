import { execFileSync } from 'node:child_process';
import { PrError } from './errors.js';

const GITHUB_API = 'https://api.github.com';
const GITHUB_GRAPHQL = 'https://api.github.com/graphql';
const API_VERSION = '2022-11-28';
const MAX_RATE_LIMIT_RETRIES = 3;

let cachedToken: string | undefined;

export type ExecFileSyncFn = (command: string, args: string[], options: { encoding: 'utf8' }) => string;

const defaultExecFileSync: ExecFileSyncFn = (command, args, options) => execFileSync(command, args, options);

/** Same auth path as github-sdlc-planning (feature spec: "no additional
 * scope beyond what project-planning already requires, so a shared
 * token/session serves both plugins"). */
export function resolveToken(execImpl: ExecFileSyncFn = defaultExecFileSync): string {
  if (cachedToken) return cachedToken;
  const envToken = process.env.GITHUB_TOKEN;
  if (envToken) {
    cachedToken = envToken;
    return envToken;
  }
  try {
    const token = execImpl('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
    if (token) {
      cachedToken = token;
      return token;
    }
  } catch {
    // fall through to the error below
  }
  throw new PrError('github_api_error', 'No GitHub token available. Set GITHUB_TOKEN, or run `gh auth login`.');
}

export function resetAuthCacheForTests(): void {
  cachedToken = undefined;
}

class RateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(`Rate limited, retry after ${retryAfterSeconds}s`);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function withRateLimitBackoff<T>(
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
  attempt = 0,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RateLimitError && attempt < MAX_RATE_LIMIT_RETRIES) {
      await sleep(err.retryAfterSeconds * 1000);
      return withRateLimitBackoff(fn, sleep, attempt + 1);
    }
    throw err;
  }
}

async function handleResponse(res: Response): Promise<unknown> {
  if (res.status === 403 || res.status === 429) {
    const retryAfter = res.headers.get('retry-after');
    throw new RateLimitError(retryAfter ? Number(retryAfter) : 60);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new PrError('github_api_error', `GitHub API error ${res.status}: ${text}`, { status: res.status });
  }
  if (res.status === 204) return undefined;
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

interface RestOptions {
  method?: string;
  body?: unknown;
}

export interface GithubClientDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function githubRest(path: string, opts: RestOptions = {}, deps: GithubClientDeps = {}): Promise<unknown> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  return withRateLimitBackoff(
    async () => {
      const token = resolveToken();
      const res = await fetchImpl(`${GITHUB_API}${path}`, {
        method: opts.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': API_VERSION,
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      return handleResponse(res);
    },
    sleep,
  );
}

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

export async function githubGraphQL<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
  deps: GithubClientDeps = {},
): Promise<T> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  return withRateLimitBackoff(
    async () => {
      const token = resolveToken();
      const res = await fetchImpl(GITHUB_GRAPHQL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      const json = (await handleResponse(res)) as GraphQLResponse<T>;
      if (json.errors?.length) {
        throw new PrError('github_api_error', `GitHub GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`, {
          graphqlErrors: json.errors,
        });
      }
      if (json.data === undefined) {
        throw new PrError('github_api_error', 'GitHub GraphQL response had no data and no errors');
      }
      return json.data;
    },
    sleep,
  );
}
