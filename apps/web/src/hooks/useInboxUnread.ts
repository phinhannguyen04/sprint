import { useEffect, useState } from 'react';
import { notificationService } from '../services/notificationService';
import { chatService } from '../services/chatService';
import { subscribeInbox } from '../lib/realtime';

// Realtime events drive updates; this slow poll is only a safety net.
const POLL_MS = 60_000;

/**
 * Total unread inbox items (notifications + chat messages) for a workspace.
 * Polls while the tab is visible and refreshes immediately on refocus.
 */
export function useInboxUnread(workspaceSlug: string | undefined): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!workspaceSlug) return;
    let cancelled = false;

    const refresh = () => {
      if (document.hidden) return;
      Promise.all([
        notificationService.unreadCount(workspaceSlug).then((c) => c.total),
        chatService.unreadCount(workspaceSlug).catch(() => 0),
      ])
        .then(([n, c]) => {
          if (!cancelled) setCount(n + c);
        })
        .catch(() => {});
    };

    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    document.addEventListener('visibilitychange', refresh);
    const unsubscribe = subscribeInbox((e) => {
      if (e.type !== 'poker') refresh();
    });
    return () => {
      unsubscribe();
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [workspaceSlug]);

  return workspaceSlug ? count : 0;
}
