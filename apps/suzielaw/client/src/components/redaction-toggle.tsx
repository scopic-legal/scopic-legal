import { Button, EyeOff, cn } from '@teamsuzie/ui';

interface RedactionToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function RedactionToggle({
  enabled,
  onChange,
  disabled,
  className,
}: RedactionToggleProps) {
  return (
    <Button
      type="button"
      variant={enabled ? 'outline' : 'ghost'}
      size="sm"
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      className={cn('h-8 gap-1.5 px-2 text-xs', className)}
      aria-pressed={enabled}
      aria-label="Toggle context redaction"
      title={enabled ? 'Redaction guard is on' : 'Redaction guard is off'}
    >
      <EyeOff className="size-4" aria-hidden />
      <span>{enabled ? 'Redact' : 'Raw'}</span>
    </Button>
  );
}
