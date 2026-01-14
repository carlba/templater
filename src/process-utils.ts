import { exec } from 'child_process';
import { promisify } from 'util';
import { LOGGER } from './logger.js';

const execAsync = promisify(exec);

const logger = LOGGER.child({ module: 'process-utils' });

export async function npmInstall(
  packageName?: string,
  isDevDep?: boolean,
  packageManager: 'npm' | 'pnpm' = 'npm'
) {
  const localLogger = logger.child({ context: 'npmInstall' });
  if (packageName && !isDevDep) {
    throw new Error('isDevDep must be defined if a package name is used');
  }

  try {
    const { stdout } = await execAsync(
      `${packageManager} install ${isDevDep ? '--save-dev' : ''} ${packageName ? packageName : ''}`
    );

    localLogger.info({ stdout });
  } catch (e) {
    localLogger.error({ err: e });
  }
}

async function checkIfPackageIsInstalled(
  packageName: string,
  packageManager: 'npm' | 'pnpm'
): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`${packageManager} list ${packageName} --json`);
    const parsed = JSON.parse(stdout);
    return !!parsed.dependencies?.[packageName];
  } catch (error) {
    // Ensure unexpected errors are not silenced
    if (error instanceof Error && !('code' in error))
      logger.warn({ err: error }, 'Error while checkIfPackageIsInstalled');

    return false;
  }
}

export async function npmUnInstall(packageName: string, packageManager: 'npm' | 'pnpm' = 'npm') {
  const localLogger = logger.child({ context: 'npmUnInstall', packageManager, cwd: process.cwd() });

  try {
    const packageNames = packageName.split(' ');

    const result = Promise.all(
      packageNames.map(async packageName => {
        if (await checkIfPackageIsInstalled(packageName, packageManager)) {
          const { stdout } = await execAsync(`${packageManager} uninstall ${packageName}`);
          return stdout;
        }
      })
    );

    localLogger.info({ result });
  } catch (err) {
    localLogger.error({ err });
  }
}
