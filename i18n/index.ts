// @ai-generated
import 'intl-pluralrules';
import i18n, {type PostProcessorModule} from 'i18next';
import {initReactI18next} from 'react-i18next';
import {currentLanguage} from './language';
import {localizeDigits} from './format';
import {resources, defaultNS, namespaces} from './resources';
import {SOURCE_LANGUAGE, getLanguageConfig} from './languages';
// Qariah: the app name in Arabic (i18n/qariahAppName.ts).
import {qariahAppName, withQariahPostProcess} from './qariahAppName';

const localizedDigits: PostProcessorModule = {
  type: 'postProcessor',
  name: 'localizedDigits',
  process: (value: string) => localizeDigits(value),
};

i18n
  .use(initReactI18next)
  .use(localizedDigits)
  .use(qariahAppName) // Qariah
  .init({
    resources,
    lng: currentLanguage,
    fallbackLng: SOURCE_LANGUAGE,
    ns: namespaces,
    defaultNS,
    initAsync: false,
    returnNull: false,
    // An empty value (a key not translated yet) falls back to English.
    returnEmptyString: false,
    interpolation: {escapeValue: false},
    // Qariah: `withQariahPostProcess` adds the app-name post-processor.
    postProcess: withQariahPostProcess(
      getLanguageConfig(currentLanguage).digits === 'latn'
        ? false
        : ['localizedDigits'],
    ),
    react: {useSuspense: false},
  });

export {currentLanguage};
export default i18n;
