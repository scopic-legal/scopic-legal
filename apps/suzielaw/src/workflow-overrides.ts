import type { Workflow } from '@teamsuzie/workflows';

interface NamedTool {
  name: string;
}

/**
 * The set of tool names that compete with `generate_docx` — the markdown
 * drafting flow + the template-picker tools. Live-chat smoke testing
 * (2026-05-04) showed the model otherwise reaches for `create_document`
 * → `set_outline` → `write_section` even with the workflow nudge in the
 * system prompt: the baseline prompt's "always use the drafting tools"
 * guidance is much longer than a single appended paragraph and wins on
 * volume. Filtering the alternatives out of the per-turn tool list
 * mechanically forces the choice.
 *
 * Exported (read-only) so the test fixture can assert against the same
 * list the runtime uses.
 */
export const GENERATE_DOCX_BLOCKED_TOOLS: readonly string[] = [
  // markdown-document drafting tools
  'create_document',
  'set_outline',
  'write_section',
  'append_section',
  'revise_section',
  'delete_section',
  'export_to_docx',
  // Scopic template tools (steer toward the markdown flow)
  'list_templates',
  'get_template',
];

/** Per-turn directive appended to the system prompt for `generate_docx`
 *  workflows. Tells the model to use the tool and skip the markdown
 *  drafting flow even though the baseline prompt mentions it. */
export const GENERATE_DOCX_SYSTEM_PROMPT_NUDGE =
  '\n\nThis turn is launched from a workflow that mandates a structured Word deliverable. Call the `generate_docx` tool with the section/heading/table structure the workflow describes. Do NOT inline the document in the chat or use the markdown drafting tools (create_document/write_section/export_to_docx) — those are for free-form prose. After the tool returns, include the `download_url` verbatim as a clickable link in your reply.';

export interface ApplyWorkflowOverridesInput<T extends NamedTool> {
  /** Tools after persona filtering — the per-turn working set. */
  baseTools: T[];
  /** System prompt after persona substitution + skill append. */
  baseSystemPrompt: string | undefined;
  /** The active workflow, if the request carried `workflowId` and the
   *  lookup hit. `null` for plain chat turns; the function is a no-op
   *  in that case. */
  workflow: Pick<Workflow, 'outputMode'> | null;
  /** Tools the host wires for `generate_docx` workflows (i.e. the
   *  output of `buildGenerateDocxTools(...)`). Empty array is fine
   *  when the workflow isn't `generate_docx`. */
  generateDocxTools: T[];
}

export interface ApplyWorkflowOverridesResult<T extends NamedTool> {
  tools: T[];
  systemPrompt: string | undefined;
}

/**
 * Apply per-turn overrides for the active workflow's `output_mode`. Pure
 * function — easy to unit-test in isolation; the chat handler in
 * `index.ts` calls this once after `applyPersona` filtering.
 *
 * Routing matrix:
 * - `null` workflow / `inline_chat` / `tabular_review` → pass-through.
 *   Tabular workflows don't run via /api/chat (they have their own
 *   `from-workflow` endpoint), so the "active workflow" path here is
 *   only reached on a stale id.
 * - `generate_docx` → inject the docx tools, filter out competing
 *   markdown-drafting / template tools, append the system-prompt nudge.
 */
export function applyWorkflowOverrides<T extends NamedTool>(
  input: ApplyWorkflowOverridesInput<T>,
): ApplyWorkflowOverridesResult<T> {
  const { baseTools, baseSystemPrompt, workflow, generateDocxTools } = input;
  if (!workflow || workflow.outputMode !== 'generate_docx') {
    return { tools: baseTools, systemPrompt: baseSystemPrompt };
  }
  const blocked = new Set(GENERATE_DOCX_BLOCKED_TOOLS);
  return {
    tools: [
      ...baseTools.filter((t) => !blocked.has(t.name)),
      ...generateDocxTools,
    ],
    systemPrompt:
      (baseSystemPrompt ?? '') + GENERATE_DOCX_SYSTEM_PROMPT_NUDGE,
  };
}
