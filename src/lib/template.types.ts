import type { PackageJson } from 'type-fest';

export interface TemplaterMetadata {
  managedDependencies: string[];
  managedDevDependencies: string[];
  managedScripts?: (keyof PackageJson.Scripts)[];
}
