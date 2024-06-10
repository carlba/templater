/* eslint-disable no-prototype-builtins */
import * as fs from 'fs/promises';
import { PackageJson } from 'type-fest';
import { deepmerge } from 'deepmerge-ts';
import path from 'path';
import { pick } from './utils';
import { Transform, Readable } from 'node:stream';
import { createWriteStream } from 'node:fs';
import split2 from 'split2';
import { readPackageJson, replaceInFile } from './file-utils';
import { npmInstall } from './process-utils';

async function downloadUrlToFile(
  url: string,
  file: string,
  replacements: Record<string, string> = {}
) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`unexpected response ${response.statusText}`);
  }

  const replaceStream = new Transform({
    transform(chunk: string, encoding, callback) {
      let data = chunk.toString();

      for (const [from, to] of Object.entries(replacements)) {
        data = data.replace(new RegExp(from, 'g'), to);
      }
      callback(null, data + '\n');
    },
  });

  if (response.body) {
    const writeStream = createWriteStream(file);
    // https://nodejs.org/api/stream.html#streamreadablefromwebreadablestream-options
    Readable.fromWeb(response.body).pipe(split2()).pipe(replaceStream).pipe(writeStream);

    return new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });
  }

  console.log(`Finished downloading ${file}`);
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

  const packageJsonOverridesFromTemplate = {
    ...pick(templatePackageJson, ['scripts']),
    name: localProjectName,
    homepage: `https://github.com/${author}/${localProjectName}`,
    repository: { type: 'git', url: `git@github.com:${author}/${localProjectName}` },
    author,
  };

  if (templatePackageJson.devDependencies) {
    const devDependenciesString = Object.entries(templatePackageJson.devDependencies).map(
      ([name, version]) => `${name}@${version}`.replace('^', '')
    );
    await npmInstall(devDependenciesString.join(' '), true);
  }

  if (templatePackageJson.dependencies) {
    const dependenciesString = Object.entries(templatePackageJson.dependencies).map(
      ([name, version]) => `${name}@${version}`.replace('^', '')
    );
    await npmInstall(dependenciesString.join(' '), false);
  }

  const packageJson = deepmerge(localPackageJson, packageJsonOverridesFromTemplate);

  await fs.mkdir(cwd, { recursive: true });
  if (outputPath) {
    await fs.mkdir(outputPath, { recursive: true });
  }

  process.chdir(cwd);

  try {
    await fs.writeFile(
      `${outputPath ?? '.'}/package.json`,
      JSON.stringify(packageJson, null, 2) + '\n'
    );
    console.log('Successfully wrote to file');
  } catch (e) {
    console.error('Error writing file', e);
  }
  const replacements =
    templatePackageJson.name && localProjectName
      ? { [templatePackageJson.name]: localProjectName }
      : {};

  for await (const fileName of [
    'nodemon.json',
    'tsconfig.json',
    'tsconfig.spec.json',
    '.prettierrc',
    '.gitignore',
    'jest.config.ts',
    '.eslintrc.js',
  ]) {
    if (fileName === '.eslintrc.js' && localPackageJson.type === 'module') {
      await downloadUrlToFile(
        `${baseUrl}/${fileName}`,
        `${outputPath ?? '.'}/${fileName}`.replace('.js', '.cjs'),
        replacements
      );
    } else {
      await downloadUrlToFile(
        `${baseUrl}/${fileName}`,
        `${outputPath ?? '.'}/${fileName}`,
        replacements
      );
    }
  }

  for await (const fileName of [
    'nodemon.json',
    'tsconfig.json',
    'tsconfig.spec.json',
    '.prettierrc',
    '.gitignore',
    'jest.config.ts',
    '.eslintrc.js',
    'README.md',
    'package-lock.json',
  ]) {
    await replaceInFile(`${outputPath ?? '.'}/${fileName}`, replacements);
  }
}
