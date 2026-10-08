import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const core = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Copies a fixture project to a temporary folder and links this checkout, GSAP, and HyperFrames into its
 * node_modules exactly as a real project resolves them. `edit` may rewrite the copied index.html.
 */
export async function fixtureProject(fixture: string, edit: (html: string) => string = html => html): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'explainery-fixture-'));
  await cp(join(core, 'tests/fixtures', fixture), dir, { recursive: true });
  await mkdir(join(dir, 'node_modules'));
  await symlink(core, join(dir, 'node_modules/explainery-core'));
  for (const name of ['gsap', 'hyperframes']) await symlink(join(core, 'node_modules', name), join(dir, 'node_modules', name));
  const index = join(dir, 'index.html');
  await writeFile(index, edit(await readFile(index, 'utf8')));
  return dir;
}
