import fs from 'fs/promises';
import type { PackageJson } from 'type-fest';
import { deepmerge } from 'deepmerge-ts';
import path from 'path';

import { ensureDir, fileExistsAccessible, readPackageJson, replaceInFile } from './file.js';
import { npmInstall, npmUnInstall } from './process.js';
import { createLogger } from './logger.js';
import { pick } from './utils.js';

const DEPRECATED_PACKAGES =
  'ts-node jest ts-jest husky @types/jest @typescript-eslint/eslint-plugin @tsconfig/node20';

const logger = createLogger().child({ name: 'templater', module: 'template' });

function isTruthy<T>(value: T): value is NonNullable<T> {
  return Boolean(value);
}

async function clearDeprecatedFiles(outputPath: string) {
  const deprecatedFiles = ['.eslintrc.js', '.eslintrc.cjs'];

  const existingDeprecatedFiles = (
    await Promise.all(
      deprecatedFiles.map(deprecatedFile =>
        fileExistsAccessible(deprecatedFile).then(res => res && deprecatedFile)
      )
    )
  ).filter(isTruthy);

  await Promise.all(
    deprecatedFiles.map(deprecatedFile =>
      fs.rm(path.join(outputPath, deprecatedFile), { force: true })
    )
  );

  if (existingDeprecatedFiles.length > 0) {
    logger.info({ existingDeprecatedFiles }, 'Found deprecated files and removed them');
  }
}

function concatDependencies(dependencies: Partial<Record<string, string>>) {
  return Object.entries(dependencies)
    .map(([name, version]) => `${name}@${version ?? 'latest'}`.replace('^', ''))
    .join(' ');
}

interface TemplaterMetadata {
  managedDependencies: string[];
  managedDevDependencies: string[];
}

function pinVersions(dependencies: Partial<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, version]) => [
      name,
      (version ?? 'latest').replace('^', ''),
    ])
  );
}

type DownloadResult = 'created' | 'updated' | 'unchanged' | 'failed';

/**
 * Download a file from the given URL, apply replacements, and write it locally
 * only if the resulting content differs from the current file.
 *
 * @param url - Remote URL to download.
 * @param file - Local file path to write.
 * @param replacements - Optional pattern replacements to apply to the downloaded content.
 * @param silent - If true, suppresses non-OK response errors and returns 'failed'.
 * @returns A promise resolving to 'created', 'updated', 'unchanged', or 'failed'.
 */
async function downloadUrlToFile(
  url: string,
  file: string,
  replacements: Record<string, string> = {},
  silent = false
): Promise<DownloadResult> {
  const localLogger = logger.child({ context: 'downloadUrlToFile', file, url });

  const response = await fetch(url);

  if (!response.ok) {
    if (!silent) {
      throw new Error(`unexpected response ${response.statusText}`);
    }
    localLogger.debug('Failed to download');
    return 'failed';
  }

  const downloaded = await response.text();
  const applyReplacements = (value: string) =>
    Object.entries(replacements).reduce(
      (current, [from, to]) => current.replace(new RegExp(from, 'g'), to),
      value
    );

  /**
   * Normalize line endings so file comparisons ignore CRLF vs LF differences.
   *
   * @param value - Text to normalize.
   */
  const normalize = (value: string) => value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let normalizedContent = normalize(applyReplacements(downloaded));
  if (!normalizedContent.endsWith('\n')) {
    normalizedContent += '\n';
  }

  const fileAlreadyExists = await fileExistsAccessible(file);
  if (fileAlreadyExists) {
    const existingContent = normalize(await fs.readFile(file, 'utf-8'));
    if (existingContent === normalizedContent) {
      return 'unchanged';
    }
  }

  await ensureDir(path.dirname(file));
  await fs.writeFile(file, normalizedContent, 'utf-8');
  return fileAlreadyExists ? 'updated' : 'created';
}

export async function run(
  baseUrl: string,
  cwd: string,
  author: string,
  projectName?: string,
  outputPath?: string
) {
  const packageJsonPath = path.join(cwd, 'package.json');

  const templatePackageJson = (await fetch(`${baseUrl}/package.json`).then(response =>
    response.json()
  )) as PackageJson;

  const localPackageJson = await readPackageJson(packageJsonPath);

  const previousMetadata = (localPackageJson as { templater?: TemplaterMetadata }).templater;
  const previouslyManagedDeps = previousMetadata?.managedDependencies ?? [];
  const previouslyManagedDevDeps = previousMetadata?.managedDevDependencies ?? [];

  const currentTemplateDeps = Object.keys(templatePackageJson.dependencies ?? {});
  const currentTemplateDevDeps = Object.keys(templatePackageJson.devDependencies ?? {});

  const depsToRemove = [
    ...previouslyManagedDeps.filter(name => !currentTemplateDeps.includes(name)),
    ...previouslyManagedDevDeps.filter(name => !currentTemplateDevDeps.includes(name)),
  ];

  const localProjectName = projectName ?? localPackageJson.name;

  if (!localProjectName) {
    throw new Error('localProjectName not defined should not happen');
  }

  const homepage = `https://github.com/${author}/${localProjectName}`;
  const gitRepoUrl = `git@github.com:${author}/${localProjectName}`;

  const packageJsonOverrides = {
    ...pick(templatePackageJson, ['scripts']),
    name: localProjectName,
    homepage,
    repository: { type: 'git', url: gitRepoUrl },
    author,
    bugs: { url: homepage },
    type: templatePackageJson.type,
    ...(templatePackageJson.devDependencies && {
      devDependencies: pinVersions(templatePackageJson.devDependencies),
    }),
    ...(templatePackageJson.dependencies && {
      dependencies: pinVersions(templatePackageJson.dependencies),
    }),
  };

  let packageManager: 'npm' | 'pnpm' = 'npm';

  const parentPackageJsonPath = path.join(path.dirname(path.resolve(cwd)), 'package.json');

  if (await fileExistsAccessible(parentPackageJsonPath)) {
    const parentPackageJson = await readPackageJson(parentPackageJsonPath);
    if (!parentPackageJson.name) {
      throw new Error('The parentpackage must have a name');
    }
    const homepage = `https://github.com/${author}/${parentPackageJson.name}`;
    const gitRepoUrl = `git@github.com:${author}/${parentPackageJson.name}`;

    if (parentPackageJson.name === 'mono') {
      packageJsonOverrides.homepage = homepage;
      packageJsonOverrides.repository = { type: 'git', url: gitRepoUrl };
      packageJsonOverrides.bugs = { url: homepage };
      packageManager = 'pnpm';
    }
  }

  if (depsToRemove.length > 0) {
    logger.info({ depsToRemove }, 'Removing dependencies no longer in template');
    await npmUnInstall(depsToRemove.join(' '), packageManager);
  }

  if (templatePackageJson.devDependencies) {
    await npmInstall(concatDependencies(templatePackageJson.devDependencies), true, packageManager);
  }

  if (templatePackageJson.dependencies) {
    await npmInstall(concatDependencies(templatePackageJson.dependencies), false, packageManager);
  }

  const packageJsonAfterDependencyUpdates = await readPackageJson(packageJsonPath);

  if (packageJsonAfterDependencyUpdates.devDependencies) {
    packageJsonAfterDependencyUpdates.devDependencies = Object.fromEntries(
      Object.entries(packageJsonAfterDependencyUpdates.devDependencies).filter(([packageName]) => {
        return !DEPRECATED_PACKAGES.split(' ').includes(packageName);
      })
    );
  }

  const templaterMetadata: TemplaterMetadata = {
    managedDependencies: currentTemplateDeps,
    managedDevDependencies: currentTemplateDevDeps,
  };

  const packageJson = {
    ...deepmerge(packageJsonAfterDependencyUpdates, packageJsonOverrides),
    templater: templaterMetadata,
  };

  await fs.mkdir(cwd, { recursive: true });
  if (outputPath) {
    await fs.mkdir(outputPath, { recursive: true });
  }

  process.chdir(cwd);

  const packageJsonpath = `${outputPath ?? '.'}/package.json`;

  try {
    await fs.writeFile(packageJsonpath, JSON.stringify(packageJson, null, 2) + '\n');
    logger.info({ packageJsonpath }, 'Successfully wrote package.json');
  } catch (err) {
    logger.error({ err }, 'Error writing to package.json');
  }
  const replacements =
    templatePackageJson.name && localProjectName
      ? { [templatePackageJson.name]: localProjectName }
      : {};

  await clearDeprecatedFiles(outputPath ?? '.');

  await npmUnInstall(DEPRECATED_PACKAGES, packageManager);

  const downloadPromises = [
    '.github/copilot-instructions.md',
    '.github/workflows/publish.yml',
    '.github/workflows/ci.yml',
    'nodemon.json',
    'tsconfig.json',
    'tsconfig.spec.json',
    '.prettierrc',
    '.gitignore',
    'jest.config.ts',
    'vitest.config.ts',
    'eslint.config.js',
    '.nvmrc',
  ].map(async fileRelativePath => {
    let status: 'unchanged' | 'updated' | 'deleted' | 'created' = 'unchanged';
    const fileUrl = `${baseUrl}/${fileRelativePath}`;
    const outputFilePath = `${outputPath ?? '.'}/${fileRelativePath}`;
    const downloadResult = await downloadUrlToFile(fileUrl, outputFilePath, replacements, true);
    if (downloadResult === 'failed') {
      if (await fileExistsAccessible(outputFilePath)) {
        await fs.rm(outputFilePath, { force: true });
        status = 'deleted';
      }
    }

    return {
      outputFilePath,
      status:
        downloadResult === 'updated' || downloadResult === 'created' ? downloadResult : status,
    };
  });

  const results = await Promise.all(downloadPromises);

  logger.info(
    { files: results.filter(result => result.status !== 'unchanged') },
    'Synchronized template with local files'
  );

  const replaceInFilePromises = [
    '.github/copilot-instructions.md',
    '.github/workflows/publish.yml',
    '.github/workflows/ci.yml',
    'nodemon.json',
    'tsconfig.json',
    'tsconfig.spec.json',
    '.prettierrc',
    '.gitignore',
    'vitest.config.ts',
    'README.md',
    'package-lock.json',
  ].map(async fileRelativePath => {
    return {
      status: await replaceInFile(`${outputPath ?? '.'}/${fileRelativePath}`, replacements),
      fileRelativePath,
    };
  });

  const replaceResults = await Promise.all(replaceInFilePromises);

  logger.info(
    {
      files: replaceResults.filter(
        result => result.status === 'failed' || result.status === 'nonexisting'
      ),
    },
    'Replacing in files'
  );
}
