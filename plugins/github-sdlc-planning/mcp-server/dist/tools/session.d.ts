import { type GithubClientDeps } from '../github-client.js';
import type { ProjectOwnerType } from '../resolvers.js';
import { getProjectItems } from './projects.js';
/** AC-10 fallback floor: this tool set is what a non-Claude-Code MCP host
 * uses instead of the SessionStart/PostToolUse hooks (AC-8/AC-9). */
export interface GetSessionContextInput {
    owner: string;
    repo: string;
    projectOwnerLogin?: string;
    projectNumber?: number;
    projectOwnerType?: ProjectOwnerType;
}
export interface SessionContextResult {
    openMilestones: Array<{
        number: number;
        title: string;
        url: string;
        dueOn: string | null;
    }>;
    projectBoard: Awaited<ReturnType<typeof getProjectItems>> | null;
    /** Issue #106 / ADR-0008: the filesystem path of the NEAREST project-layer
     * config file `loadGdlcConfig` actually considers (after upward search
     * from cwd), or `null` if none was found. Previously this resolution was
     * entirely invisible -- a `null` `projectBoard` above looked identical
     * whether no board was configured anywhere, or a real config file simply
     * wasn't reachable from the MCP server's cwd. This field makes that
     * distinction observable.
     *
     * ADR-0008: `loadGdlcConfig` now merges EVERY ancestor layer it finds, not
     * just this nearest one -- a further ancestor's section can still win if
     * the nearest layer doesn't define it. This field intentionally still
     * reports only the single nearest match (consistent in KIND with what
     * `loadGdlcConfig` treats as highest-priority), not the full list, to
     * avoid a breaking change to this tool's output shape; it is a debugging
     * aid naming the most relevant file, not a complete resolution trace. */
    projectConfigPath: string | null;
}
export declare function getSessionContext(input: GetSessionContextInput, deps?: GithubClientDeps): Promise<SessionContextResult>;
export interface AgentCapabilities {
    tools: string[];
    mifConformance: 'L1';
    /** This MCP layer never depends on host hooks — every write goes through a
     * tool call whether or not the host supports lifecycle hooks. A caller on a
     * hook-less host should treat MIF-body validation and session bootstrap as
     * its own responsibility (via format_mif_issue_body/parse_mif_issue_body
     * and get_session_context) rather than assuming a hook already ran. */
    hooksSupported: false;
}
export declare function getAgentCapabilities(): AgentCapabilities;
