// @ai
// Qariah (Sprint 52 Task 5): the sign-out sheet of the Settings list, for the
// phone screen and the iPad list (`branding.settingsOverlayComponent`). The
// "Sign out" row opens it through `openSignOutPrompt()`. Each Settings screen
// renders it once, as the last child of its root view: it is a gorhom
// BottomSheet (not a modal), so inside the scrolling list it would scroll
// with the rows.
//
// In the iPad split it also closes Your data after a sign-out: the list stays
// beside that page, and the Your data row goes away when the account does.
import React, {useCallback, useEffect} from 'react';
import {useRouter, useSegments} from 'expo-router';
import {useAuth} from '@/services/auth';
import {SignOutConfirmModal} from '@/components/auth/SignOutConfirmModal';
import {
  ACCOUNT_SETTINGS_TYPES,
  useSignOutPromptStore,
} from '@/components/auth/QariahAccountSection';
import {useResponsive} from '@/hooks/useResponsive';
import {
  SETTINGS_DEFAULT_ROUTE,
  SETTINGS_ROUTE_NAMES,
  SETTINGS_SPLIT_MIN_WIDTH,
  settingsSplitNav,
} from '@/components/settings/settingsItems';

/**
 * In the split, a signed-out user on the Your data page gets the default
 * page, as a press of its row in the list gives (`settingsSplitNav`). Phones
 * and the pushed list below 900 pt do not change: there the list is not on
 * screen beside the page.
 */
function useCloseYourDataWhenSignedOut(
  status: ReturnType<typeof useAuth>['status'],
): void {
  const router = useRouter();
  const segments = useSegments();
  const current = segments[segments.length - 1];
  const {isTablet, width} = useResponsive();
  const split = isTablet && width >= SETTINGS_SPLIT_MIN_WIDTH;
  useEffect(() => {
    if (
      !split ||
      status !== 'unauthenticated' ||
      current !== SETTINGS_ROUTE_NAMES[ACCOUNT_SETTINGS_TYPES.yourData]
    ) {
      return;
    }
    if (settingsSplitNav(SETTINGS_DEFAULT_ROUTE, current).kind === 'home') {
      router.dismissAll();
    }
  }, [split, status, current, router]);
}

export function SignOutPrompt() {
  const open = useSignOutPromptStore(s => s.open);
  const setOpen = useSignOutPromptStore(s => s.setOpen);
  const {status, signOut} = useAuth();
  useCloseYourDataWhenSignedOut(status);
  const close = useCallback(() => setOpen(false), [setOpen]);
  const confirm = useCallback(async () => {
    setOpen(false);
    await signOut();
  }, [setOpen, signOut]);
  return (
    <SignOutConfirmModal
      isVisible={open}
      onConfirm={confirm}
      onCancel={close}
    />
  );
}
