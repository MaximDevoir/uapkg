import { buildCli, parseBuildMode } from './CliBuild.js';

try {
  const mode = parseBuildMode(process.argv.slice(2));
  const metadata = await buildCli(mode);
  process.stdout.write(`[uapkg-build] Built ${metadata.mode} CLI (${metadata.displayVersion})\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
