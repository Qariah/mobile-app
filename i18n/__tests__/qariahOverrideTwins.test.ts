// @ai-generated
// Qariah: the upstream keys that the overlay (i18n/overrides) gives Qariah's
// wording show the same text as the qariah keys they replaced in the code
// (divergence batch C1, 2026-10-24: the tab labels and the About bodies).
// Each call passes what the screen passes.
import branding from '@/config/branding';
import i18n from '@/i18n';

const appName = branding.appName;
// The keys below are data, so this test calls an untyped `t`.
const t = i18n.t.bind(i18n) as unknown as (
  key: string,
  options?: Record<string, string>,
) => string;

const TWINS: {
  upstream: string;
  qariah: string;
  options?: Record<string, string>;
}[] = [
  {upstream: 'common:tabs.home', qariah: 'qariah:tabs.listen'},
  {upstream: 'common:tabs.surahs', qariah: 'qariah:tabs.mushaf'},
  {
    upstream: 'settings:about.alhamdulillahBody',
    qariah: 'qariah:about.alhamdulillahBody',
  },
  {
    upstream: 'settings:about.missionBody',
    qariah: 'qariah:about.missionBody',
    options: {appName},
  },
  {
    upstream: 'settings:about.commitmentBody',
    qariah: 'qariah:about.commitmentBody',
    options: {appName},
  },
];

describe.each(['en', 'ar'])('override twins in %s', lng => {
  it.each(TWINS)(
    '$upstream reads as $qariah',
    ({upstream, qariah, options}) => {
      const shown = t(upstream, {...options, lng});
      expect(shown).toBe(t(qariah, {lng}));
      expect(shown).not.toContain('{{');
    },
  );
});
