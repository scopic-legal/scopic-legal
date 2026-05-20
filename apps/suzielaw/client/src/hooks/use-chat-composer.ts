import type { Dispatch, KeyboardEvent, SetStateAction } from 'react';

interface UseChatComposerOptions {
  isStreaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  text: string;
  setText: Dispatch<SetStateAction<string>>;
}

export function useChatComposer({
  isStreaming,
  onSend,
  onStop,
  text,
  setText,
}: UseChatComposerOptions) {
  const canSend = text.trim().length > 0 && !isStreaming;

  function handleSubmit() {
    if (!canSend) return;
    const next = text;
    setText('');
    onSend(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    if (isStreaming) {
      onStop();
      return;
    }
    handleSubmit();
  }

  return {
    canSend,
    handleKeyDown,
    handleSubmit,
    handleStop: onStop,
  };
}
