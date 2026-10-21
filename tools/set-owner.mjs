// After the repository exists on GitHub: puts its owner (user or organisation) in place of the
// OWNER placeholder in the asset pack's download address, the plugin and marketplace manifests
// and both READMEs.
//   node tools/set-owner.mjs <github-owner> [repository name, default house-walk-kit]
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [owner, repo = 'house-walk-kit'] = process.argv.slice(2);
if (!owner || !/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) {
  console.error('usage: node tools/set-owner.mjs <github-owner> [repository]');
  process.exit(2);
}
const FILES = ['assets.json', 'AGENTS.md', 'skills/from-plan/SKILL.md', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'README.md', 'README.he.md', 'CLAUDE.md', 'skills/new/SKILL.md'];
for (const f of FILES) {
  const file = path.join(ROOT, f);
  const text = await readFile(file, 'utf8').catch(() => null);
  if (text == null) continue;
  const next = text.replaceAll('OWNER/house-walk-kit', `${owner}/${repo}`).replaceAll('github.com/OWNER', `github.com/${owner}`);
  if (next !== text) { await writeFile(file, next); console.log(`updated ${f}`); }
}
