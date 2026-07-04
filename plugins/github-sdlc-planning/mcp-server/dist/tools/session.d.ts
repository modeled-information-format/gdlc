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
