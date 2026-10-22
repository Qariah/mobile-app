// @ai-generated
// Qariah: the app name in each UI language (Sprint 47, Pass C).
//
// README decision 1 (planning/pass-c/arabic-review/README.md): in Arabic the
// app is "قارئة" alone in brand places and "تطبيق قارئة" inside a sentence.
// English stays `branding.appName` ("Qariah").
//
// `branding.appName` itself does not change: app.config.ts reads it in Node
// at config time, and Sentry and analytics read it too. Callers keep passing
// `{appName: branding.appName}` to `t()`. The `qariahAppName` post-processor
// below swaps the name in the finished string when the language has its own
// form of it. The Arabic strings already say "تطبيق {{appName}}" where the
// name sits inside a sentence (the qariah namespace, and the generated
// i18n/overrides/ar.json for upstream keys), so the result reads
// "تطبيق قارئة"; brand labels read "قارئة".
//
// The localized name is the `qariah:brand.sidebar` value of that language,
// which the review pack generates (row 3). A language without its own value
// uses `branding.appName`.
import type {PostProcessorModule} from 'i18next';
import branding from '@/config/branding';
import {currentLanguage} from './language';
import {SOURCE_LANGUAGE} from './languages';
import {resources} from './resources';

type BrandTree = {qariah?: {brand?: {sidebar?: string}}};

/** The app name as people see it in `language`. */
export function getAppDisplayName(language: string = currentLanguage): string {
  if (language === SOURCE_LANGUAGE) return branding.appName;
  const byLanguage = resources as unknown as Record<string, BrandTree>;
  return byLanguage[language]?.qariah?.brand?.sidebar || branding.appName;
}

/**
 * Replaces `branding.appName` with the language's own name in a translated
 * string. It acts only when the caller passed `{appName: branding.appName}`,
 * so a string that merely contains the Latin word (a playlist name, a URL)
 * is left alone.
 */
export const qariahAppName: PostProcessorModule = {
  type: 'postProcessor',
  name: 'qariahAppName',
  process: (value: string, _key, options, translator) => {
    if (options?.appName !== branding.appName) return value;
    const language: string =
      (options?.lng as string | undefined) ??
      (translator as {language?: string} | undefined)?.language ??
      currentLanguage;
    const name = getAppDisplayName(language);
    return name === branding.appName
      ? value
      : value.split(branding.appName).join(name);
  },
};

/** Upstream's post-processor list with `qariahAppName` in front of it. */
export function withQariahPostProcess(
  upstream: false | string | readonly string[],
): string[] {
  const rest = upstream === false ? [] : [upstream].flat();
  return [qariahAppName.name, ...rest];
}
