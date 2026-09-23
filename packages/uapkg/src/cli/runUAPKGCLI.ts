import { UAPKGApplication } from '#cli/app/UAPKGApplication.ts';
import { parseUAPKGCommandLine } from '#cli/cli/parseCommandLine.ts';

export async function runUAPKGCLI(rawArgv = process.argv) {
  const commandLine = await parseUAPKGCommandLine(rawArgv);
  return await new UAPKGApplication().run(commandLine);
}
