import { UAPKGCommandLineParser } from './parsing/UAPKGCommandLineParser.ts';

const parser = new UAPKGCommandLineParser();

export async function parseUAPKGCommandLine(rawArgv = process.argv) {
  return await parser.parse(rawArgv);
}
