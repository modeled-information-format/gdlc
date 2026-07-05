import { assertProjectScope, githubGraphQL, type GithubClientDeps } from '../github-client.js';
import { BugCaptureError } from '../errors.js';
import {
  resolveProjectNodeId,
  getFieldByName,
  resolveProjectItem,
  setSingleSelectFieldValue,
  type ProjectCoordinates,
  type ProjectOwnerType,
} from './project-board.js';

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

export type { ProjectOwnerType, ProjectCoordinates };

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

/** Set an issue's Severity on the triage board. Fails with a typed error
 * when the issue is not on the board, or the field/option is missing (run
 * ensure_severity_field first). */
export async function setSeverity(input: SetSeverityInput, deps: GithubClientDeps = {}): Promise<SetSeverityResult> {
  await assertProjectScope(deps.fetchImpl);
  const projectId = await resolveProjectNodeId(input, deps);
  const { itemId } = await resolveProjectItem(input, projectId, input.owner, input.repo, input.issueNumber, deps);

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

  await setSingleSelectFieldValue(projectId, itemId, field.id, option.id, deps);
  return { itemId, fieldId: field.id, optionId: option.id, severity: input.severity };
}
