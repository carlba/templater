module.exports = {
  env: {
    node: true,
  },
  overrides: [
    {
      files: ['**/*'],
      extends: ['eslint:recommended'],
    },
    {
      files: ['src**/*.ts'],
      extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended-type-checked',
        'plugin:@typescript-eslint/stylistic-type-checked',
      ],
      plugins: ['@typescript-eslint'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        project: true,
      },
    },
  ],
};
