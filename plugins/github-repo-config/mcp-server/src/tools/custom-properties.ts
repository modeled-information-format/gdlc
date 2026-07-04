import { githubRest, type GithubClientDeps } from '../github-client.js';
import { RepoConfigError } from '../errors.js';

export interface ListCustomPropertiesSchemaInput {
  org: string;
}

export interface CustomPropertyDefinition {
  propertyName: string;
  valueType: string;
  required: boolean;
}

interface RestCustomPropertyDefinition {
  property_name: string;
  value_type: string;
  required?: boolean;
}

export async function listCustomPropertiesSchema(
  input: ListCustomPropertiesSchemaInput,
  deps: GithubClientDeps = {},
): Promise<CustomPropertyDefinition[]> {
  const data = (await githubRest(`/orgs/${input.org}/properties/schema`, {}, deps)) as RestCustomPropertyDefinition[];
  return data.map((p) => ({ propertyName: p.property_name, valueType: p.value_type, required: p.required ?? false }));
}

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface CustomPropertyValue {
  propertyName: string;
  value: string | string[] | null;
}

interface RestCustomPropertyValue {
  property_name: string;
  value: string | string[] | null;
}

export async function getRepoCustomProperties(input: RepoRef, deps: GithubClientDeps = {}): Promise<CustomPropertyValue[]> {
  const data = (await githubRest(`/repos/${input.owner}/${input.repo}/properties/values`, {}, deps)) as RestCustomPropertyValue[];
  return data.map((p) => ({ propertyName: p.property_name, value: p.value }));
}

export interface SetRepoCustomPropertiesInput {
  org: string;
  repoNames: string[];
  properties: Array<{ propertyName: string; value: string | string[] | null }>;
  /** Must equal repoNames.length -- a bulk org-level write that can retarget
   * ruleset enforcement across every named repo, a broader blast radius
   * than any single-repo tool in this marketplace. See README's
   * "Confirm-echo contract". */
  confirmRepoCount: number;
}

export interface SetRepoCustomPropertiesResult {
  org: string;
  repoNames: string[];
}

export async function setRepoCustomProperties(
  input: SetRepoCustomPropertiesInput,
  deps: GithubClientDeps = {},
): Promise<SetRepoCustomPropertiesResult> {
  if (input.repoNames.length !== input.confirmRepoCount) {
    throw new RepoConfigError(
      'confirmation_mismatch',
      `repoNames has ${input.repoNames.length} entries but confirmRepoCount is ${input.confirmRepoCount} -- they must match to confirm this bulk write.`,
      { repoCount: input.repoNames.length, confirmRepoCount: input.confirmRepoCount },
    );
  }
  const body = {
    repository_names: input.repoNames,
    properties: input.properties.map((p) => ({ property_name: p.propertyName, value: p.value })),
  };
  await githubRest(`/orgs/${input.org}/properties/values`, { method: 'PATCH', body }, deps);
  return { org: input.org, repoNames: input.repoNames };
}
