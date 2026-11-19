import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Modal } from '../ui';
import { useAuth } from '../../contexts/AuthContext';
import { subscribeInbox } from '../../lib/realtime';
import { workspaceService } from '../../services/workspaceService';
import { pokerService, type PokerState } from '../../services/pokerService';
import { getApiErrorMessage } from '../../api/client';
import type { WorkspaceMemberApiResponse } from '../../api/types';

interface Props {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  /** Called after an estimate was finalized so the page can refresh its estimate field. */
  onEstimateSet?: () => void;
}

function usePokerState(slug: string, projectId: string, issueId: string) {
  const [state, setState] = useState<PokerState | null>(null);
  const reload = useCallback(
    () =>
      pokerService
        .get(slug, projectId, issueId)
        .then(setState)
        .catch(() => {}),
    [slug, projectId, issueId],
  );
  useEffect(() => {
    void reload();
    const id = window.setInterval(reload, 60_000); // safety net; SSE does the real work
    const unsubscribe = subscribeInbox((e) => {
      if (e.type === 'poker' && (!e.issue_id || e.issue_id === issueId)) void reload();
    });
    return () => {
      window.clearInterval(id);
      unsubscribe();
    };
  }, [reload, issueId]);
  return { state, setState, reload };
}

/** Sidebar entry for backlog-refinement planning poker on a work item. */
export function PlanningPokerButton({ workspaceSlug, projectId, issueId, onEstimateSet }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { state, setState } = usePokerState(workspaceSlug, projectId, issueId);
  const [open, setOpen] = useState(false);

  const round = state?.round;
  const voting = round?.status === 'voting';
  const voted = state?.participants.filter((p) => p.voted).length ?? 0;
  const total = state?.participants.length ?? 0;
  const needsMyVote = voting && state?.my_vote == null && !!user;

  let summary = t('poker.notStarted', 'Estimate with your team');
  if (voting) summary = t('poker.votingSummary', 'Voting · {{voted}}/{{total}}', { voted, total });
  else if (round?.status === 'revealed') summary = t('poker.revealedSummary', 'Votes revealed');
  else if (round?.status === 'finalized' && round.final_value)
    summary = t('poker.finalSummary', 'Estimated: {{value}}', { value: round.final_value });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 rounded border border-(--border-subtle) bg-(--bg-surface-1) px-3 py-2 text-left hover:bg-(--bg-layer-1-hover)"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-(--txt-primary)">
            {t('poker.title', 'Planning poker')}
          </span>
          <span className="block truncate text-xs text-(--txt-tertiary)">{summary}</span>
        </span>
        {needsMyVote ? (
          <span className="shrink-0 rounded-full bg-(--brand-default) px-2 py-0.5 text-[10px] font-semibold text-white">
            {t('poker.yourTurn', 'Vote')}
          </span>
        ) : null}
      </button>
      {open && (
        <PokerModal
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          issueId={issueId}
          state={state}
          setState={setState}
          onClose={() => setOpen(false)}
          onEstimateSet={onEstimateSet}
        />
      )}
    </>
  );
}

function PokerModal({
  workspaceSlug,
  projectId,
  issueId,
  state,
  setState,
  onClose,
  onEstimateSet,
}: Props & {
  state: PokerState | null;
  setState: (s: PokerState) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [members, setMembers] = useState<Map<string, WorkspaceMemberApiResponse>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [finalPick, setFinalPick] = useState<string | null>(null);

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

  const run = async (fn: () => Promise<PokerState>, after?: () => void) => {
    setBusy(true);
    setError('');
    try {
      setState(await fn());
      after?.();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const round = state?.round ?? null;
  const status = round?.status;
  const realCards = useMemo(() => (state?.cards ?? []).filter((c) => !c.special), [state]);
  const chosenFinal = finalPick ?? state?.stats?.suggested ?? realCards[0]?.value ?? null;
  const name = (id: string) =>
    members.get(id)?.member_display_name || members.get(id)?.member_email || '…';
  const voted = state?.participants.filter((p) => p.voted).length ?? 0;
  const total = state?.participants.length ?? 0;
  const s = [workspaceSlug, projectId, issueId] as const;

  return (
    <Modal
      open
      onClose={onClose}
      title={t('poker.title', 'Planning poker')}
      className="max-w-xl"
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('common.close', 'Close')}
        </Button>
      }
    >
      <div className="space-y-4">
        {error ? <p className="text-sm text-(--txt-danger-primary)">{error}</p> : null}

        {(!round || status === 'finalized') && (
          <div className="space-y-3">
            {status === 'finalized' && round?.final_value ? (
              <p className="text-sm text-(--txt-secondary)">
                {t('poker.lastResult', 'Last estimate: {{value}}', { value: round.final_value })}
              </p>
            ) : (
              <p className="text-sm text-(--txt-secondary)">
                {t(
                  'poker.intro',
                  'Everyone on the project picks a card in private. Cards stay hidden until the facilitator reveals them.',
                )}
              </p>
            )}
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void run(() => pokerService.start(...s))}
            >
              {status === 'finalized'
                ? t('poker.reestimate', 'Re-estimate')
                : t('poker.start', 'Start planning poker')}
            </Button>
          </div>
        )}

        {round && (status === 'voting' || status === 'revealed') && (
          <>
            {status === 'voting' && (
              <div>
                <p className="mb-2 text-xs font-medium text-(--txt-secondary)">
                  {t('poker.pickCard', 'Pick your card')} ·{' '}
                  {t('poker.votedCount', '{{voted}}/{{total}} voted', { voted, total })}
                </p>
                <div className="flex flex-wrap gap-2">
                  {state?.cards.map((c) => {
                    const selected = state.my_vote === c.value;
                    return (
                      <button
                        key={c.value}
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            selected
                              ? pokerService.retract(...s)
                              : pokerService.vote(...s, c.value),
                          )
                        }
                        className={`flex h-16 w-12 items-center justify-center rounded-lg border text-lg font-semibold transition-colors ${
                          selected
                            ? 'border-(--brand-default) bg-(--brand-default) text-white'
                            : 'border-(--border-subtle) bg-(--bg-surface-1) text-(--txt-primary) hover:border-(--brand-default)'
                        }`}
                      >
                        {c.value}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <ul className="divide-y divide-(--border-subtle) rounded border border-(--border-subtle)">
              {state?.participants.map((p) => (
                <li key={p.user_id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar
                      name={name(p.user_id)}
                      src={members.get(p.user_id)?.member_avatar}
                      size="sm"
                    />
                    <span className="truncate text-sm text-(--txt-primary)">{name(p.user_id)}</span>
                  </span>
                  {status === 'revealed' ? (
                    <span className="rounded bg-(--bg-layer-2) px-2 py-0.5 text-sm font-semibold text-(--txt-primary)">
                      {p.voted ? p.value : '—'}
                    </span>
                  ) : (
                    <span
                      className={`text-xs ${p.voted ? 'text-(--txt-accent-primary)' : 'text-(--txt-tertiary)'}`}
                    >
                      {p.voted ? t('poker.voted', '✓ Voted') : t('poker.waiting', 'Waiting…')}
                    </span>
                  )}
                </li>
              ))}
            </ul>

            {status === 'revealed' && state?.stats && (
              <div className="rounded bg-(--bg-layer-1) px-3 py-2 text-sm text-(--txt-secondary)">
                {state.stats.consensus && (
                  <p className="mb-1 font-medium text-(--txt-accent-primary)">
                    {t('poker.consensus', '🎉 Consensus!')}
                  </p>
                )}
                {state.stats.average != null ? (
                  <p>
                    {t('poker.average', 'Average {{avg}}', {
                      avg: Number(state.stats.average.toFixed(2)),
                    })}{' '}
                    ·{' '}
                    {t('poker.range', 'range {{min}}–{{max}}', {
                      min: state.stats.min,
                      max: state.stats.max,
                    })}
                  </p>
                ) : (
                  <p>{t('poker.noNumeric', 'No numeric votes.')}</p>
                )}
              </div>
            )}

            {status === 'revealed' && state?.can_manage && (
              <div>
                <p className="mb-2 text-xs font-medium text-(--txt-secondary)">
                  {t('poker.finalPrompt', 'Agree on the final estimate')}
                </p>
                <div className="mb-3 flex flex-wrap gap-2">
                  {realCards.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setFinalPick(c.value)}
                      className={`h-9 min-w-9 rounded border px-2 text-sm font-semibold ${
                        chosenFinal === c.value
                          ? 'border-(--brand-default) bg-(--brand-default) text-white'
                          : 'border-(--border-subtle) bg-(--bg-surface-1) text-(--txt-primary) hover:border-(--brand-default)'
                      }`}
                    >
                      {c.value}
                    </button>
                  ))}
                </div>
                <Button
                  size="sm"
                  disabled={busy || !chosenFinal}
                  onClick={() =>
                    chosenFinal &&
                    void run(() => pokerService.finalize(...s, chosenFinal), onEstimateSet)
                  }
                >
                  {t('poker.finalize', 'Set estimate to {{value}}', { value: chosenFinal ?? '' })}
                </Button>
              </div>
            )}

            <div className="flex gap-2">
              {status === 'voting' && state?.can_manage && (
                <Button
                  size="sm"
                  disabled={busy || voted === 0}
                  onClick={() => void run(() => pokerService.reveal(...s))}
                >
                  {t('poker.reveal', 'Reveal votes')}
                </Button>
              )}
              {state?.can_manage && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void run(() => pokerService.restart(...s))}
                >
                  {t('poker.revote', 'Restart round')}
                </Button>
              )}
            </div>
            {!state?.can_manage && (
              <p className="text-xs text-(--txt-tertiary)">
                {t(
                  'poker.facilitatorOnly',
                  'Only {{name}} (who started the round) or a workspace admin can reveal and finalize.',
                  { name: round ? name(round.started_by_id) : '' },
                )}
              </p>
            )}
          </>
        )}

        {state && state.history.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-(--txt-secondary)">
              {t('poker.history', 'Previous rounds')}
            </p>
            <ul className="space-y-1 text-xs text-(--txt-tertiary)">
              {state.history.map((h) => (
                <li key={h.id}>
                  {h.final_value} — {new Date(h.finalized_at ?? h.created_at).toLocaleString()}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
