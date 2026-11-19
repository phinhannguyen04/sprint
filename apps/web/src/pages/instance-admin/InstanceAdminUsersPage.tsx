import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Button } from '../../components/ui';
import { workspaceService } from '../../services/workspaceService';
import { instanceUserService } from '../../services/instanceService';
import { getApiErrorMessage } from '../../api/client';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import type { WorkspaceApiResponse, WorkspaceMemberApiResponse } from '../../api/types';

interface Credential {
  email: string;
  password: string;
}

const inputCls =
  'block w-full rounded border border-(--border-subtle) bg-(--bg-surface-1) px-2.5 py-1.5 text-xs text-(--txt-primary) focus:border-(--border-strong) focus:outline-none';

export function InstanceAdminUsersPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('instanceAdmin.users.documentTitle', 'Users'));
  const [workspaces, setWorkspaces] = useState<WorkspaceApiResponse[]>([]);
  const [slug, setSlug] = useState('');
  const [members, setMembers] = useState<WorkspaceMemberApiResponse[]>([]);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [credential, setCredential] = useState<Credential | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    workspaceService
      .list()
      .then((list) => {
        setWorkspaces(list);
        setSlug((cur) => cur || list[0]?.slug || '');
      })
      .catch((err) => setError(getApiErrorMessage(err)));
  }, []);

  const loadMembers = (s: string) =>
    s ? workspaceService.listMembers(s).then(setMembers) : Promise.resolve(setMembers([]));

  useEffect(() => {
    loadMembers(slug).catch((err) => setError(getApiErrorMessage(err)));
  }, [slug]);

  const show = (cred: Credential) => {
    setCredential(cred);
    setCopied(false);
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await instanceUserService.createUser({
        email: email.trim(),
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        workspace_slug: slug || undefined,
        role,
      });
      show({ email: res.user.email ?? email.trim(), password: res.password });
      setEmail('');
      setFirstName('');
      setLastName('');
      await loadMembers(slug);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onReset = async (m: WorkspaceMemberApiResponse) => {
    if (
      !window.confirm(
        t(
          'instanceAdmin.users.resetConfirm',
          'Generate a new password for this user? They will be signed out everywhere.',
        ),
      )
    )
      return;
    setError('');
    try {
      const res = await instanceUserService.resetPassword(m.member_id);
      show({ email: m.member_email ?? res.user.email ?? '', password: res.password });
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  };

  const copy = async () => {
    if (!credential) return;
    try {
      await navigator.clipboard.writeText(`${credential.email}\n${credential.password}`);
      setCopied(true);
    } catch {
      /* clipboard unavailable; the password is visible to copy by hand */
    }
  };

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-base font-semibold text-(--txt-primary)">
          {t('instanceAdmin.users.title', 'Users')}
        </h1>
        <p className="mt-0.5 text-xs text-(--txt-secondary)">
          {t(
            'instanceAdmin.users.subtitle',
            'Sign-up and social login are disabled. Create accounts here; a random password is generated and shown once.',
          )}
        </p>
      </div>

      {error && <p className="text-sm text-(--txt-danger-primary)">{error}</p>}

      {credential && (
        <div className="rounded border border-(--border-subtle) bg-(--bg-layer-1) p-3 text-xs">
          <p className="font-medium text-(--txt-primary)">
            {t(
              'instanceAdmin.users.credentialsOnce',
              'Share these credentials now — the password cannot be shown again.',
            )}
          </p>
          <p className="mt-2 text-(--txt-secondary)">
            {credential.email} ·{' '}
            <code className="rounded bg-(--bg-layer-2) px-1.5 py-0.5 select-all">
              {credential.password}
            </code>
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="secondary" className="text-xs" onClick={() => void copy()}>
              {copied ? t('common.copied', 'Copied') : t('common.copy', 'Copy')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="text-xs"
              onClick={() => setCredential(null)}
            >
              {t('common.dismiss', 'Dismiss')}
            </Button>
          </div>
        </div>
      )}

      <form onSubmit={onCreate} className="grid max-w-2xl grid-cols-2 gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('instanceAdmin.users.email', 'Email')}
          className={`${inputCls} col-span-2`}
        />
        <input
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder={t('instanceAdmin.users.firstName', 'First name')}
          className={inputCls}
        />
        <input
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder={t('instanceAdmin.users.lastName', 'Last name')}
          className={inputCls}
        />
        <select value={slug} onChange={(e) => setSlug(e.target.value)} className={inputCls}>
          <option value="">{t('instanceAdmin.users.noWorkspace', 'No workspace')}</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.slug}>
              {w.name}
            </option>
          ))}
        </select>
        <select value={role} onChange={(e) => setRole(Number(e.target.value))} className={inputCls}>
          <option value={5}>{t('instanceAdmin.users.roleGuest', 'Guest')}</option>
          <option value={10}>{t('instanceAdmin.users.roleMember', 'Member')}</option>
          <option value={15}>{t('instanceAdmin.users.roleAdmin', 'Admin')}</option>
        </select>
        <div className="col-span-2">
          <Button size="sm" type="submit" className="text-xs" disabled={busy || !email.trim()}>
            {busy
              ? t('instanceAdmin.users.creating', 'Creating…')
              : t('instanceAdmin.users.create', 'Create user')}
          </Button>
        </div>
      </form>

      {slug && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-(--txt-secondary)">
            {t('instanceAdmin.users.members', 'Workspace members • {{count}}', {
              count: members.length,
            })}
          </h2>
          <ul className="space-y-2">
            {members.map((m) => {
              const name = m.member_display_name || m.member_email || '—';
              return (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 rounded border border-(--border-subtle) bg-(--bg-surface-1) p-3"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={name} src={m.member_avatar} size="md" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-(--txt-primary)">{name}</p>
                      <p className="truncate text-xs text-(--txt-tertiary)">
                        {m.member_email ?? '—'}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="text-xs"
                    onClick={() => void onReset(m)}
                  >
                    {t('instanceAdmin.users.resetPassword', 'Reset password')}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
