import { githubRest } from '../github-client.js';
export async function createMilestone(input, deps = {}) {
    const body = { title: input.title };
    if (input.description !== undefined)
        body.description = input.description;
    if (input.dueOn !== undefined)
        body.due_on = input.dueOn;
    if (input.state !== undefined)
        body.state = input.state;
    const data = (await githubRest(`/repos/${input.owner}/${input.repo}/milestones`, { method: 'POST', body }, deps));
    return { number: data.number, title: data.title, url: data.html_url };
}
export async function listMilestones(input, deps = {}) {
    const state = input.state ?? 'open';
    const data = (await githubRest(`/repos/${input.owner}/${input.repo}/milestones?state=${state}`, {}, deps));
    return data.map((m) => ({ number: m.number, title: m.title, url: m.html_url }));
}
export async function assignMilestone(input, deps = {}) {
    await githubRest(`/repos/${input.owner}/${input.repo}/issues/${input.issueNumber}`, { method: 'PATCH', body: { milestone: input.milestoneNumber } }, deps);
    return { issueNumber: input.issueNumber, milestoneNumber: input.milestoneNumber };
}
//# sourceMappingURL=milestones.js.map