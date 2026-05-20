type ReviewCellFormat = 'text' | 'short_text' | 'date' | 'yes_no' | 'bullets' | 'money';

const VALID_FORMATS = new Set<ReviewCellFormat>([
  'text',
  'short_text',
  'date',
  'yes_no',
  'bullets',
  'money',
]);

export async function draftColumnPrompt(
  title: string,
  opts: {
    baseUrl: string;
    apiKey?: string;
    model: string;
    extraBody?: Record<string, unknown>;
    formatHint?: ReviewCellFormat;
    formatLocked?: boolean;
  },
): Promise<{ prompt: string; format: ReviewCellFormat }> {
  const fallback = fallbackDraft(title, opts.formatHint);
  try {
    const response = await fetch(`${opts.baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [
          {
            role: 'system',
            content:
              'Draft a legal document-review column prompt. Return compact JSON with keys "prompt" and "format". Valid formats: text, short_text, date, yes_no, bullets, money.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              title,
              formatHint: opts.formatHint,
              formatLocked: opts.formatLocked,
            }),
          },
        ],
        temperature: 0.2,
        max_tokens: 220,
        ...(opts.extraBody ?? {}),
      }),
    });
    if (!response.ok) return fallback;
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    const parsed = parseJsonObject(content);
    const prompt =
      typeof parsed?.prompt === 'string' && parsed.prompt.trim()
        ? parsed.prompt.trim()
        : fallback.prompt;
    const parsedFormat = typeof parsed?.format === 'string' ? parsed.format : '';
    const format =
      opts.formatLocked && opts.formatHint
        ? opts.formatHint
        : VALID_FORMATS.has(parsedFormat as ReviewCellFormat)
          ? (parsedFormat as ReviewCellFormat)
          : fallback.format;
    return { prompt, format };
  } catch {
    return fallback;
  }
}

function fallbackDraft(
  title: string,
  formatHint?: ReviewCellFormat,
): { prompt: string; format: ReviewCellFormat } {
  const cleanTitle = title.trim() || 'this item';
  return {
    prompt: `Review the document and answer the "${cleanTitle}" column. Cite the specific clause, section, or paragraph that supports the answer. If the document does not contain the information, say so plainly.`,
    format: formatHint ?? 'text',
  };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
