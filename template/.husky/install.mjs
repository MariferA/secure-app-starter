import { existsSync } from 'node:fs';

// Containers, production installs, and source archives do not need Git hooks.
if (
  process.env.CI ||
  process.env.NODE_ENV === 'production' ||
  process.env.HUSKY === '0' ||
  !existsSync('.git')
) {
  process.exit(0);
}

const { default: husky } = await import('husky');
const error = husky();
if (error) throw new Error(`Husky installation failed: ${error}`);
