// @ai
// Qariah (Sprint 32): the Settings "Support" and "Feature request" rows open
// a mail to branding.supportEmail. Divergence batch C3 (SHT-S6) moved this out
// of the inherited Settings index (`app/(tabs)/(d.settings)/index.tsx`).
//
// Opens the user's mail composer pre-addressed to branding.supportEmail.
// Calls Linking.openURL('mailto:…') directly instead of gating on
// Linking.canOpenURL: on iOS canOpenURL('mailto:') returns false unless the
// scheme is whitelisted in LSApplicationQueriesSchemes, which made the old
// code fall back to branding.supportUrl (the marketing homepage) and read as
// a dead link. If no mail handler exists, surface the address in an Alert so
// the user can still reach us — never bounce to a web page.
// The body carries the anonymous diagnostic block, so a report arrives with the
// debug ID that finds the sender's telemetry in Sentry and PostHog. The user
// sees the text in the composer before they send it — it is never hidden.
// The subject line (qariah:support.emailSubject*) is the English text in
// every language, so the support inbox can sort by it.
import {Alert, Linking} from 'react-native';
import branding from '@/config/branding';
import i18n from '@/i18n';
import {getDebugIdBlock} from '@/services/diagnostics/debugId';

/** The `type` of the Settings row that opens the mail. */
export type SupportEmailKind = 'support' | 'featureRequest';

const SUBJECT_KEYS = {
  support: 'qariah:support.emailSubjectSupport',
  featureRequest: 'qariah:support.emailSubjectFeatureRequest',
} as const;

export async function openSupportEmail(kind: SupportEmailKind): Promise<void> {
  const subject = i18n.t(SUBJECT_KEYS[kind], {lng: 'en'});
  const encodedSubject = encodeURIComponent(subject);
  const body = encodeURIComponent(`\n\n${getDebugIdBlock()}\n`);
  const mailto = `mailto:${branding.supportEmail}?subject=${encodedSubject}&body=${body}`;
  try {
    await Linking.openURL(mailto);
  } catch {
    Alert.alert(
      i18n.t('qariah:support.emailUsTitle'),
      // No digit post-processing: an e-mail address keeps Latin digits.
      i18n.t('qariah:support.emailUsBody', {
        email: branding.supportEmail,
        postProcess: [],
      }),
    );
  }
}
