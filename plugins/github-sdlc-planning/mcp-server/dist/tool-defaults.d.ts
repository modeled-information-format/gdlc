/** Config-driven defaulting for tool-call arguments (issues #82/#83): fills
 * `projectOwnerLogin`/`projectNumber`/`projectOwnerType` and `owner`/`repo`
 * from the layered gdlc config when a caller omits them, and enforces the
 * `targeting` allowlist on issue creation. Kept out of index.ts (thin
 * MCP-protocol wiring, coverage-exempt) specifically so this defaulting
 * logic is covered by the package's 90% coverage gate. */
export interface BoardArgs {
    projectOwnerLogin?: string;
    projectNumber?: number;
    projectOwnerType?: 'organization' | 'user';
    /** Issue #274: `loadGdlcConfig` resolves the project-layer cascade from
     * this directory, defaulting to `process.cwd()` when omitted -- the MCP
     * SERVER PROCESS's own cwd, which has no necessary relationship to the
     * repo a tool call's `owner`/`repo` arguments describe. A caller that
     * knows the target repo's checkout path should pass it here (same
     * pattern `get_gdlc_config`'s own `startDir` param already uses) so
     * board resolution reads THAT repo's config instead of whatever the
     * server process happens to be sitting in -- otherwise a caller with no
     * explicit `projectOwnerLogin`/`projectNumber` silently gets an
     * unrelated repo's board with no error and no diagnostic (the exact
     * failure #274 reported: `get_session_context` for `attested-delivery/
     * go-htmx` returned board items from `modeled-information-format/gdlc`
     * instead). Honored by BOTH `withOptionalBoardCoordinates` and
     * `withRequiredBoardCoordinates` below, since `BoardArgs` is their shared
     * bound -- a fix to only one wrapper would leave the mutating tools
     * behind `withRequiredBoardCoordinates` (`add_item_to_project`,
     * `set_field_value`, `get_project_items`, `get_project_status_profile`)
     * exposed to the identical wrong-board risk, which is the higher-severity
     * case #274 itself names (corrupting an unrelated org's board via a
     * mutating call, not just reading one). */
    startDir?: string;
}
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
export declare function withRequiredBoardCoordinates<TArgs extends BoardArgs, TResult>(fn: (args: TArgs) => Promise<TResult> | TResult): (args: BoardArgs & Record<string, unknown>) => Promise<TResult> | TResult;
/** Writes a diagnostic to stderr (never stdout -- that's the MCP
 * JSON-RPC transport, writing there would corrupt the protocol stream)
 * when `withOptionalBoardCoordinates` resolves no usable board
 * coordinates. Not an error: this path is explicitly the "no board
 * configured" case those callers treat as valid. Exported for tests. */
export declare function warnNoOpBoard(write?: (line: string) => void): void;
/** Test-only reset for `warnNoOpBoard`'s once-per-process guard. */
export declare function resetNoOpBoardWarning(): void;
/** Same config fallback as `withRequiredBoardCoordinates`, but never
 * throws: a tool like `get_session_context` treats "no board configured"
 * as a valid, optional state rather than an error -- surfaced instead as a
 * one-time stderr diagnostic (`warnNoOpBoard`) naming the no-op and how to
 * configure it, rather than a completely silent fallback. */
export declare function withOptionalBoardCoordinates<TArgs extends BoardArgs, TResult>(fn: (args: TArgs) => Promise<TResult> | TResult): (args: BoardArgs & Record<string, unknown>) => Promise<TResult> | TResult;
export interface IssueDestinationArgs {
    owner?: string;
    repo?: string;
    /** Issue #281: same purpose as `BoardArgs.startDir` (#274) -- `loadGdlcConfig`
     * resolves the project-layer cascade from this directory, defaulting to
     * `process.cwd()` when omitted (the MCP server process's own cwd, unrelated
     * to the repo a tool call concerns). Pass the target repo's checkout path
     * so destination/allowlist resolution reads THAT repo's config instead of
     * whatever the server process happens to be sitting in. */
    startDir?: string;
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
export declare function withIssueDestination<TArgs extends IssueDestinationArgs, TResult>(fn: (args: TArgs & {
    owner: string;
    repo: string;
}) => Promise<TResult> | TResult): (args: IssueDestinationArgs & Record<string, unknown>) => Promise<TResult> | TResult;
