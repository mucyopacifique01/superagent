import { useRef, useState, type KeyboardEvent } from 'react';
import { Send, Square } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop?: () => void;
  disabled: boolean;
}

export function ChatInput({ onSend, onStop, disabled }: ChatInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  };

  return (
    <div className="px-4 md:px-6 pb-4 pt-2">
      <div className="max-w-3xl mx-auto">
        <div className="relative flex items-end gap-2 bg-[#2a2a2a] rounded-2xl border border-white/10 focus-within:border-white/20 transition-colors px-4 py-3">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder="Ask a question, paste an error, or describe a project..."
            rows={1}
            disabled={disabled}
            className="flex-1 bg-transparent text-neutral-100 text-sm placeholder:text-neutral-500 outline-none resize-none disabled:opacity-50 max-h-[200px]"
          />
          {disabled && onStop ? (
            <button
              onClick={onStop}
              className="shrink-0 h-8 px-2.5 rounded-lg bg-white/10 hover:bg-red-500/20 text-neutral-200 hover:text-red-300 flex items-center gap-1.5 text-xs font-semibold transition-colors"
              aria-label="Stop the current response"
            >
              <Square size={12} />
              Stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!text.trim() || disabled}
              className="shrink-0 w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white flex items-center justify-center transition-colors"
              aria-label="Send message"
            >
              <Send size={15} />
            </button>
          )}
        </div>
        <p className="text-[11px] text-neutral-600 text-center mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
