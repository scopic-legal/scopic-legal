import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RedactionService,
  shouldRedactForRequest,
} from '../redaction.js';

describe('redaction policy', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('masks local legal and PII recognizer findings', async () => {
    const service = new RedactionService({ scoreThreshold: 0.55 });

    const result = await service.redactText(
      'Email jane.partner@example.com about SSN 123-45-6789 and case no. 24-CV-1024.',
    );

    expect(result.text).not.toContain('jane.partner@example.com');
    expect(result.text).not.toContain('123-45-6789');
    expect(result.text).toContain('[EMAIL REDACTED]');
    expect(result.text).toContain('[SSN REDACTED]');
    expect(result.text).toContain('[CASE NUMBER REDACTED]');
    expect(result.summary.byType.EMAIL_ADDRESS).toBe(1);
    expect(result.summary.byType.US_SSN).toBe(1);
    expect(result.summary.byType.CASE_NUMBER).toBe(1);
  });

  it('masks common client and attorney names without Presidio', async () => {
    const service = new RedactionService({ scoreThreshold: 0.55 });

    const result = await service.redactText(
      'Jane Doe emailed jane@example.com. Attorney John Q. Public signed. Client: Mary Smith called.',
    );

    expect(result.text).not.toContain('Jane Doe');
    expect(result.text).not.toContain('John Q. Public');
    expect(result.text).not.toContain('Mary Smith');
    expect(result.text).toContain('[PERSON REDACTED] emailed [EMAIL REDACTED].');
    expect(result.summary.byType.PERSON).toBe(3);
  });

  it('masks corporate party names without Presidio', async () => {
    const service = new RedactionService({ scoreThreshold: 0.55 });

    const result = await service.redactText(
      'This Mutual Non-Disclosure Agreement is between Amdocs Development Limited, with offices located at 1 Main Street, and the Company.',
    );

    expect(result.text).not.toContain('Amdocs Development Limited');
    expect(result.text).toContain('[PARTY REDACTED]');
    expect(result.summary.byType.ORGANIZATION).toBe(1);
  });
  it('masks legal-context human party names without Presidio', async () => {
    const service = new RedactionService({ scoreThreshold: 0.55 });

    const result = await service.redactText(
      'This settlement agreement is by and between Jane Doe, an individual, and John Q. Public, residing at 123 Main Street.',
    );

    expect(result.text).not.toContain('Jane Doe');
    expect(result.text).not.toContain('John Q. Public');
    expect(result.text).toContain('[PERSON REDACTED]');
    expect(result.summary.byType.PERSON).toBe(2);
  });

  it('combines Presidio analyzer findings with local recognizers', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify([
          { entity_type: 'PERSON', start: 0, end: 8, score: 0.91 },
          { entity_type: 'ORGANIZATION', start: 17, end: 29, score: 0.88 },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as typeof fetch;
    const service = new RedactionService({
      analyzerUrl: 'http://localhost:5002',
      scoreThreshold: 0.55,
    });

    const result = await service.redactText('Jane Doe emailed Acme Limited at jane@example.com.');

    expect(result.text).toBe('[PERSON REDACTED] emailed [PARTY REDACTED] at [EMAIL REDACTED].');
    expect(result.provider).toBe('hybrid');
    expect(result.summary.bySource.presidio).toBe(2);
    expect(result.summary.bySource.local).toBe(1);
  });

  it('redacts automatically only for remote model targets', () => {
    expect(
      shouldRedactForRequest({
        configuredMode: 'auto',
        targetBaseUrl: 'https://api.openai.com',
      }),
    ).toBe(true);
    expect(
      shouldRedactForRequest({
        configuredMode: 'auto',
        targetBaseUrl: 'http://localhost:11434',
      }),
    ).toBe(false);
    expect(
      shouldRedactForRequest({
        configuredMode: 'always',
        requestedMode: 'off',
        targetBaseUrl: 'https://api.openai.com',
      }),
    ).toBe(true);
  });
});
