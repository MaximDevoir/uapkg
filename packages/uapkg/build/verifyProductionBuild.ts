import { verifyProductionBuild } from './CliBuild.ts';

try {
  await verifyProductionBuild();
  process.stdout.write('[uapkg-build] Verified production CLI artifact\n');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
