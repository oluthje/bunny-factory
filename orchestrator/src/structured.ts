// Structured output from a resumed Claude Code session (`claude -p --resume … --json-schema`).
// Pure: no I/O. Used by the review's extraction pass and implement's reply pass.
import { z } from "zod/v4";

/**
 * The JSON Schema handed to `claude --json-schema`: the zod schema is the one place the shape lives.
 * Without the `$schema` key zod adds: Claude Code rejects the whole schema over the draft 2020-12 URL.
 */
export function toCliJsonSchema(schema: z.ZodType): string {
  const { $schema: _, ...json } = z.toJSONSchema(schema);
  return JSON.stringify(json);
}

/**
 * The structured output from a pass's `claude --output-format json` result, validated again here:
 * the CLI checks the shape, and this also catches a missing or garbled result.
 * `pass` names the pass in errors ("The extraction pass"), `noun` what it returns ("comments").
 */
export function parseStructuredOutput<T>(
  resultJson: string,
  schema: z.ZodType<T>,
  names: { pass: string; noun: string },
  stderr = "",
): { ok: true; value: T } | { ok: false; error: string } {
  const { pass, noun } = names;
  if (!resultJson.trim()) {
    const why = stderr.trim().slice(0, 500);
    return { ok: false, error: why ? `${pass} wrote no result: ${why}` : `${pass} wrote no result.` };
  }
  let result: unknown;
  try {
    result = JSON.parse(resultJson);
  } catch {
    return { ok: false, error: `${pass}'s result is not JSON.` };
  }
  const { structured_output: output, subtype } = (result ?? {}) as { structured_output?: unknown; subtype?: unknown };
  if (output === undefined) {
    return { ok: false, error: `${pass} returned no structured output${typeof subtype === "string" ? ` (${subtype})` : ""}.` };
  }
  const parsed = schema.safeParse(output);
  if (!parsed.success) return { ok: false, error: `${pass}'s ${noun} are invalid: ${z.prettifyError(parsed.error)}` };
  return { ok: true, value: parsed.data };
}

/** Extra attempts after the first, each fed the last attempt's error. */
export const STRUCTURED_RETRIES = 2;

/** The prompt for a retried pass: the same session, told what was wrong with its last answer. */
export function structuredRetryPrompt(error: string, ask: string): string {
  return [
    "Your last answer couldn't be used:",
    "",
    error,
    "",
    `${ask} Answer from what you have already read, with no tool calls.`,
  ].join("\n");
}
