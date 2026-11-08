// @ai
// Qariah (Sprint 11): the Account section at the top of the Settings list,
// and its sign-out sheet. Divergence batch C3 (SHT-S6) moved them out of the
// inherited `app/(tabs)/(d.settings)/index.tsx`. Upstream's QF branch puts its
// own `QfAccountCard` at the same place, so a later swap is one line there.
//
// Sprint 52 Task 5: the section is data (`SettingsSection`), so that the phone
// list and the iPad list render the same rows from one source
// (`components/settings/qariahSettingsSections.ts`). The sign-out sheet reads
// a small store here: the "Sign out" row opens it through `openSettingsItem`,
// and each Settings screen renders `SignOutPrompt` (its own file) once.
import {useEffect, useState} from 'react';
import type {TFunction} from 'i18next';
import {create} from 'zustand';
import type {AuthStatus} from '@/services/auth';
import {fetchQfUserInfo} from '@/services/userState/qfUserInfo';
import type {SettingsSection} from '@/components/settings/settingsItems';

/** The `type` of each Account row; `branding.settingsRouteNames` routes the pages. */
export const ACCOUNT_SETTINGS_TYPES = {
  signIn: 'signIn',
  signedIn: 'account',
  yourData: 'yourData',
  signOut: 'signOut',
} as const;

/**
 * The Account section: "Sign in" when signed out; when signed in, the
 * account row (it shows the email and opens nothing), Your data and Sign out.
 */
export function getAccountSettingsSection(
  t: TFunction<['settings', 'common', 'qariah']>,
  signedIn: boolean,
  email: string | null,
): SettingsSection {
  return {
    section: t('qariah:account.section'),
    leading: true,
    items: signedIn
      ? [
          {
            title: t('qariah:account.signedIn'),
            type: ACCOUNT_SETTINGS_TYPES.signedIn,
            description: email ?? t('qariah:account.qfAccount'),
            icon: 'user-check',
            iconType: 'feather',
            readOnly: true,
          },
          {
            title: t('qariah:account.yourData'),
            type: ACCOUNT_SETTINGS_TYPES.yourData,
            description: t('qariah:account.yourDataDesc'),
            icon: 'download-cloud',
            iconType: 'feather',
          },
          {
            title: t('qariah:account.signOut'),
            type: ACCOUNT_SETTINGS_TYPES.signOut,
            description: t('qariah:account.signOutDesc'),
            icon: 'log-out',
            iconType: 'feather',
          },
        ]
      : [
          {
            title: t('qariah:account.signInTitle'),
            type: ACCOUNT_SETTINGS_TYPES.signIn,
            description: t('qariah:account.signInDesc'),
            icon: 'log-in',
            iconType: 'feather',
          },
        ],
  };
}

/**
 * The signed-in user's email, for the account row. Best-effort: a failure
 * leaves null, and the row shows "Quran Foundation account".
 */
export function useQfAccountEmail(status: AuthStatus): string | null {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (status !== 'authenticated') {
      setEmail(null);
      return;
    }
    fetchQfUserInfo()
      .then(info => {
        if (!cancelled) setEmail(info?.email ?? null);
      })
      .catch(() => {
        if (!cancelled) setEmail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);
  return email;
}

interface SignOutPromptState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/** Whether the sign-out sheet shows. The "Sign out" row sets it. */
export const useSignOutPromptStore = create<SignOutPromptState>(set => ({
  open: false,
  setOpen: open => set({open}),
}));

/** Opens the sign-out sheet (the "Sign out" row). */
export function openSignOutPrompt(): void {
  useSignOutPromptStore.getState().setOpen(true);
}
