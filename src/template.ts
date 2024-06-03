/* eslint-disable no-prototype-builtins */
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { PackageJson } from 'type-fest';
import { deepmerge } from 'deepmerge-ts';
import path from 'path';

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

async function downloadUrlToFile(url: string, file: string) {
  const response = await fetch(url);

  const arrayBuffer = await response.arrayBuffer();

  try {
    await fs.writeFile(file, Buffer.from(arrayBuffer));
    console.log(`Successfully wrote to file ${file}`);
  } catch (e) {
    console.error('Error writing file', e);
    throw Error(`Error downloading url ${url} to fille ${file}`);
  }

  console.log(`finished downloading ${file}`);
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

async function npmInstall(packageName: string, isDevDep: boolean) {
  console.log('current cwd', process.cwd());
  try {
    const { stdout, stderr } = await runCommand(
      `npm install ${isDevDep ? '--save-dev' : ''} ${packageName}`
    );

    console.log(stdout, stderr);
  } catch (e) {
    console.log(e);
  }
}

export async function run(
  baseUrl: string,
  cwd: string,
  outputPath?: string,
  packageJsonOverrides?: PackageJson
) {
  const packageJsonPath = path.join(cwd, 'package.json');

  const packageJson = packageJsonOverrides
    ? deepmerge(await readPackageJson(packageJsonPath), packageJsonOverrides)
    : await readPackageJson(packageJsonPath);

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

  for await (const fileName of [
    'nodemon.json',
    'tsconfig.json',
    'tsconfig.spec.json',
    '.prettierrc',
    '.gitignore',
    'jest.config.ts',
    '.eslintrc.js',
  ]) {
    await downloadUrlToFile(`${baseUrl}/${fileName}`, `${outputPath ?? '.'}/${fileName}`);
  }

  await npmInstall('typescript-eslint', true);
  await npmInstall('eslint@^8.57.0', true);
}
