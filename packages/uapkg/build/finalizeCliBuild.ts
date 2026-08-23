import { finalizeCliBuild, parseBuildMode } from './CliBuild.ts';

try {
  const mode = parseBuildMode(process.argv.slice(2));
  const metadata = await finalizeCliBuild(mode);
  process.stdout.write(`[uapkg-build] Finalized ${metadata.mode} CLI (${metadata.displayVersion})\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
