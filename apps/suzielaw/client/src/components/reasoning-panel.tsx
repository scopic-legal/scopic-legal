import { MarkdownMessage, cn } from '@teamsuzie/ui';

interface ReasoningPanelProps {
  text: string;
  active: boolean;
  className?: string;
}

export function ReasoningPanel({ text, active, className }: ReasoningPanelProps) {
  if (!text.trim()) return null;

  return (
    <details
      open={active}
      className={cn(
        'w-full border border-foreground/10 bg-muted/50 px-3 py-2 text-sm text-foreground/75',
        className,
      )}
    >
      <summary className="cursor-pointer select-none font-mono text-[10px] uppercase tracking-[0.12em] text-foreground/50">
        {active ? 'Thinking' : 'Thought'}
      </summary>
      <div className="mt-2 max-h-80 overflow-y-auto pr-1 text-[13px] leading-relaxed text-foreground/65">
        <MarkdownMessage content={text} />
      </div>
    </details>
  );
}
