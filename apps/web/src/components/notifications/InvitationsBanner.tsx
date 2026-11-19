import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '../ui';
import { subscribeInbox } from '../../lib/realtime';
import { invitationService } from '../../services/invitationService';

interface Row {
  token: string;
  workspaceName: string;
}

/**
 * Pending workspace invitations for the signed-in user. Invitations used to be
 * delivered by email only; this surfaces them inside the app (Inbox).
 */
export function InvitationsBanner() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const mine = await invitationService.listMine();
        const resolved = await Promise.all(
          mine.map((i) =>
            invitationService
              .getByToken(i.token)
              .then((d) => ({ token: i.token, workspaceName: d.workspace_name }))
              .catch(() => null),
          ),
        );
        if (!cancelled) setRows(resolved.filter((r): r is Row => r !== null));
      } catch {
        /* invitations are best-effort */
      }
    };
    void load();
    const unsubscribe = subscribeInbox((e) => {
      if (e.type === 'notification' || e.type === 'badge') void load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const decline = async (token: string) => {
    try {
      await invitationService.declineByToken(token);
      setRows((prev) => prev.filter((r) => r.token !== token));
    } catch {
      /* leave the row so the user can retry */
    }
  };

  if (rows.length === 0) return null;
  return (
    <ul className="divide-y divide-(--border-subtle) border-b border-(--border-subtle) bg-(--bg-accent-subtle)">
      {rows.map((r) => (
        <li key={r.token} className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="min-w-0 text-sm text-(--txt-primary)">
            {t('invitations.invitedTo', 'You were invited to join {{name}}', {
              name: r.workspaceName,
            })}
          </span>
          <span className="flex shrink-0 gap-2">
            <Link to={`/invite?token=${encodeURIComponent(r.token)}`}>
              <Button size="sm">{t('invitations.accept', 'Review')}</Button>
            </Link>
            <Button size="sm" variant="secondary" onClick={() => void decline(r.token)}>
              {t('invitations.decline', 'Decline')}
            </Button>
          </span>
        </li>
      ))}
    </ul>
  );
}
