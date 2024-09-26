module.exports = {
  env: {
    es2022: true,
    node: true,
  },
  ignorePatterns: ['dist/'],
  overrides: [
    {
      files: ['**/*.{js,cjs}'],
      extends: ['eslint:recommended'],
      // https://eslint.org/docs/v8.x/use/configure/language-options#specifying-parser-options
      parserOptions: {
        ecmaVersion: '2022',
      },
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
