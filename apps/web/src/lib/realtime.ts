import { apiClient } from '../api/client';

/**
 * Realtime inbox events over Server-Sent Events (GET /api/events/).
 *
 * One shared EventSource per tab. Subscribers are told *that* something
 * changed and refetch; the stream carries no payload they must trust.
 * `emitLocal('badge')` lets in-page actions (mark read) refresh the sidebar
 * badge instantly without waiting for the next server event.
 */
/** 'badge' is local-only: unread counts changed (e.g. marked read) — refresh counters, not lists. */
export type InboxEventType = 'notification' | 'chat' | 'badge' | 'poker';
export interface InboxEvent {
  type: InboxEventType;
  workspace_id?: string;
  peer_id?: string;
  /** Set for 'poker' events: the work item whose planning poker changed. */
  issue_id?: string;
}
type Handler = (e: InboxEvent) => void;

const handlers = new Set<Handler>();
let source: EventSource | null = null;

function base(): string {
  return (apiClient.defaults.baseURL ?? '').replace(/\/$/, '');
}

function ensureOpen() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource(`${base()}/api/events/`, { withCredentials: true });
  const forward = (type: InboxEventType) => (ev: MessageEvent<string>) => {
    let data: InboxEvent = { type };
    try {
      data = { ...JSON.parse(ev.data), type };
    } catch {
      /* hint only */
    }
    handlers.forEach((h) => h(data));
  };
  source.addEventListener('notification', forward('notification') as EventListener);
  source.addEventListener('chat', forward('chat') as EventListener);
  source.addEventListener('poker', forward('poker') as EventListener);
  // After a reconnect we may have missed events: tell everyone to refetch.
  source.onopen = () => {
    handlers.forEach((h) => h({ type: 'notification' }));
    handlers.forEach((h) => h({ type: 'chat' }));
    handlers.forEach((h) => h({ type: 'poker' }));
  };
}

function closeIfIdle() {
  if (handlers.size === 0 && source) {
    source.close();
    source = null;
  }
}

/** Subscribe to inbox events; returns an unsubscribe function. */
export function subscribeInbox(handler: Handler): () => void {
  handlers.add(handler);
  ensureOpen();
  return () => {
    handlers.delete(handler);
    closeIfIdle();
  };
}

/** Notify in-page subscribers that inbox state changed locally. */
export function emitLocal(type: InboxEventType) {
  handlers.forEach((h) => h({ type }));
}
