import { assertProjectScope, githubGraphQL, type GithubClientDeps } from '../github-client.js';
import { BugCaptureError } from '../errors.js';

/** Triage-board Severity field (issue #31). The board itself and every other
 * field on it belong to github-sdlc-planning (ADR-0002); this module owns
 * exactly the bug-domain Severity axis: making the single-select field exist
 * with the canonical option set, and setting it on a bug's board item. */

export const SEVERITY_FIELD_NAME = 'Severity';

export const SEVERITY_LEVELS = ['Critical', 'High', 'Medium', 'Low'] as const;
export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

/** createProjectV2Field requires name+color+description on every option. */
const SEVERITY_OPTION_COLORS: Record<SeverityLevel, string> = {
  Critical: 'RED',
  High: 'ORANGE',
  Medium: 'YELLOW',
  Low: 'GREEN',
};

export type ProjectOwnerType = 'organization' | 'user';

export interface ProjectCoordinates {
  projectOwnerLogin: string;
  projectNumber: number;
  projectOwnerType?: ProjectOwnerType;
}

const ORG_PROJECT_ID_QUERY = `
  query($login: String!, $number: Int!) {
    organization(login: $login) { projectV2(number: $number) { id } }
  }
`;

const USER_PROJECT_ID_QUERY = `
  query($login: String!, $number: Int!) {
    user(login: $login) { projectV2(number: $number) { id } }
  }
`;

interface OrgProjectV2IdResponse {
  organization?: { projectV2?: { id: string } | null } | null;
}

interface UserProjectV2IdResponse {
  user?: { projectV2?: { id: string } | null } | null;
}

/** Resolve GitHub node IDs before any Projects v2 mutation, never a numeric
 * project number — same discipline as the sibling plugins' resolvers. */
async function resolveProjectNodeId(coords: ProjectCoordinates, deps: GithubClientDeps = {}): Promise<string> {
  const ownerType = coords.projectOwnerType ?? 'organization';
  try {
    if (ownerType === 'organization') {
      const data = await githubGraphQL<OrgProjectV2IdResponse>(
        ORG_PROJECT_ID_QUERY,
        { login: coords.projectOwnerLogin, number: coords.projectNumber },
        deps,
      );
      const id = data.organization?.projectV2?.id;
      if (!id) throw new Error('organization project not found');
      return id;
    }
    const data = await githubGraphQL<UserProjectV2IdResponse>(
      USER_PROJECT_ID_QUERY,
      { login: coords.projectOwnerLogin, number: coords.projectNumber },
      deps,
    );
    const id = data.user?.projectV2?.id;
    if (!id) throw new Error('user project not found');
    return id;
  } catch (cause) {
    throw new BugCaptureError(
      'resolve_project_id',
      `Failed to resolve project node ID for ${coords.projectOwnerLogin} project #${coords.projectNumber}`,
      { lookupStep: 'resolve_project_id', cause: cause instanceof Error ? cause.message : String(cause) },
    );
  }
}

const PROJECT_FIELDS_QUERY = `
  query($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        fields(first: 50) {
          nodes {
            __typename
            ... on ProjectV2FieldCommon { id name }
            ... on ProjectV2SingleSelectField { id name options { id name } }
          }
        }
      }
    }
  }
`;

interface ProjectFieldNode {
  __typename: string;
  id?: string;
  name?: string;
  options?: Array<{ id: string; name: string }>;
}

interface ProjectFieldsResponse {
  node: { fields?: { nodes: ProjectFieldNode[] } } | null;
}

async function getFieldByName(projectId: string, name: string, deps: GithubClientDeps): Promise<ProjectFieldNode | undefined> {
  const data = await githubGraphQL<ProjectFieldsResponse>(PROJECT_FIELDS_QUERY, { projectId }, deps);
  const nodes = data.node?.fields?.nodes ?? [];
  return nodes.find((n) => n.name === name);
}

const CREATE_SEVERITY_FIELD_MUTATION = `
  mutation($projectId: ID!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
    createProjectV2Field(
      input: { projectId: $projectId, dataType: SINGLE_SELECT, name: $name, singleSelectOptions: $options }
    ) {
      projectV2Field {
        ... on ProjectV2SingleSelectField { id name options { id name } }
      }
    }
  }
`;

interface CreateFieldResponse {
  createProjectV2Field: { projectV2Field: { id: string; name: string; options: Array<{ id: string; name: string }> } };
}

export type EnsureSeverityFieldInput = ProjectCoordinates;

export interface EnsureSeverityFieldResult {
  fieldId: string;
  /** false when the field already existed and nothing was mutated. */
  created: boolean;
  options: Array<{ id: string; name: string }>;
}

/** Idempotent: an existing Severity single-select field is returned as-is
 * (with its option IDs), without mutating — re-running provisioning against
 * an already-provisioned board is a read-only no-op. */
export async function ensureSeverityField(
  input: EnsureSeverityFieldInput,
  deps: GithubClientDeps = {},
): Promise<EnsureSeverityFieldResult> {
  await assertProjectScope(deps.fetchImpl);
  const projectId = await resolveProjectNodeId(input, deps);
  const existing = await getFieldByName(projectId, SEVERITY_FIELD_NAME, deps);
  if (existing) {
    if (existing.__typename !== 'ProjectV2SingleSelectField' || !existing.id) {
      throw new BugCaptureError(
        'field_type_conflict',
        `Project field "${SEVERITY_FIELD_NAME}" already exists but is a ${existing.__typename}, not a single-select field`,
        { fieldName: SEVERITY_FIELD_NAME, actualType: existing.__typename },
      );
    }
    return { fieldId: existing.id, created: false, options: existing.options ?? [] };
  }
  const data = await githubGraphQL<CreateFieldResponse>(
    CREATE_SEVERITY_FIELD_MUTATION,
    {
      projectId,
      name: SEVERITY_FIELD_NAME,
      options: SEVERITY_LEVELS.map((name) => ({ name, color: SEVERITY_OPTION_COLORS[name], description: '' })),
    },
    deps,
  );
  const field = data.createProjectV2Field.projectV2Field;
  return { fieldId: field.id, created: true, options: field.options };
}

const ISSUE_PROJECT_ITEMS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        projectItems(first: 100) {
          nodes { id project { id } }
        }
      }
    }
  }
`;

interface IssueProjectItemsResponse {
  repository?: {
    issue?: { projectItems: { nodes: Array<{ id: string; project: { id: string } }> } } | null;
  } | null;
}

export interface SetSeverityInput extends ProjectCoordinates {
  owner: string;
  repo: string;
  issueNumber: number;
  severity: SeverityLevel;
}

export interface SetSeverityResult {
  itemId: string;
  fieldId: string;
  optionId: string;
  severity: SeverityLevel;
}

const UPDATE_FIELD_VALUE_MUTATION = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(
      input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }
    ) {
      projectV2Item { id }
    }
  }
`;

/** Set an issue's Severity on the triage board. The issue's board item is
 * resolved through the issue's own projectItems connection (an issue sits on
 * few boards) rather than paginating the whole board. Fails with a typed
 * error when the issue is not on the board, or the field/option is missing
 * (run ensure_severity_field first). */
export async function setSeverity(input: SetSeverityInput, deps: GithubClientDeps = {}): Promise<SetSeverityResult> {
  await assertProjectScope(deps.fetchImpl);
  const projectId = await resolveProjectNodeId(input, deps);

  const itemsData = await githubGraphQL<IssueProjectItemsResponse>(
    ISSUE_PROJECT_ITEMS_QUERY,
    { owner: input.owner, repo: input.repo, number: input.issueNumber },
    deps,
  );
  const issue = itemsData.repository?.issue;
  if (!issue) {
    throw new BugCaptureError('resolve_issue_id', `Issue ${input.owner}/${input.repo}#${input.issueNumber} not found`, {
      lookupStep: 'resolve_issue_id',
    });
  }
  const item = issue.projectItems.nodes.find((n) => n.project.id === projectId);
  if (!item) {
    throw new BugCaptureError(
      'issue_not_on_board',
      `Issue ${input.owner}/${input.repo}#${input.issueNumber} is not an item on ${input.projectOwnerLogin} project #${input.projectNumber}; add it to the board first (github-sdlc-planning's add_item_to_project)`,
      { issueNumber: input.issueNumber, projectNumber: input.projectNumber },
    );
  }

  const field = await getFieldByName(projectId, SEVERITY_FIELD_NAME, deps);
  if (!field || field.__typename !== 'ProjectV2SingleSelectField' || !field.id) {
    throw new BugCaptureError(
      'missing_field',
      `Project ${input.projectOwnerLogin}#${input.projectNumber} has no "${SEVERITY_FIELD_NAME}" single-select field; run ensure_severity_field first`,
      { fieldName: SEVERITY_FIELD_NAME },
    );
  }
  const option = (field.options ?? []).find((o) => o.name === input.severity);
  if (!option) {
    throw new BugCaptureError(
      'missing_option',
      `"${SEVERITY_FIELD_NAME}" field has no "${input.severity}" option`,
      { fieldName: SEVERITY_FIELD_NAME, severity: input.severity, available: (field.options ?? []).map((o) => o.name) },
    );
  }

  await githubGraphQL(
    UPDATE_FIELD_VALUE_MUTATION,
    { projectId, itemId: item.id, fieldId: field.id, optionId: option.id },
    deps,
  );
  return { itemId: item.id, fieldId: field.id, optionId: option.id, severity: input.severity };
}
