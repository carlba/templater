# templater

A CLI tool that scaffolds and keeps TypeScript repositories in sync with a remote template. Run it
once to bootstrap a new project, or re-run it at any time to pull in updated tooling config,
scripts, and dependencies from the template.

## Installation

```bash
npm install -g templater
# or use without installing:
npx templater
```

## Usage

```
templater [directory] [options]

Arguments:
  directory                    Target directory (default: current directory)

Options:
  -u, --uri <URI>              Raw base URL of the template repository
                               (default: https://raw.githubusercontent.com/carlba/typescript-template/main)
  -a, --author <AUTHOR>        GitHub username / author name (default: carlba)
  -p, --project-name <NAME>    Override the project name (default: name from local package.json)
```

### Examples

Bootstrap the current directory using the default template:

```bash
templater
```

Scaffold a subdirectory with a custom project name:

```bash
templater ./my-app --author myuser --project-name my-app
```

Use a different template repository:

```bash
templater --uri https://raw.githubusercontent.com/myuser/my-template/main
```

## What it does

On each run, templater:

1. **Fetches the remote template's `package.json`** and uses it as the source of truth.
2. **Installs all template dependencies at exact pinned versions** — no `^` ranges. This ensures
   every repo using the template has identical dependency versions.
3. **Removes dependencies that were dropped from the template** since the last run. Templater
   tracks which packages it manages under a `templater` key in the target `package.json` and
   uninstalls any that are no longer present in the template.
4. **Syncs tooling files** — `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`,
   `.prettierrc`, `.gitignore`, `.nvmrc`, GitHub Actions workflows, and more — downloading them
   from the template and removing any that have been deleted upstream.
5. **Merges `package.json`** — overwrites `scripts`, `author`, `homepage`, `repository`, and
   `bugs` from the template while preserving project-specific fields like `name` and any
   dependencies not managed by the template.

### Dependency management

The template is the single source of truth for its dependencies. After each run the target
`package.json` will contain a `templater` block:

```json
"templater": {
  "managedDependencies": ["commander", "pino", ...],
  "managedDevDependencies": ["eslint", "typescript", "vitest", ...]
}
```

This manifest lets templater know which packages it owns. On the next run it computes the diff
between the previous manifest and the current template, and uninstalls anything that was removed.
Project-specific dependencies (not in the template) are never touched.

> **Note:** npm installs use `--legacy-peer-deps` so that upgrading packages to newer major
> versions (e.g. eslint@9 → eslint@10) is not blocked by stale peer dependency constraints from
> packages that haven't been updated yet.
