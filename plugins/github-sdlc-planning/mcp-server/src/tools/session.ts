import { githubRest, type GithubClientDeps } from '../github-client.js';
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

interface RestMilestoneSummary {
  number: number;
  title: string;
  html_url: string;
  due_on: string | null;
}

export interface SessionContextResult {
  openMilestones: Array<{ number: number; title: string; url: string; dueOn: string | null }>;
  projectBoard: Awaited<ReturnType<typeof getProjectItems>> | null;
}

export async function getSessionContext(input: GetSessionContextInput, deps: GithubClientDeps = {}): Promise<SessionContextResult> {
  const milestonesPromise = githubRest(`/repos/${input.owner}/${input.repo}/milestones?state=open`, {}, deps) as Promise<
    RestMilestoneSummary[]
  >;

  const projectBoardPromise =
    input.projectOwnerLogin !== undefined && input.projectNumber !== undefined
      ? getProjectItems(
          {
            projectOwnerLogin: input.projectOwnerLogin,
            projectNumber: input.projectNumber,
            projectOwnerType: input.projectOwnerType,
          },
          deps,
        )
      : Promise.resolve(null);

  const [milestones, projectBoard] = await Promise.all([milestonesPromise, projectBoardPromise]);

  return {
    openMilestones: milestones.map((m) => ({ number: m.number, title: m.title, url: m.html_url, dueOn: m.due_on })),
    projectBoard,
  };
}

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

export function getAgentCapabilities(): AgentCapabilities {
  return {
    tools: [
      'create_issue',
      'update_issue',
      'add_sub_issue',
      'list_sub_issues',
      'add_item_to_project',
      'set_field_value',
      'get_project_items',
      'create_milestone',
      'list_milestones',
      'assign_milestone',
      'create_discussion',
      'list_discussions',
      'format_mif_issue_body',
      'parse_mif_issue_body',
      'get_session_context',
      'get_agent_capabilities',
    ],
    mifConformance: 'L1',
    hooksSupported: false,
  };
}
