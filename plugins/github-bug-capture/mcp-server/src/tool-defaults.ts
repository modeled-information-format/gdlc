import { loadGdlcConfig, resolveBoardCoordinates } from '@github-sdlc-plugins/github-sdlc-planning-mcp-server/config';
import { BugCaptureError } from './errors.js';

/** Config-driven defaulting for tool-call arguments (issues #82/#83): fills
 * `projectOwnerLogin`/`projectNumber`/`projectOwnerType` from the layered
 * gdlc config (owned by github-sdlc-planning, see ADR-0004) when a caller
 * omits them. Kept out of index.ts (thin MCP-protocol wiring, coverage-
 * exempt) specifically so this defaulting logic is covered by the
 * package's 90% coverage gate. */

export interface BoardArgs {
  projectOwnerLogin?: string;
  projectNumber?: number;
  projectOwnerType?: 'organization' | 'user';
}

/** Fill board coordinates from config; explicit arguments always win.
 * Throws `missing_board_config` when neither the caller nor either config
 * layer supplies a complete board mapping -- these tools require one to do
 * anything. See github-sdlc-planning's `tool-defaults.ts` for why the
 * returned handler's parameter type is the loose `BoardArgs &
 * Record<string, unknown>` rather than `TArgs` itself. */
export function withRequiredBoardCoordinates<TArgs extends BoardArgs, TResult>(fn: (args: TArgs) => Promise<TResult> | TResult) {
  return (args: BoardArgs & Record<string, unknown>): Promise<TResult> | TResult => {
    const config = loadGdlcConfig();
    const resolved = resolveBoardCoordinates(
      { projectOwnerLogin: args.projectOwnerLogin, projectNumber: args.projectNumber, projectOwnerType: args.projectOwnerType },
      config,
    );
    if (!resolved) {
      throw new BugCaptureError(
        'missing_board_config',
        'No projectOwnerLogin/projectNumber given and none configured in .config/gdlc/config.yml or the global gdlc config ($XDG_CONFIG_HOME/gdlc/config.yml).',
      );
    }
    return fn({ ...args, ...resolved } as TArgs);
  };
}
