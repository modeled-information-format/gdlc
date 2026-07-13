import { loadGdlcConfig, resolveBoardCoordinates, resolveDestinationRepo, isRepoAllowed } from './config.js';
import { PlanningError } from './errors.js';
/** Fill board coordinates from config; explicit arguments always win, and
 * are taken as a pair with config -- see `resolveBoardCoordinates` for why
 * a partial explicit call (only one of `projectOwnerLogin`/`projectNumber`)
 * is treated as unresolved rather than mixed with config. Throws
 * `missing_board_config` when neither a complete explicit pair nor a
 * complete config-resolved pair is available -- these tools require one to
 * do anything.
 *
 * The returned handler's parameter type is deliberately the loose
 * `BoardArgs & Record<string, unknown>` rather than `TArgs` itself: `TArgs`
 * is inferred from `fn`'s own (already-strict) parameter type, and a
 * handler typed that strictly would reject the schema's optional
 * `projectOwnerLogin`/`projectNumber` at the `registerTool` call site. The
 * cast on the call to `fn` is safe because `resolveBoardCoordinates`
 * either returns a complete `{ projectOwnerLogin, projectNumber }` or this
 * function throws first. */
export function withRequiredBoardCoordinates(fn) {
    return (args) => {
        const config = loadGdlcConfig();
        const resolved = resolveBoardCoordinates({ projectOwnerLogin: args.projectOwnerLogin, projectNumber: args.projectNumber, projectOwnerType: args.projectOwnerType }, config);
        if (!resolved) {
            throw new PlanningError('missing_board_config', 'projectOwnerLogin and projectNumber must both be given together, or both omitted so they can be ' +
                'resolved as a pair from .config/gdlc/config.yml or the global gdlc config ($XDG_CONFIG_HOME/gdlc/config.yml). ' +
                'Got an incomplete or missing combination.');
        }
        return fn({ ...args, ...resolved });
    };
}
/** Fires exactly once per process on the first no-op board resolution, so a
 * long-lived MCP server doesn't spam stderr on every subsequent
 * `get_session_context` call in the same session -- the guidance doesn't
 * change between calls, and the config isn't going to fix itself mid-session. */
let hasWarnedNoOpBoard = false;
/** Writes a diagnostic to stderr (never stdout -- that's the MCP
 * JSON-RPC transport, writing there would corrupt the protocol stream)
 * when `withOptionalBoardCoordinates` resolves no usable board
 * coordinates. Not an error: this path is explicitly the "no board
 * configured" case those callers treat as valid. Exported for tests. */
export function warnNoOpBoard(write = (line) => process.stderr.write(line)) {
    if (hasWarnedNoOpBoard)
        return;
    hasWarnedNoOpBoard = true;
    write('[gdlc] No board configured for this session -- board-aware fields will be omitted. ' +
        'Set board: { projectOwnerLogin, projectNumber } in .config/gdlc/config.yml ' +
        '(or the global $XDG_CONFIG_HOME/gdlc/config.yml) to enable them.\n');
}
/** Test-only reset for `warnNoOpBoard`'s once-per-process guard. */
export function resetNoOpBoardWarning() {
    hasWarnedNoOpBoard = false;
}
/** Same config fallback as `withRequiredBoardCoordinates`, but never
 * throws: a tool like `get_session_context` treats "no board configured"
 * as a valid, optional state rather than an error -- surfaced instead as a
 * one-time stderr diagnostic (`warnNoOpBoard`) naming the no-op and how to
 * configure it, rather than a completely silent fallback. */
export function withOptionalBoardCoordinates(fn) {
    return (args) => {
        const config = loadGdlcConfig(args.startDir);
        const resolved = resolveBoardCoordinates({ projectOwnerLogin: args.projectOwnerLogin, projectNumber: args.projectNumber, projectOwnerType: args.projectOwnerType }, config);
        if (!resolved)
            warnNoOpBoard();
        return fn((resolved ? { ...args, ...resolved } : args));
    };
}
/** Fill `owner`/`repo` from the configured `destination.repo` when the
 * caller omits both, then enforce the `targeting` allowlist against
 * whichever owner/repo is now in play -- explicit or defaulted. `owner`
 * and `repo` are taken as a pair, atomically, same rationale as
 * `resolveBoardCoordinates`: a caller supplying exactly one of them is
 * treated as unresolved rather than paired with the other from config,
 * which could silently combine the caller's real org with an unrelated
 * configured repo name (or vice versa). Throws `missing_destination` when
 * neither a complete explicit pair nor a complete configured pair is
 * available, or `repo_not_allowed` when a configured allowlist excludes
 * the resolved pair. See `withRequiredBoardCoordinates` for why the
 * returned handler's parameter type is the loose `IssueDestinationArgs`
 * rather than `TArgs`. */
export function withIssueDestination(fn) {
    return (args) => {
        const config = loadGdlcConfig();
        const hasOwner = args.owner !== undefined;
        const hasRepo = args.repo !== undefined;
        let owner;
        let repo;
        if (hasOwner && hasRepo) {
            owner = args.owner;
            repo = args.repo;
        }
        else if (!hasOwner && !hasRepo) {
            const destination = resolveDestinationRepo(config);
            owner = destination?.owner;
            repo = destination?.repo;
        }
        if (owner === undefined || repo === undefined) {
            throw new PlanningError('missing_destination', 'owner and repo must both be given together, or both omitted so they can be resolved as a pair from ' +
                'destination.repo in .config/gdlc/config.yml or the global gdlc config. Got an incomplete or missing combination.');
        }
        if (!isRepoAllowed(config, owner, repo)) {
            throw new PlanningError('repo_not_allowed', `${owner}/${repo} is not in the configured targeting allowlist.`, { owner, repo });
        }
        return fn({ ...args, owner, repo });
    };
}
//# sourceMappingURL=tool-defaults.js.map