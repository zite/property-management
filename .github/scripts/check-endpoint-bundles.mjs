// Reports real endpoint bundling errors.
//
// `zitejs check` runs the bundler through execFileSync with Node's default 1 MB
// maxBuffer. These apps print more than that, so the call throws ENOBUFS and
// check prints "bundle endpoints ✗" with no error attached, on a fine tree.
// Bundling to a file and reading `endpointErrors` is the reliable form.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APPS = ["property-management","resident-portal"];
const dir = mkdtempSync(join(tmpdir(), 'zite-bundle-'));
let failed = false;

for (const app of APPS) {
  const out = join(dir, `${app}.json`);
  try {
    execFileSync('sh', ['-c', `npx zitejs bundle --app ${app} > ${out}`], { stdio: 'inherit' });
  } catch {
    console.error(`${app}: bundler exited non-zero`);
    failed = true;
    continue;
  }
  const lines = readFileSync(out, 'utf8').split('\n').filter((l) => l.startsWith('{'));
  if (!lines.length) {
    console.error(`${app}: bundler produced no JSON result`);
    failed = true;
    continue;
  }
  const result = JSON.parse(lines.at(-1));
  const count = Object.keys(result.bundledEndpoints ?? {}).length;
  const errors = result.endpointErrors ?? result.error;
  if (errors) {
    console.error(`${app}: ${JSON.stringify(errors)}`);
    failed = true;
  } else {
    console.log(`${app}: ${count} endpoints bundled cleanly`);
  }
}

process.exit(failed ? 1 : 0);
