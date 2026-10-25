import { User, Bot } from 'lucide-react';
import type { Message } from '@/types/chat';

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 px-4 md:px-6 py-5 ${isUser ? '' : 'bg-white/[0.02]'}`}>
      <div
        className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
          isUser
            ? 'bg-blue-600 text-white'
            : 'bg-emerald-600 text-white'
        }`}
      >
        {isUser ? <User size={16} /> : <Bot size={16} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold mb-1 text-neutral-400">
          {isUser ? 'You' : 'Assistant'}
        </p>
        <div className="text-sm text-neutral-200 leading-relaxed whitespace-pre-wrap break-words">
          {renderContent(message.content)}
        </div>
      </div>
    </div>
  );
}

function renderContent(content: string) {
  const parts = content.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
