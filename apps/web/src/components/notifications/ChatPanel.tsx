import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Button } from '../ui';
import { useAuth } from '../../contexts/AuthContext';
import { chatService, type ChatConversation, type ChatMessage } from '../../services/chatService';
import { workspaceService } from '../../services/workspaceService';
import { emitLocal, subscribeInbox } from '../../lib/realtime';
import type { WorkspaceMemberApiResponse } from '../../api/types';

// Realtime events drive updates; polling is only a safety net.
const POLL_MS = 30_000;

function memberName(m?: WorkspaceMemberApiResponse): string {
  return m?.member_display_name || m?.member_email || 'Unknown';
}

/** Lowercase + strip diacritics so "nguyen" finds "Nguyễn". */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase();
}

function useMembers(workspaceSlug: string) {
  const [members, setMembers] = useState<Map<string, WorkspaceMemberApiResponse>>(new Map());
  useEffect(() => {
    let cancelled = false;
    workspaceService
      .listMembers(workspaceSlug)
      .then((list) => {
        if (!cancelled) setMembers(new Map(list.map((m) => [m.member_id, m])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug]);
  return members;
}

/** Left column: people you can chat with, with unread counts. */
export function ChatList({
  workspaceSlug,
  selectedPeerId,
  onSelect,
}: {
  workspaceSlug: string;
  selectedPeerId: string | null;
  onSelect: (peerId: string) => void;
}) {
  const { t } = useTranslation();
  const members = useMembers(workspaceSlug);
  const [items, setItems] = useState<ChatConversation[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      chatService
        .conversations(workspaceSlug)
        .then((list) => {
          if (!cancelled) setItems(list);
        })
        .catch(() => {});
    void load();
    const id = window.setInterval(load, POLL_MS);
    const unsubscribe = subscribeInbox((e) => {
      if (e.type === 'chat' || e.type === 'badge') void load();
    });
    return () => {
      cancelled = true;
      window.clearInterval(id);
      unsubscribe();
    };
  }, [workspaceSlug]);

  const [query, setQuery] = useState('');
  const q = norm(query.trim());
  const visible = q
    ? items.filter((c) => {
        const m = members.get(c.peer_id);
        return norm(`${memberName(m)} ${m?.member_email ?? ''}`).includes(q);
      })
    : items;

  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-(--border-subtle) bg-(--bg-canvas) p-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('chat.searchPeople', 'Search people…')}
          aria-label={t('chat.searchPeople', 'Search people…')}
          className="block w-full rounded border border-(--border-subtle) bg-(--bg-surface-1) px-2.5 py-1.5 text-sm text-(--txt-primary) focus:border-(--border-strong) focus:outline-none"
        />
      </div>
      {visible.length === 0 ? (
        <div className="p-6 text-sm text-(--txt-tertiary)">
          {items.length === 0
            ? t('chat.noMembers', 'No other members in this workspace yet.')
            : t('chat.noResults', 'No one matches "{{query}}".', { query: query.trim() })}
        </div>
      ) : (
        <ul className="divide-y divide-(--border-subtle)">
          {visible.map((c) => {
            const m = members.get(c.peer_id);
            const name = memberName(m);
            const selected = selectedPeerId === c.peer_id;
            return (
              <li key={c.peer_id}>
                <button
                  type="button"
                  onClick={() => onSelect(c.peer_id)}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-(--bg-layer-1-hover) ${
                    selected ? 'bg-(--bg-layer-1)' : ''
                  }`}
                >
                  <Avatar name={name} src={m?.member_avatar} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-(--txt-primary)">
                      {name}
                    </span>
                    <span className="block truncate text-xs text-(--txt-tertiary)">
                      {c.last_message?.body ??
                        m?.member_email ??
                        t('chat.startConversation', 'Start a conversation')}
                    </span>
                  </span>
                  {c.unread > 0 ? (
                    <span className="rounded-full bg-(--brand-default) px-1.5 py-0.5 text-[11px] font-semibold text-white">
                      {c.unread}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Right pane: the message thread with one person (polls for new messages). */
export function ChatThread({ workspaceSlug, peerId }: { workspaceSlug: string; peerId: string }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const members = useMembers(workspaceSlug);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastRef = useRef<string | undefined>(undefined);

  const merge = useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const next = [...prev, ...incoming.filter((m) => !seen.has(m.id))];
      lastRef.current = next[next.length - 1]?.created_at;
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    lastRef.current = undefined;
    const load = () =>
      chatService
        .messages(workspaceSlug, peerId, lastRef.current)
        .then((list) => {
          if (!cancelled) merge(list);
        })
        .catch(() => {});
    void load().then(() => emitLocal('badge'));
    const id = window.setInterval(load, POLL_MS);
    // Pushed message from this peer (or from my other tab): fetch right away.
    const unsubscribe = subscribeInbox((e) => {
      if (e.type === 'chat' && (!e.peer_id || e.peer_id === peerId)) {
        void load().then(() => emitLocal('badge'));
      }
    });
    return () => {
      cancelled = true;
      window.clearInterval(id);
      unsubscribe();
    };
  }, [workspaceSlug, peerId, merge]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const onSend = async (e: FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    try {
      const m = await chatService.send(workspaceSlug, peerId, body);
      merge([m]);
      setDraft('');
    } catch {
      setError(t('chat.sendFailed', 'Could not send message.'));
    } finally {
      setSending(false);
    }
  };

  const name = memberName(members.get(peerId));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-(--border-subtle) px-6 py-3">
        <Avatar name={name} src={members.get(peerId)?.member_avatar} size="md" />
        <h2 className="text-sm font-semibold text-(--txt-primary)">{name}</h2>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-6 py-4">
        {messages.length === 0 ? (
          <p className="text-sm text-(--txt-tertiary)">
            {t('chat.empty', 'No messages yet. Say hello!')}
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === user?.id;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[70%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm ${
                    mine
                      ? 'bg-(--brand-default) text-white'
                      : 'bg-(--bg-layer-2) text-(--txt-primary)'
                  }`}
                >
                  {m.body}
                  <div
                    className={`mt-1 text-[10px] ${mine ? 'text-white/70' : 'text-(--txt-tertiary)'}`}
                  >
                    {new Date(m.created_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={onSend} className="shrink-0 border-t border-(--border-subtle) px-6 py-3">
        {error ? <p className="mb-2 text-xs text-(--txt-danger-primary)">{error}</p> : null}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void onSend(e as unknown as FormEvent);
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder={t('chat.placeholder', 'Write a message… (Enter to send)')}
            className="block w-full resize-none rounded border border-(--border-subtle) bg-(--bg-surface-1) px-2.5 py-1.5 text-sm text-(--txt-primary) focus:border-(--border-strong) focus:outline-none"
          />
          <Button type="submit" size="sm" disabled={sending || !draft.trim()}>
            {t('chat.send', 'Send')}
          </Button>
        </div>
      </form>
    </div>
  );
}
