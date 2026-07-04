import { describe, it, expect } from 'vitest';
import { mockRest } from '../helpers.js';
import { getCommunityProfile } from '../../src/tools/community-profile.js';

describe('getCommunityProfile', () => {
  it('maps present and absent files to booleans', async () => {
    mockRest('get', '/repos/acme/widgets/community/profile', {
      health_percentage: 75,
      description: 'A widget factory',
      files: {
        readme: { url: 'https://example.com/readme' },
        license: null,
        contributing: { url: 'https://example.com/contributing' },
        code_of_conduct: null,
        issue_template: null,
        pull_request_template: null,
      },
    });
    const result = await getCommunityProfile({ owner: 'acme', repo: 'widgets' });
    expect(result).toEqual({
      healthPercentage: 75,
      description: 'A widget factory',
      hasReadme: true,
      hasLicense: false,
      hasContributing: true,
      hasCodeOfConduct: false,
      hasIssueTemplate: false,
      hasPullRequestTemplate: false,
    });
  });
});
