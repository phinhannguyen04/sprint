import { apiClient } from '../api/client';

export type PokerStatus = 'voting' | 'revealed' | 'finalized' | 'discarded';

export interface PokerRound {
  id: string;
  issue_id: string;
  status: PokerStatus;
  started_by_id: string;
  final_value?: string | null;
  final_estimate_point_id?: string | null;
  revealed_at?: string | null;
  finalized_at?: string | null;
  created_at: string;
}

export interface PokerCard {
  value: string;
  estimate_point_id?: string;
  special?: boolean;
}

export interface PokerParticipant {
  user_id: string;
  voted: boolean;
  /** Only present once the round is revealed. */
  value?: string | null;
}

export interface PokerStats {
  average?: number;
  min?: number;
  max?: number;
  consensus: boolean;
  numeric_votes: number;
  suggested?: string;
}

export interface PokerState {
  round: PokerRound | null;
  cards: PokerCard[];
  participants: PokerParticipant[];
  my_vote?: string | null;
  stats?: PokerStats;
  can_manage: boolean;
  history: PokerRound[];
}

const url = (slug: string, projectId: string, issueId: string, tail = '') =>
  `/api/workspaces/${encodeURIComponent(slug)}/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issueId)}/poker/${tail}`;

export const pokerService = {
  async get(slug: string, projectId: string, issueId: string): Promise<PokerState> {
    const { data } = await apiClient.get<PokerState>(url(slug, projectId, issueId));
    return data;
  },
  async start(slug: string, projectId: string, issueId: string): Promise<PokerState> {
    const { data } = await apiClient.post<PokerState>(url(slug, projectId, issueId, 'start/'));
    return data;
  },
  async vote(slug: string, projectId: string, issueId: string, value: string): Promise<PokerState> {
    const { data } = await apiClient.put<PokerState>(url(slug, projectId, issueId, 'vote/'), {
      value,
    });
    return data;
  },
  async retract(slug: string, projectId: string, issueId: string): Promise<PokerState> {
    const { data } = await apiClient.delete<PokerState>(url(slug, projectId, issueId, 'vote/'));
    return data;
  },
  async reveal(slug: string, projectId: string, issueId: string): Promise<PokerState> {
    const { data } = await apiClient.post<PokerState>(url(slug, projectId, issueId, 'reveal/'));
    return data;
  },
  async restart(slug: string, projectId: string, issueId: string): Promise<PokerState> {
    const { data } = await apiClient.post<PokerState>(url(slug, projectId, issueId, 'restart/'));
    return data;
  },
  async finalize(
    slug: string,
    projectId: string,
    issueId: string,
    value: string,
  ): Promise<PokerState> {
    const { data } = await apiClient.post<PokerState>(url(slug, projectId, issueId, 'finalize/'), {
      value,
    });
    return data;
  },
};
