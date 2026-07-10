#!/usr/bin/env tsx
/**
 * CLI entry point for check_pr_readiness's core logic (issue #185/#188) --
 * the thing a Monitor poll loop should call BY NAME instead of an agent
 * hand-rolling `gh api`/`jq` inline each time. This is the fix for the
 * observed failure mode where ad hoc, unscripted Monitor commands either
 * checked only one signal (CI status) while unresolved review threads sat
 * unseen, or never reliably triggered at all.
 *
 * Prints the full JSON verdict to stdout (one line, so a Monitor loop
 * treats each poll as one event) and a one-line human summary to stderr;
 * exits 0 when settled, 1 when not yet settled, 2 on a real error -- so a
 * bash poll loop can check the exit code directly:
 *
 *   until tsx scripts/pr-readiness.ts acme widgets 42; do sleep 30; done
 *
 * Usage: tsx scripts/pr-readiness.ts <owner> <repo> <pullNumber>
 *   or:  OWNER=acme REPO=widgets PR=42 tsx scripts/pr-readiness.ts
 */
import { checkPrReadiness } from '../src/tools/pr-readiness.js';

function parseArgs(): { owner: string; repo: string; pullNumber: number } {
  const [ownerArg, repoArg, prArg] = process.argv.slice(2);
  const owner = ownerArg ?? process.env.OWNER;
  const repo = repoArg ?? process.env.REPO;
  const pullNumberRaw = prArg ?? process.env.PR;
  if (!owner || !repo || !pullNumberRaw) {
    process.stderr.write('Usage: tsx scripts/pr-readiness.ts <owner> <repo> <pullNumber>  (or OWNER/REPO/PR env vars)\n');
    process.exit(2);
  }
  const pullNumber = Number(pullNumberRaw);
  if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
    process.stderr.write(`pullNumber must be a positive integer, got "${pullNumberRaw}"\n`);
    process.exit(2);
  }
  return { owner, repo, pullNumber };
}

async function main(): Promise<void> {
  const ref = parseArgs();
  const result = await checkPrReadiness(ref);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.settled) {
    process.stderr.write(`SETTLED: ${ref.owner}/${ref.repo}#${ref.pullNumber} is ready.\n`);
    process.exit(0);
  }
  process.stderr.write(`NOT SETTLED: ${ref.owner}/${ref.repo}#${ref.pullNumber} -- ${result.reasons.join('; ')}\n`);
  process.exit(1);
}

main().catch((err: unknown) => {
  process.stderr.write(`pr-readiness check failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(2);
});
