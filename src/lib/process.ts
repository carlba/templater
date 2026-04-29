import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from './logger.js';

const execAsync = promisify(exec);

const logger = createLogger().child({ name: 'templater', module: 'process' });

export async function npmInstall(
  packageName?: string,
  isDevDep?: boolean,
  packageManager: 'npm' | 'pnpm' = 'npm'
) {
  const localLogger = logger.child({ context: 'npmInstall' });
  try {
    const legacyPeerDepsFlag = packageManager === 'npm' ? '--legacy-peer-deps' : '';
    const { stdout } = await execAsync(
      `${packageManager} install ${isDevDep ? '--save-dev' : ''} ${legacyPeerDepsFlag} ${packageName ?? ''}`
    );

    return stdout;
  } catch (err) {
    localLogger.error({ err });
  }
}

async function checkIfPackageIsInstalled(
  packageName: string,
  packageManager: 'npm' | 'pnpm'
): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`${packageManager} list ${packageName} --json`);
    const parsed = JSON.parse(stdout) as { dependencies?: Record<string, unknown> };
    return !!parsed.dependencies?.[packageName];
  } catch (error) {
    // Ensure unexpected errors are not silenced
    if (error instanceof Error && !('code' in error))
      logger.warn({ err: error }, 'Error while checkIfPackageIsInstalled');

    return false;
  }
}

export async function npmUnInstall(packageName: string, packageManager: 'npm' | 'pnpm' = 'npm') {
  const localLogger = logger.child({
    context: 'npmUnInstall',
    packageManager,
    cwd: process.cwd(),
  });

  try {
    const packageNames = packageName.split(' ');

    await Promise.all(
      packageNames.map(async packageName => {
        if (await checkIfPackageIsInstalled(packageName, packageManager)) {
          const { stdout } = await execAsync(`${packageManager} uninstall ${packageName}`);
          return stdout;
        }
      })
    );

    localLogger.info(`Uninstalled ${packageName}`);
  } catch (err) {
    localLogger.error({ err });
  }
}
