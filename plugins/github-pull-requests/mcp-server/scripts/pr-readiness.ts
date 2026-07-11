#!/usr/bin/env node
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
 *   until npm run pr-readiness -- acme widgets 42; do sleep 30; done
 *
 * Issue #226: this source file is not itself executable (no `+x`) and is
 * never run via its own shebang -- local dev iteration invokes it
 * explicitly with `tsx scripts/pr-readiness.ts <args>`. The shebang above
 * is `node`, not `tsx`, because esbuild copies it verbatim into the built
 * `dist/pr-readiness.js` (which IS `+x`): a `tsx` shebang there would try
 * to invoke `tsx` as the interpreter for a plain, already-bundled JS file,
 * which fails in an installed plugin cache with no `tsx` devDependency.
 * `node` is correct for both the source's actual runtime (via `tsx`, which
 * only cares about file content, not the shebang) and the bundled output's
 * real runtime.
 *
 * The `pr-readiness` npm script runs the esbuild-bundled `dist/pr-readiness.js`
 * (built alongside `dist/index.js` by `npm run build`), which inlines the
 * `@github-sdlc-plugins/github-sdlc-planning-mcp-server` cross-package
 * import at build time -- unlike this source file, which resolves that
 * import via npm workspaces symlinks and therefore only runs correctly
 * inside this monorepo checkout, never from an installed plugin cache.
 *
 * Three equivalent ways to invoke this CLI, in order of preference:
 *   npm run pr-readiness -- <owner> <repo> <pullNumber>   (recommended)
 *   node dist/pr-readiness.js <owner> <repo> <pullNumber>  (after npm run build)
 *   tsx scripts/pr-readiness.ts <owner> <repo> <pullNumber>  (monorepo dev only)
 *   or, with any of the three: OWNER=acme REPO=widgets PR=42 <command>
 */
import { checkPrReadiness } from '../src/tools/pr-readiness.js';

function parseArgs(): { owner: string; repo: string; pullNumber: number } {
  const [ownerArg, repoArg, prArg] = process.argv.slice(2);
  const owner = ownerArg ?? process.env.OWNER;
  const repo = repoArg ?? process.env.REPO;
  const pullNumberRaw = prArg ?? process.env.PR;
  if (!owner || !repo || !pullNumberRaw) {
    process.stderr.write(
      'Usage: npm run pr-readiness -- <owner> <repo> <pullNumber>  (or OWNER/REPO/PR env vars)\n' +
        '   or: node dist/pr-readiness.js <owner> <repo> <pullNumber>  (or: tsx scripts/pr-readiness.ts ...)\n',
    );
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
