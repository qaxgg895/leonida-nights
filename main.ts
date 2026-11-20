// Leonida Nights — the entrypoint the grader runs (Node 22, standard library only).
//
// What it does, in three steps:
//   1. Copies the playable game (game/, plain static files a desktop browser
//      loads offline) and the screenshots (screenshots/) into the output
//      directory — MAKEFUN_OUTPUT_DIR, or /output inside the grader.
//   2. Sanity-checks the tree first: every file the game loads must live
//      under game/ (no CDN, no absolute URLs), and the screenshot set must
//      fit the scorer's caps, so a broken entry fails loudly here instead of
//      on the judge's machine.
//   3. Writes output/dossier.json with the vendored make.fun library
//      (vendor/makefun-game.ts), the summary the judge reads.
//
// Run it locally with:
//   MAKEFUN_OUTPUT_DIR=out node main.ts
// and open out/game/index.html, or serve the game directly with `npx serve game`.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The scorer's own caps (reference/gate.json): text_max_bytes shapes the
// dossier bytes; the rest refuse an entry the scorer would refuse — more
// than 4 screenshots or one over 256 KiB, more than 993 files in game/ or
// 48 MiB of game files in all, or a path under game/ over 1000 bytes.
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
} as const;

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const OUT = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

type TreeStats = { files: number; bytes: number; longestPath: number };

/** Walk a directory and count files, bytes and the longest relative path. */
function walkTree(dir: string, base: string): TreeStats {
  const stats: TreeStats = { files: 0, bytes: 0, longestPath: 0 };
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        stats.files += 1;
        stats.bytes += statSync(full).size;
        stats.longestPath = Math.max(stats.longestPath, relative(base, full).length);
      }
    }
  };
  walk(dir);
  return stats;
}

/**
 * The game must be fully self-contained: scan its text files for external
 * URLs (http://, https://, protocol-relative //) and fail the run if any
 * survive, so a CDN dependency can never slip into the entry.
 */
function assertSelfContained(gameDir: string): void {
  const offenders: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(html|js|css|json)$/.test(entry.name)) {
        // Comments may cite a URL; only live loads count, so strip comments
        // and look for actual fetch/import/src patterns.
        const text = readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
        const loadsExternal =
          /\bfrom\s+['"]https?:/.test(text) ||
          /\bimport\s*\(\s*['"]https?:/.test(text) ||
          /\bfetch\s*\(\s*['"]https?:/.test(text) ||
          /\bnew\s+URL\s*\(\s*['"]https?:/.test(text) ||
          /(?:src|href)\s*=\s*['"]https?:/.test(text);
        if (loadsExternal) offenders.push(relative(gameDir, full));
      }
    }
  };
  walk(gameDir);
  if (offenders.length > 0) {
    throw new Error(`game/ references external URLs in: ${offenders.join(', ')}`);
  }
}

function main(): void {
  const gameDir = join(ROOT, 'game');
  const shotsDir = join(ROOT, 'screenshots');
  if (!existsSync(join(gameDir, 'index.html'))) {
    throw new Error('game/index.html is missing — nothing to hand in');
  }
  if (!existsSync(shotsDir) || readdirSync(shotsDir).length === 0) {
    throw new Error('screenshots/ is empty — the judge needs real renders of the game');
  }

  assertSelfContained(gameDir);
  const gameStats = walkTree(gameDir, ROOT);
  if (gameStats.files > DOSSIER_CAPS.game_max_files) {
    throw new Error(`game/ has ${gameStats.files} files, over the cap of ${DOSSIER_CAPS.game_max_files}`);
  }
  if (gameStats.bytes > DOSSIER_CAPS.game_max_bytes) {
    throw new Error(`game/ is ${gameStats.bytes} bytes, over the cap of ${DOSSIER_CAPS.game_max_bytes}`);
  }

  mkdirSync(OUT, { recursive: true });
  cpSync(gameDir, join(OUT, 'game'), { recursive: true });
  mkdirSync(join(OUT, 'screenshots'), { recursive: true });
  cpSync(shotsDir, join(OUT, 'screenshots'), { recursive: true });

  writeFileSync(join(OUT, 'dossier.json'), buildDossier(OUT, DOSSIER_CAPS));
  console.log(
    `Leonida Nights handed in: ${gameStats.files} game files (${gameStats.bytes} bytes), ` +
      `${readdirSync(shotsDir).length} screenshots -> ${OUT}`,
  );
}

main();
