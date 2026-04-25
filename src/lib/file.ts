import fs from 'fs/promises';
import type { PackageJson } from 'type-fest';
import path from 'path';
import { createReadStream, createWriteStream } from 'node:fs';
import { Transform, type TransformCallback } from 'node:stream';
import split2 from 'split2';
import { createLogger } from './logger.js';

const logger = createLogger().child({ name: 'templater', module: 'file' });

export async function fileExistsAccessible(filePath: string): Promise<boolean> {
  return await fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

export async function renameFile(oldPath: string, newPath: string, relative: boolean) {
  if (relative) {
    oldPath = path.resolve(oldPath);
    newPath = path.resolve(newPath);
  }

  try {
    await fs.rename(oldPath, newPath);
  } catch (error) {
    if (error instanceof Error)
      logger.error({ err: error, oldPath, newPath }, `Error renaming file`);
  }
}
export async function readPackageJson(filePath: string): Promise<PackageJson> {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data) as PackageJson;
  } catch (error) {
    logger.error({ err: error, filePath }, 'Error reading file from');
    throw error;
  }
}
export async function replaceInFile(fileName: string, replacements: Record<string, string> = {}) {
  if (!(await fileExistsAccessible(fileName))) {
    logger.debug({ fileName }, `The file did not exist`);
    return;
  }

  const readStream = createReadStream(fileName);

  const replaceStream = new Transform({
    transform(chunk: Buffer | string, encoding: BufferEncoding, callback: TransformCallback) {
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

  await new Promise<true>((resolve, reject) => {
    writeStream.on('finish', () => {
      resolve(true);
    });
    writeStream.on('error', error => {
      reject(error);
    });
  });

  await renameFile(tempFilename, fileName, true);

  logger.debug(`Finished replacing things in ${fileName}`);
}

export async function ensureDir(dir: string) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err: unknown) {
    logger.error({ err }, `Failed to ensure directory exists: \${dir}`);
    throw err;
  }
}
