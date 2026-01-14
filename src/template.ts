import fs from 'fs/promises';
import type { PackageJson } from 'type-fest';
import { deepmerge } from 'deepmerge-ts';
import path from 'path';

import { createWriteStream } from 'node:fs';
import readline from 'readline';
import { fileExistsAccessible, readPackageJson, replaceInFile } from './file-utils.js';
import { npmInstall, npmUnInstall } from './process-utils.js';
import { LOGGER } from './logger.js';
import { pick } from './utils.js';
import { Readable } from 'node:stream';

const DEPRECATED_PACKAGES =
  'ts-node jest ts-jest husky @types/jest @typescript-eslint/eslint-plugin @tsconfig/node20';

const logger = LOGGER.child({ module: 'template' });

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
  logger.info({ existingDeprecatedFiles }, 'Found deprecated files and removed them');
}

function concatDependencies(dependencies: Partial<Record<string, string>>) {
  return Object.entries(dependencies)
    .map(([name, version]) => `${name}@${version}`.replace('^', ''))
    .join(' ');
}

async function downloadUrlToFile(
  url: string,
  file: string,
  replacements: Record<string, string> = {},
  silent = false
) {
  const localLogger = logger.child({ context: 'downloadUrlToFile', file, url });

  const response = await fetch(url);

  if (!response.ok) {
    if (!silent) {
      throw new Error(`unexpected response ${response.statusText}`);
    } else {
      localLogger.debug('Failed to download');
      return false;
    }
  }

  if (response.body) {
    const writeStream = createWriteStream(file);
    const rl = readline.createInterface({ input: Readable.fromWeb(response.body) });

    return new Promise<boolean>((resolve, reject) => {
      rl.on('line', line => {
        let data = line;
        for (const [from, to] of Object.entries(replacements)) {
          data = data.replace(new RegExp(from, 'g'), to);
        }
        writeStream.write(data + '\n');
      });

      rl.on('close', () => {
        writeStream.end();
      });

      rl.on('error', error => {
        reject(error);
      });

      writeStream.on('finish', () => resolve(true));
      writeStream.on('error', error => reject(error));
    });
  }

  localLogger.info({ file }, 'Finished downloading');
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
  const localProjectName = projectName ?? localPackageJson.name;
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
  };

  let packageManager: 'npm' | 'pnpm' = 'npm';

  const parentPackageJsonPath = path.join(path.dirname(path.resolve(cwd)), 'package.json');

  if (await fileExistsAccessible(parentPackageJsonPath)) {
    const parentPackageJson = await readPackageJson(parentPackageJsonPath);
    const homepage = `https://github.com/${author}/${parentPackageJson.name}`;
    const gitRepoUrl = `git@github.com:${author}/${parentPackageJson.name}`;

    if (parentPackageJson.name === 'mono') {
      packageJsonOverrides.homepage = homepage;
      packageJsonOverrides.repository = { type: 'git', url: gitRepoUrl };
      packageJsonOverrides.bugs = { url: homepage };
      packageManager = 'pnpm';
    }
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
      Object.entries(packageJsonAfterDependencyUpdates.devDependencies).filter(
        ([packageName]) => !DEPRECATED_PACKAGES.includes(packageName)
      )
    );
  }

  const packageJson = deepmerge(packageJsonAfterDependencyUpdates, packageJsonOverrides);

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

  for await (const fileName of [
    'nodemon.json',
    'tsconfig.json',
    'tsconfig.spec.json',
    '.prettierrc',
    '.gitignore',
    'jest.config.ts',
    'vitest.config.ts',
    'eslint.config.js',
    '.nvmrc',
  ]) {
    const filePath = `${baseUrl}/${fileName}`;

    const outputFilePath = `${outputPath ?? '.'}/${fileName}`;

    const result = await downloadUrlToFile(filePath, outputFilePath, replacements, true);

    if (!result) {
      await fs.rm(outputFilePath, { force: true });
    }
  }

  for await (const fileName of [
    'nodemon.json',
    'tsconfig.json',
    'tsconfig.spec.json',
    '.prettierrc',
    '.gitignore',
    'jest.config.ts',
    'vitest.config.ts',
    '.eslintrc.js',
    '.eslintrc.cjs',
    'README.md',
    'package-lock.json',
  ]) {
    await replaceInFile(`${outputPath ?? '.'}/${fileName}`, replacements);
  }
}
