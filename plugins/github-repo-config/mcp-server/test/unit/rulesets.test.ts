import { describe, it, expect } from 'vitest';
import { mockRest } from '../helpers.js';
import { listRepoRulesets, getRepoRuleset } from '../../src/tools/rulesets.js';

describe('listRepoRulesets', () => {
  it('maps ruleset summaries', async () => {
    mockRest('get', '/repos/acme/widgets/rulesets', [{ id: 1, name: 'main protection', target: 'branch', enforcement: 'active' }]);
    const result = await listRepoRulesets({ owner: 'acme', repo: 'widgets' });
    expect(result).toEqual([{ id: 1, name: 'main protection', target: 'branch', enforcement: 'active' }]);
  });
});

describe('getRepoRuleset', () => {
  it('maps bypass actors, defaulting a missing list to empty', async () => {
    mockRest('get', '/repos/acme/widgets/rulesets/1', { id: 1, name: 'main protection', target: 'branch', enforcement: 'active' });
    const result = await getRepoRuleset({ owner: 'acme', repo: 'widgets', rulesetId: 1 });
    expect(result).toEqual({ id: 1, name: 'main protection', target: 'branch', enforcement: 'active', bypassActors: [] });
  });

  it('maps present bypass actors', async () => {
    mockRest('get', '/repos/acme/widgets/rulesets/2', {
      id: 2,
      name: 'tag protection',
      target: 'tag',
      enforcement: 'active',
      bypass_actors: [{ actor_id: 5, actor_type: 'Team', bypass_mode: 'always' }],
    });
    const result = await getRepoRuleset({ owner: 'acme', repo: 'widgets', rulesetId: 2 });
    expect(result.bypassActors).toEqual([{ actorId: 5, actorType: 'Team', bypassMode: 'always' }]);
  });
});
