import { apiClient } from '../api/client';

export interface ChatMessage {
  id: string;
  workspace_id: string;
  sender_id: string;
  receiver_id: string;
  body: string;
  read_at?: string | null;
  created_at: string;
}

export interface ChatConversation {
  peer_id: string;
  last_message?: ChatMessage;
  unread: number;
}

const base = (slug: string) => `/api/workspaces/${encodeURIComponent(slug)}/chat`;

export const chatService = {
  async conversations(slug: string): Promise<ChatConversation[]> {
    const { data } = await apiClient.get<ChatConversation[]>(`${base(slug)}/conversations/`);
    return data;
  },

  async messages(slug: string, peerId: string, after?: string): Promise<ChatMessage[]> {
    const qs = after ? `?after=${encodeURIComponent(after)}` : '';
    const { data } = await apiClient.get<ChatMessage[]>(
      `${base(slug)}/${encodeURIComponent(peerId)}/messages/${qs}`,
    );
    return data;
  },

  async send(slug: string, peerId: string, body: string): Promise<ChatMessage> {
    const { data } = await apiClient.post<ChatMessage>(
      `${base(slug)}/${encodeURIComponent(peerId)}/messages/`,
      { body },
    );
    return data;
  },

  async unreadCount(slug: string): Promise<number> {
    const { data } = await apiClient.get<{ total: number }>(`${base(slug)}/unread-count/`);
    return data.total;
  },
};
