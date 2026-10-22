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
    'react/no-unused-prop-types': 'warn',
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
