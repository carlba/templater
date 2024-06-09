import { exec } from 'child_process';

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
export async function npmInstall(packageName?: string, isDevDep?: boolean) {
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
