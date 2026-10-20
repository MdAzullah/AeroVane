import { cp, mkdir, rm, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'aerovane-dist');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(resolve(root, 'portal'), output, { recursive: true });
await cp(resolve(root, 'live-viewer/dist'), resolve(output, 'live'), { recursive: true });
await cp(resolve(root, 'saved-log-viewer'), resolve(output, 'logs'), {
  recursive: true,
  filter: source => !source.includes('/tests') && !source.endsWith('.ts') && !source.endsWith('/README.md'),
});
await copyFile(resolve(root, 'USER_GUIDE.md'), resolve(output, 'USER_GUIDE.md'));

console.log(`AeroVane production package created at ${output}`);
