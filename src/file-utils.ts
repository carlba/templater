import * as fs from 'fs/promises';
import { PackageJson } from 'type-fest';
import path from 'path';
import { rename, access } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import split2 from 'split2';

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
export async function renameFile(oldPath: string, newPath: string, relative: boolean) {
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
export async function readPackageJson(filePath: string): Promise<PackageJson> {
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
export async function replaceInFile(fileName: string, replacements: Record<string, string> = {}) {
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
