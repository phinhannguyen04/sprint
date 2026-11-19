import { apiClient } from '../api/client';
import type { NotificationApiResponse, UnreadCountResponse } from '../api/types';
import { emitLocal } from '../lib/realtime';

export interface NotificationListOpts {
  unreadOnly?: boolean;
  mentionsOnly?: boolean;
  /** 'inbox' (default) hides archived; 'archived' shows only archived; 'all' includes both. */
  archived?: 'inbox' | 'archived' | 'all';
}

export const notificationService = {
  async list(
    workspaceSlug: string,
    opts: NotificationListOpts = {},
  ): Promise<NotificationApiResponse[]> {
    const params = new URLSearchParams();
    if (opts.unreadOnly) params.set('unread_only', 'true');
    if (opts.mentionsOnly) params.set('mentions', 'true');
    if (opts.archived === 'archived') params.set('archived', 'true');
    if (opts.archived === 'all') params.set('archived', 'all');
    const qs = params.toString() ? `?${params.toString()}` : '';
    const { data } = await apiClient.get<NotificationApiResponse[]>(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/notifications/${qs}`,
    );
    return data;
  },

  async unreadCount(workspaceSlug: string): Promise<UnreadCountResponse> {
    const { data } = await apiClient.get<UnreadCountResponse>(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/notifications/unread-count/`,
    );
    return data;
  },

  async markRead(workspaceSlug: string, notificationId: string): Promise<void> {
    await apiClient.post(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/notifications/${encodeURIComponent(notificationId)}/read/`,
    );
    emitLocal('badge');
  },

  async markUnread(workspaceSlug: string, notificationId: string): Promise<void> {
    await apiClient.delete(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/notifications/${encodeURIComponent(notificationId)}/read/`,
    );
    emitLocal('badge');
  },

  async markAllRead(workspaceSlug: string): Promise<void> {
    await apiClient.post(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/notifications/mark-all-read/`,
    );
    emitLocal('badge');
  },

  async archive(workspaceSlug: string, notificationId: string): Promise<void> {
    await apiClient.post(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/notifications/${encodeURIComponent(notificationId)}/archive/`,
    );
    emitLocal('badge');
  },

  async unarchive(workspaceSlug: string, notificationId: string): Promise<void> {
    await apiClient.delete(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/notifications/${encodeURIComponent(notificationId)}/archive/`,
    );
    emitLocal('badge');
  },

  async snooze(workspaceSlug: string, notificationId: string, until: Date): Promise<void> {
    await apiClient.post(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/notifications/${encodeURIComponent(notificationId)}/snooze/`,
      { until: until.toISOString() },
    );
    emitLocal('badge');
  },

  async unsnooze(workspaceSlug: string, notificationId: string): Promise<void> {
    await apiClient.delete(
      `/api/workspaces/${encodeURIComponent(workspaceSlug)}/notifications/${encodeURIComponent(notificationId)}/snooze/`,
    );
    emitLocal('badge');
  },
};
