/** Structured tool-call error. Every failure mode named in the feature spec's
 * Edge Cases section gets one of these codes, never a raw GraphQL/REST error
 * surfaced verbatim to the caller. */
export class PlanningError extends Error {
    code;
    details;
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'PlanningError';
        this.code = code;
        this.details = details;
    }
    toJSON() {
        return { error: this.code, message: this.message, ...this.details };
    }
}
export function isPlanningError(err) {
    return err instanceof PlanningError;
}
//# sourceMappingURL=errors.js.map