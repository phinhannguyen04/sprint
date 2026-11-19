import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';

/**
 * Authentication is fixed: email + password, with accounts created by an
 * instance admin. Public sign-up, magic codes and social login (Google, GitHub,
 * GitLab) are disabled by the server, so there is nothing to configure here.
 */
export function InstanceAdminAuthenticationPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('instanceAdmin.auth.documentTitle', 'Authentication'));

  return (
    <div className="w-full max-w-3xl space-y-6">
      <div>
        <h1 className="text-base font-semibold text-(--txt-primary)">
          {t('instanceAdmin.auth.title', 'Authentication')}
        </h1>
        <p className="mt-0.5 text-xs text-(--txt-secondary)">
          {t(
            'instanceAdmin.auth.fixedSubtitle',
            'This instance signs people in with email and password only.',
          )}
        </p>
      </div>

      <section className="space-y-2 rounded border border-(--border-subtle) bg-(--bg-surface-1) p-3">
        <p className="text-sm font-medium text-(--txt-primary)">
          {t('instanceAdmin.auth.passwordMode', 'Email and password')}
        </p>
        <p className="text-xs text-(--txt-secondary)">
          {t(
            'instanceAdmin.auth.adminProvisioned',
            'Accounts are created by an instance admin, who receives a random one-time password to hand to the user. Public sign-up, email codes and social login (Google, GitHub, GitLab) are turned off.',
          )}
        </p>
        <Link
          to="/instance-admin/users"
          className="inline-block text-xs font-medium text-(--txt-accent) hover:underline"
        >
          {t('instanceAdmin.auth.manageUsers', 'Create and manage users')}
        </Link>
      </section>
    </div>
  );
}
