import { UAPKGApplication } from '../app/UAPKGApplication.ts';
import { parseUAPKGCommandLine } from './parseCommandLine.ts';

export async function runUAPKGCLI(rawArgv = process.argv) {
  const commandLine = await parseUAPKGCommandLine(rawArgv);
  return await new UAPKGApplication().run(commandLine);
}
