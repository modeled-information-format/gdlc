import { describe, it, expect } from 'vitest';
import { mockRest } from '../helpers.js';
import { listCustomPropertiesSchema, getRepoCustomProperties, setRepoCustomProperties } from '../../src/tools/custom-properties.js';

describe('listCustomPropertiesSchema', () => {
  it('maps property definitions, defaulting a missing required flag to false', async () => {
    mockRest('get', '/orgs/acme/properties/schema', [
      { property_name: 'team', value_type: 'single_select' },
      { property_name: 'cost-center', value_type: 'string', required: true },
    ]);
    const result = await listCustomPropertiesSchema({ org: 'acme' });
    expect(result).toEqual([
      { propertyName: 'team', valueType: 'single_select', required: false },
      { propertyName: 'cost-center', valueType: 'string', required: true },
    ]);
  });
});

describe('getRepoCustomProperties', () => {
  it('maps property values for a repo', async () => {
    mockRest('get', '/repos/acme/widgets/properties/values', [{ property_name: 'team', value: 'platform' }]);
    const result = await getRepoCustomProperties({ owner: 'acme', repo: 'widgets' });
    expect(result).toEqual([{ propertyName: 'team', value: 'platform' }]);
  });
});

describe('setRepoCustomProperties', () => {
  it('sets values when repoNames.length matches confirmRepoCount', async () => {
    mockRest('patch', '/orgs/acme/properties/values', {}, 204);
    const result = await setRepoCustomProperties({
      org: 'acme',
      repoNames: ['widgets', 'gadgets'],
      properties: [{ propertyName: 'team', value: 'platform' }],
      confirmRepoCount: 2,
    });
    expect(result).toEqual({ org: 'acme', repoNames: ['widgets', 'gadgets'] });
  });

  it('throws confirmation_mismatch before calling the API when the count differs', async () => {
    await expect(
      setRepoCustomProperties({
        org: 'acme',
        repoNames: ['widgets', 'gadgets'],
        properties: [{ propertyName: 'team', value: 'platform' }],
        confirmRepoCount: 1,
      }),
    ).rejects.toMatchObject({ code: 'confirmation_mismatch', details: { repoCount: 2, confirmRepoCount: 1 } });
  });
});
