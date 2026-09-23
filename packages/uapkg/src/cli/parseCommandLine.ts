import { UAPKGCommandLineParser } from '#cli/cli/parsing/UAPKGCommandLineParser.ts';

const parser = new UAPKGCommandLineParser();

export async function parseUAPKGCommandLine(rawArgv = process.argv) {
  return await parser.parse(rawArgv);
}
