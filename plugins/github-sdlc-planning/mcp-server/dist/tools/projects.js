import { githubGraphQL, assertProjectScope } from '../github-client.js';
import { resolveIssueNodeId, resolveProjectNodeId } from '../resolvers.js';
const ADD_ITEM_MUTATION = `
  mutation($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
      item { id }
    }
  }
`;
/** AC-3: resolve node IDs (issue, project) before mutating, never a numeric
 * issue/project number. AC-4: fail with a named `project`-scope error, not
 * GitHub's raw GraphQL permission error. */
export async function addItemToProject(input, deps = {}) {
    await assertProjectScope(deps.fetchImpl);
    const [contentId, projectId] = await Promise.all([
        resolveIssueNodeId(input.owner, input.repo, input.issueNumber, deps),
        resolveProjectNodeId(input.projectOwnerLogin, input.projectNumber, input.projectOwnerType ?? 'organization', deps),
    ]);
    const data = await githubGraphQL(ADD_ITEM_MUTATION, { projectId, contentId }, {}, deps);
    return { itemId: data.addProjectV2ItemById.item.id };
}
const UPDATE_FIELD_VALUE_MUTATION = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
    updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value }) {
      projectV2Item { id }
    }
  }
`;
function toGraphQLFieldValue(value) {
    switch (value.kind) {
        case 'text':
            return { text: value.text };
        case 'number':
            return { number: value.number };
        case 'date':
            return { date: value.date };
        case 'singleSelect':
            return { singleSelectOptionId: value.optionId };
        case 'iteration':
            return { iterationId: value.iterationId };
    }
}
export async function setFieldValue(input, deps = {}) {
    await assertProjectScope(deps.fetchImpl);
    const projectId = await resolveProjectNodeId(input.projectOwnerLogin, input.projectNumber, input.projectOwnerType ?? 'organization', deps);
    await githubGraphQL(UPDATE_FIELD_VALUE_MUTATION, { projectId, itemId: input.itemId, fieldId: input.fieldId, value: toGraphQLFieldValue(input.value) }, {}, deps);
    return { itemId: input.itemId };
}
const GET_PROJECT_ITEMS_QUERY = `
  query($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 100) {
          nodes {
            id
            content {
              ... on Issue { title }
              ... on PullRequest { title }
              ... on DraftIssue { title }
            }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
                ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
                ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
                ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
              }
            }
          }
        }
      }
    }
  }
`;
export async function getProjectItems(input, deps = {}) {
    const projectId = await resolveProjectNodeId(input.projectOwnerLogin, input.projectNumber, input.projectOwnerType ?? 'organization', deps);
    const data = await githubGraphQL(GET_PROJECT_ITEMS_QUERY, { projectId }, {}, deps);
    const nodes = data.node?.items?.nodes ?? [];
    return {
        items: nodes.map((n) => ({
            id: n.id,
            title: n.content?.title ?? null,
            fieldValues: n.fieldValues.nodes
                .filter((fv) => fv.field?.name !== undefined)
                .map((fv) => ({
                fieldName: fv.field?.name,
                text: fv.text,
                number: fv.number,
                date: fv.date,
                optionName: fv.name,
            })),
        })),
    };
}
//# sourceMappingURL=projects.js.map