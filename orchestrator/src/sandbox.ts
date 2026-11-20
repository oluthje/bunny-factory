// Daytona: one ephemeral sandbox per run, created from the warm snapshot. The sandbox holds no
// GitHub or Linear credential; the Claude token reaches it only as a Daytona Secret placeholder.
import { Daytona, type Sandbox } from "@daytonaio/sdk";
import { config } from "./config.ts";
import { asDaytona } from "./logic.ts";

let client: Daytona | undefined;
const daytona = () => (client ??= new Daytona({ apiKey: config.daytonaApiKey() }));

/**
 * Creates the run's sandbox. The run deletes it however it ends; `lifetimeMinutes`, longer than the
 * run can last, is the backstop for a run the orchestrator has lost: Daytona destroys the sandbox
 * that long after creating it, whatever its state. Auto-stop stays off: background processes such
 * as Claude don't count as activity, so it could stop a busy run.
 */
export async function createSandbox(name: string, runId: string, lifetimeMinutes: number): Promise<string> {
  const sb = await daytona().create(
    {
      snapshot: config.snapshot(),
      name,
      autoStopInterval: 0,
      ttlMinutes: lifetimeMinutes,
      labels: { purpose: "factory", owner: "oscar", run: runId },
      secrets: { CLAUDE_CODE_OAUTH_TOKEN: config.claudeSecret },
    },
    { timeout: 300 },
  );
  return sb.id;
}

export async function getSandbox(id: string): Promise<Sandbox> {
  return daytona().get(id);
}

/** Every factory sandbox, with the run it was made for. Includes another orchestrator's, if one shares the account. */
export async function listFactorySandboxes(): Promise<{ id: string; name: string; runId: string | undefined }[]> {
  const found: { id: string; name: string; runId: string | undefined }[] = [];
  for await (const sb of daytona().list({ labels: { purpose: "factory", owner: "oscar" } })) {
    found.push({ id: sb.id, name: sb.name, runId: sb.labels?.run });
  }
  return found;
}

/** Deletes the sandbox; a sandbox that is already gone counts as deleted. */
export async function deleteSandbox(id: string): Promise<void> {
  let sb: Sandbox;
  try {
    sb = await daytona().get(id);
  } catch {
    return;
  }
  await sb.delete(120);
}

/** Runs a command as the daytona user and fails on a non-zero exit. */
export async function sh(sb: Sandbox, cmd: string, timeoutSec = 300): Promise<string> {
  const res = await sb.process.executeCommand(asDaytona(cmd), undefined, undefined, timeoutSec);
  if (res.exitCode !== 0) {
    throw new Error(`sandbox command failed (exit ${res.exitCode}): ${cmd}\n${res.result.slice(-4000)}`);
  }
  return res.result;
}

/** Uploads a file and hands it to the daytona user (uploads land as root). */
export async function upload(sb: Sandbox, local: string | Buffer, remote: string): Promise<void> {
  const dir = remote.slice(0, remote.lastIndexOf("/"));
  await sb.process.executeCommand(`mkdir -p ${dir} && chown -R daytona:daytona ${dir}`);
  if (typeof local === "string") await sb.fs.uploadFile(local, remote, 1800);
  else await sb.fs.uploadFile(local, remote, 1800);
  await sb.process.executeCommand(`chown daytona:daytona ${remote}`);
}

export async function download(sb: Sandbox, remote: string, local: string): Promise<void> {
  await sb.fs.downloadFile(remote, local, 1800);
}

/**
 * Starts a long command in its own background session, writing its output to a log file.
 * Returns the command id; poll it with `exitCodeOf`.
 */
export async function startBackground(sb: Sandbox, sessionId: string, cmd: string): Promise<string> {
  await sb.process.createSession(sessionId);
  const res = await sb.process.executeSessionCommand(sessionId, { command: asDaytona(cmd), runAsync: true });
  if (!res.cmdId) throw new Error(`no command id for session ${sessionId}`);
  return res.cmdId;
}

/** The exit code, or null while the command is still running. */
export async function exitCodeOf(sb: Sandbox, sessionId: string, cmdId: string): Promise<number | null> {
  const c = await sb.process.getSessionCommand(sessionId, cmdId);
  return c.exitCode ?? null;
}
