/* eslint-disable no-prototype-builtins */
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { PackageJson } from 'type-fest';
import { deepmerge } from 'deepmerge-ts';
import path from 'path';
import { pick } from './utils';
import { Transform, Readable } from 'node:stream';
import { createWriteStream } from 'node:fs';
import split2 from 'split2';
import { createReadStream } from 'fs';
import { rename, access } from 'fs/promises';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function renameFile(oldPath: string, newPath: string, relative: boolean) {
  if (relative) {
    oldPath = path.resolve(oldPath);
    newPath = path.resolve(newPath);
  }

  try {
    await rename(oldPath, newPath);
    // console.log(`Successfully renamed file from ${oldPath} to ${newPath}`);
  } catch (error) {
    if (error instanceof Error)
      console.error(`Error renaming file from ${oldPath} to ${newPath}: ${error.message}`);
  }
}

async function readPackageJson(filePath: string): Promise<PackageJson> {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const json = JSON.parse(data) as PackageJson;

    if (json === undefined) {
      throw Error('Could not parse json from file');
    }
    return json;
  } catch (error) {
    console.error(`Error reading file from ${filePath}`, error);
    throw error;
  }
}

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

async function replaceInFile(fileName: string, replacements: Record<string, string> = {}) {
  if (!(await fileExists(fileName))) {
    console.log(`The file ${fileName} did not exist`);
  }

  const readStream = createReadStream(fileName);

  const replaceStream = new Transform({
    transform(chunk: string, encoding, callback) {
      let data = chunk.toString();

      for (const [from, to] of Object.entries(replacements)) {
        data = data.replace(new RegExp(from, 'g'), to);
      }
      callback(null, data + '\n');
    },
  });

  const tempFilename = `${fileName}.tmp`;
  const writeStream = createWriteStream(tempFilename);

  readStream.pipe(split2()).pipe(replaceStream).pipe(writeStream);

  await new Promise((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });

  await renameFile(tempFilename, fileName, true);

  console.log(`Finished replacing things in ${fileName}`);
}

async function runCommand(command: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    console.log(`Running command ${command}`);
    return exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function npmInstall(packageName?: string, isDevDep?: boolean) {
  if (packageName && !isDevDep) {
    throw new Error('isDevDep must be defined if a package name is used');
  }

  console.log('current cwd', process.cwd());
  try {
    const { stdout, stderr } = await runCommand(
      `npm install ${isDevDep ? '--save-dev' : ''} ${packageName ? packageName : ''}`
    );

    console.log(stdout, stderr);
  } catch (e) {
    console.log(e);
  }
}

export async function run(baseUrl: string, cwd: string, outputPath?: string) {
  const packageJsonPath = path.join(cwd, 'package.json');

  const templatePackageJson = (await fetch(`${baseUrl}/package.json`).then(response =>
    response.json()
  )) as PackageJson;

  const localPackageJson = await readPackageJson(packageJsonPath);

  const packageJsonOverridesFromTemplate = pick(templatePackageJson, ['scripts']);

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
    await fs.writeFile(`${outputPath ?? '.'}/package.json`, JSON.stringify(packageJson, null, 2));
    console.log('Successfully wrote to file');
  } catch (e) {
    console.error('Error writing file', e);
  }
  const replacements =
    templatePackageJson.name && localPackageJson.name
      ? { [templatePackageJson.name]: localPackageJson.name }
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
  ]) {
    await replaceInFile(`${outputPath ?? '.'}/${fileName}`, replacements);
  }
}
