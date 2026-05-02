import fs from 'fs/promises';
import type { PackageJson } from 'type-fest';
import { deepmerge } from 'deepmerge-ts';
import path from 'path';

import { downloadUrlToFile, fileExistsAccessible, readPackageJson, replaceInFile } from './file.js';
import { npmInstall, npmUnInstall } from './process.js';
import { createLogger } from './logger.js';
import { isTruthy, pick } from './utils.js';
import type { TemplaterMetadata } from './template.types.js';

const DEPRECATED_PACKAGES =
  'ts-node jest ts-jest husky @types/jest @typescript-eslint/eslint-plugin @tsconfig/node20';

const logger = createLogger().child({ name: 'templater', module: 'template' });

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

function pinVersions(dependencies: Partial<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(dependencies).map(([name, version]) => [
      name,
      (version ?? 'latest').replace('^', ''),
    ])
  );
}

async function deriveParentPackageJsonOverrides(
  parentPackageJsonPath: string,
  author: string
): Promise<PackageJson> {
  if (await fileExistsAccessible(parentPackageJsonPath)) {
    const parentPackageJson = await readPackageJson(parentPackageJsonPath);
    if (!parentPackageJson.name) {
      throw new Error('The parentpackage must have a name');
    }

    if (parentPackageJson.name === 'mono') {
      const homepage = `https://github.com/${author}/${parentPackageJson.name}`;
      const gitRepoUrl = `git@github.com:${author}/${parentPackageJson.name}`;
      const packageJsonOverrides = {
        homepage,
        repository: { type: 'git', url: gitRepoUrl },
        bugs: { url: homepage },
      };
      return packageJsonOverrides;
    }
  }
  return {};
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

  const packageManager: 'npm' | 'pnpm' = 'npm';

  const parentPackageJsonPath = path.join(path.dirname(path.resolve(cwd)), 'package.json');

  const parentPackageJsonOverrides = await deriveParentPackageJsonOverrides(
    parentPackageJsonPath,
    author
  );

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
    ...deepmerge(
      packageJsonAfterDependencyUpdates,
      packageJsonOverrides,
      parentPackageJsonOverrides
    ),
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
