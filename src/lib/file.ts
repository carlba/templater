import fs from 'fs/promises';
import type { PackageJson } from 'type-fest';
import path from 'path';
import { createLogger } from './logger.js';

const logger = createLogger().child({ name: 'templater', module: 'file' });

/**
 * Check whether a file exists and is accessible.
 *
 * @param filePath - The path to the file to check.
 * @returns True if the file can be accessed, otherwise false.
 */
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

type ReplaceResult = 'changed' | 'unchanged' | 'failed' | 'nonexisting';

/**
 * Replace text in a file using the provided replacements.
 *
 * @param fileName - The file to modify.
 * @param replacements - Mapping from pattern to replacement text.
 * @returns 'changed' when the file was updated, 'unchanged' when no edits were needed, or 'failed' when the operation could not complete.
 */
export async function replaceInFile(
  fileName: string,
  replacements: Record<string, string> = {}
): Promise<ReplaceResult> {
  if (!(await fileExistsAccessible(fileName))) {
    logger.debug({ fileName }, `The file did not exist`);
    return 'nonexisting';
  }

  try {
    const originalContent = await fs.readFile(fileName, 'utf-8');
    let updatedContent = originalContent;

    for (const [from, to] of Object.entries(replacements)) {
      updatedContent = updatedContent.replace(new RegExp(from, 'g'), to);
    }

    if (updatedContent === originalContent) {
      logger.debug(`No changes needed for ${fileName}`);
      return 'unchanged';
    }

    const tempFilename = `${fileName}.tmp`;
    await fs.writeFile(tempFilename, updatedContent, 'utf-8');
    await renameFile(tempFilename, fileName, true);

    logger.debug(`Finished replacing things in ${fileName}`);
    return 'changed';
  } catch (error) {
    logger.error({ err: error, fileName }, `Failed replacing things in ${fileName}`);
    return 'failed';
  }
}

export async function ensureDir(dir: string) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err: unknown) {
    logger.error({ err }, `Failed to ensure directory exists: \${dir}`);
    throw err;
  }
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
export async function downloadUrlToFile(
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
