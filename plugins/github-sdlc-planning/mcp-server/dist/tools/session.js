import { githubRest } from '../github-client.js';
import { findAllProjectConfigPaths } from '../config.js';
import { getProjectItems } from './projects.js';
export async function getSessionContext(input, deps = {}) {
    const milestonesPromise = githubRest(`/repos/${input.owner}/${input.repo}/milestones?state=open`, {}, deps);
    const projectBoardPromise = input.projectOwnerLogin !== undefined && input.projectNumber !== undefined
        ? getProjectItems({
            projectOwnerLogin: input.projectOwnerLogin,
            projectNumber: input.projectNumber,
            projectOwnerType: input.projectOwnerType,
        }, deps)
        : Promise.resolve(null);
    const [milestones, projectBoard] = await Promise.all([milestonesPromise, projectBoardPromise]);
    return {
        openMilestones: milestones.map((m) => ({ number: m.number, title: m.title, url: m.html_url, dueOn: m.due_on })),
        projectBoard,
        projectConfigPath: findAllProjectConfigPaths(input.startDir)[0] ?? null,
    };
}
export function getAgentCapabilities() {
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
            'get_gdlc_config',
            'write_gdlc_config',
        ],
        mifConformance: 'L1',
        hooksSupported: false,
    };
}
//# sourceMappingURL=session.js.map