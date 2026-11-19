// Paths on the runner, shared by the engine and every task. Pure constants: no I/O.
export const HOME = "/home/daytona";
/** What the factory uploads for the run: bundles, the prompt, the extract prompt, the pass's schema. */
export const RUN_DIR = `${HOME}/run`;
/** What the run leaves behind: logs, the files the agent writes, evidence. Collected after every run. */
export const ARTIFACTS = `${HOME}/artifacts`;
/** Screenshots and recordings; the Playwright MCP server writes here. */
export const EVIDENCE_DIR = `${ARTIFACTS}/evidence`;

/** A file the agent writes for the factory to read back, such as `pr-body.md`. */
export const artifact = (name: string) => `${ARTIFACTS}/${name}`;
