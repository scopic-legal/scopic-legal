/**
 * Hard-coded starter prompts shown on the assistant's empty-state.
 * These are intentionally inline (rather than pulled from
 * `/api/workflows`) so the greeting renders synchronously and the
 * starter cards never flicker on first paint. The full library lives
 * server-side in `apps/suzielaw/src/data/prompts.ts`; revisit if we
 * find users editing these to match their day-to-day shortcuts.
 */
export interface StarterPrompt {
  title: string;
  subtitle: string;
  prompt: string;
  requiresAttachment?: boolean;
}

export const ASSISTANT_STARTERS: StarterPrompt[] = [
  {
    title: 'Draft email from notes',
    subtitle: 'Turn loose notes into a polished email to opposing counsel or a client.',
    prompt:
      "I'll paste notes (or attach a document with notes — convert_to_markdown first if so). Draft a professional email from them: concise, neutral, request specific next steps where appropriate. Return the email body inline as markdown — no DOCX export needed unless I ask.",
  },
  {
    title: 'Summarize document',
    subtitle: 'Read a contract, brief, or memo and pull the structure into bullet points.',
    requiresAttachment: true,
    prompt:
      "I'll attach a document (convert_to_markdown if it's a binary). Read the full document, then return: (1) a one-paragraph summary, (2) a bulleted outline of the main sections, (3) any obligations, deadlines, or numerical terms worth flagging. Use citations when quoting exact language.",
  },
  {
    title: 'Arbitration timeline',
    subtitle: 'Build a chronology of events from a case file.',
    requiresAttachment: true,
    prompt:
      "I'll attach one or more documents from a dispute (convert_to_markdown each). Build a chronological timeline of every dated event mentioned across them, in markdown table form: | Date | Event | Source |. Group by month if the file spans years. Cite the source doc + section for each row.",
  },
  {
    title: 'Extract change-of-control terms',
    subtitle: 'Find the change-of-control clause in a contract and summarize the trigger.',
    requiresAttachment: true,
    prompt:
      "I'll attach a contract (convert_to_markdown). Find the change-of-control clause (or note its absence). Tell me: which party holds the right (consent / termination / acceleration), what events trigger it (e.g. internal reorganizations carved out?), and any notice / cure periods. Quote the operative sentence verbatim with a citation.",
  },
];
