module.exports = {
  root: true,
  extends: [
    '@react-native-community/eslint-config',
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'prettier'],
  rules: {
    'prettier/prettier': [
      'error',
      {
        arrowParens: 'avoid',
        bracketSameLine: true,
        bracketSpacing: false,
        singleQuote: true,
        trailingComma: 'all',
      },
    ],
    'react/prop-types': 'off',
    // Sprint 29 (TECH_DEBT #91): explicit guard against duplicate object-literal
    // keys. `eslint:recommended` already enables this, but declaring it here
    // makes the intent visible + survives any future `extends` reordering. The
    // Sprint 26 regression — two `homeRowConfig` keys in `config/branding.js`,
    // JS last-key-wins silently shadowing Qariah's curated 7-row lineup with
    // Bayaan's 12-row default — shipped because CI never ran the lint (org
    // Actions billing block), not because the rule was absent. Keeping it loud.
    // Eligible upstream chore PR for Bayaan's own `config/branding.js`.
    'no-dupe-keys': 'error',
    // Sprint 8 (TECH_DEBT #31, #35): catch the silent-bug class where a
    // component declares a prop in its TS interface but never destructures
    // / uses it, so callers pass values that get silently dropped. Found
    // in S7 post-close at components/ReciterImage.tsx — `imageUrl` was
    // declared + passed by every call site but never consumed → R2 photos
    // invisible on every reciter card. Upstream PR thebayaan/Bayaan#244
    // ships the same fix at the call site; this rule prevents recurrence.
    // S8.5 audit surfaced ~236 inherited findings. Sprint 9 cleared the
    // bulk via FollowAlongBadge fixes + Icons file-level disable (236→39).
    // Sprint 14 (S14.3) cleared the remaining 39 → 0 and flipped to
    // 'error'. TECH_DEBT #35 RESOLVED.
    'react/no-unused-prop-types': 'error',
    'react/react-in-jsx-scope': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    'no-use-before-define': 'off',
    'react-native/no-inline-styles': 'off',
    // "@typescript-eslint/no-use-before-define": ["error"],
    // Add this rule to allow ES module imports in the server file
    '@typescript-eslint/no-var-requires': 'off',
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
};
