import { cp, mkdir, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIST = join(ROOT, 'dist');

function runtimeJavaScript(source) {
  return stripTypeScriptTypes(source, { mode: 'strip' })
    .replace(/(from\s+['"])(\.\.?\/[^'"]+)\.mts(['"])/g, '$1$2.js$3');
}

async function compileDirectory(sourceDirectory, destinationDirectory) {
  await mkdir(destinationDirectory, { recursive: true });
  for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
    const source = join(sourceDirectory, entry.name);
    if (entry.isDirectory()) {
      await compileDirectory(source, join(destinationDirectory, entry.name));
    } else if (entry.isFile() && entry.name.endsWith('.mts') && !entry.name.endsWith('.test.mts')) {
      await writeFile(join(destinationDirectory, `${entry.name.slice(0, -4)}.js`), runtimeJavaScript(await readFile(source, 'utf8')));
    }
  }
}

await rm(DIST, { recursive: true, force: true });
await compileDirectory(join(ROOT, 'src'), join(DIST, 'src'));
