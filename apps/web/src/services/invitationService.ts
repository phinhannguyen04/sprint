import { apiClient } from '../api/client';
import type { InviteByTokenResponse } from '../api/types';

/** A pending workspace invitation addressed to the signed-in user. */
export interface MyInvitation {
  id: string;
  workspace_id: string;
  email: string;
  token: string;
  role: number;
  accepted: boolean;
  created_at: string;
}

/**
 * Public invitation APIs (no auth required).
 */
export const invitationService = {
  /** Pending invitations for the signed-in user. GET /api/users/me/workspaces/invitations/ */
  async listMine(): Promise<MyInvitation[]> {
    const { data } = await apiClient.get<MyInvitation[]>('/api/users/me/workspaces/invitations/');
    return (data ?? []).filter((i) => !i.accepted);
  },

  /**
   * Get invite details by token for the invite landing page.
   * GET /api/invitations/by-token/?token=...
   */
  async getByToken(token: string): Promise<InviteByTokenResponse> {
    const { data } = await apiClient.get<InviteByTokenResponse>('/api/invitations/by-token/', {
      params: { token },
    });
    return data;
  },

  /**
   * Decline (ignore) an invitation by token.
   * POST /api/invitations/decline/
   */
  async declineByToken(token: string): Promise<void> {
    await apiClient.post('/api/invitations/decline/', { token });
  },
};
