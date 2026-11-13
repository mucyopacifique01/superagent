import type { ReactNode } from 'react';
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
          isUser ? 'bg-blue-600 text-white' : 'bg-emerald-600 text-white'
        }`}
      >
        {isUser ? <User size={16} /> : <Bot size={16} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold mb-1 text-neutral-400">
          {isUser ? 'You' : 'Assistant'}
        </p>
        <div className="text-sm text-neutral-200 leading-relaxed break-words space-y-2">
          {isUser ? <p className="whitespace-pre-wrap">{message.content}</p> : renderMarkdown(message.content)}
        </div>
      </div>
    </div>
  );
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={key} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={key} className="px-1.5 py-0.5 rounded bg-white/10 text-[13px] text-emerald-300">
          {part.slice(1, -1)}
        </code>
      );
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      return (
        <a
          key={key}
          href={link[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
        >
          {link[1]}
        </a>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

function renderMarkdown(content: string): ReactNode {
  const nodes: ReactNode[] = [];
  const fence = /```([a-zA-Z0-9+#-]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let block = 0;

  while ((match = fence.exec(content)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(...renderText(content.slice(lastIndex, match.index), `b${block++}`));
    }
    nodes.push(
      <pre
        key={`code-${block++}`}
        className="rounded-lg bg-black/40 border border-white/10 px-3 py-2 overflow-x-auto text-[12.5px] text-neutral-200"
      >
        <code>{match[2].replace(/\n$/, '')}</code>
      </pre>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    nodes.push(...renderText(content.slice(lastIndex), `b${block++}`));
  }

  return <>{nodes}</>;
}

function renderText(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = text.split('\n');
  let list: { ordered: boolean; items: string[] } | null = null;
  let counter = 0;

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={`${keyPrefix}-li-${i}`}>{renderInline(item, `${keyPrefix}-li-${i}`)}</li>);
    out.push(
      list.ordered ? (
        <ol key={`${keyPrefix}-ol-${counter++}`} className="list-decimal pl-5 space-y-1">
          {items}
        </ol>
      ) : (
        <ul key={`${keyPrefix}-ul-${counter++}`} className="list-disc pl-5 space-y-1">
          {items}
        </ul>
      ),
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);

    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const value = (bullet?.[1] ?? numbered?.[1]) ?? '';
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(value);
      continue;
    }

    flushList();

    if (line.trim() === '') {
      out.push(<div key={`${keyPrefix}-sp-${counter++}`} className="h-1" />);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const size = level <= 2 ? 'text-base' : 'text-sm';
      out.push(
        <p key={`${keyPrefix}-h-${counter++}`} className={`${size} font-semibold text-white pt-1`}>
          {renderInline(heading[2], `${keyPrefix}-h-${counter}`)}
        </p>,
      );
      continue;
    }

    out.push(
      <p key={`${keyPrefix}-p-${counter++}`}>{renderInline(line, `${keyPrefix}-p-${counter}`)}</p>,
    );
  }

  flushList();
  return out;
}
