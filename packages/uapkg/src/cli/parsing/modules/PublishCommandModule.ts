import type { Argv } from 'yargs';
import { createUAPKGCommandLineFactory, type UAPKGControlPlaneAuthMode } from '../../UAPKGCommandLine.js';
import type { CommandLineSink, UAPKGCommandModule } from '../contracts/UAPKGCommandModule.js';

const AUTH_MODES = ['auto', 'login', 'gat', 'oidc'] as const;

export class PublishCommandModule implements UAPKGCommandModule {
  private readonly factory = createUAPKGCommandLineFactory();

  register(parser: Argv, sink: CommandLineSink): Argv {
    return parser.command(
      'publish',
      'Submit a GitHub Release for authorized publication',
      (builder) =>
        builder
          .option('registry', { type: 'string', describe: 'Configured registry alias' })
          .option('owner', { type: 'string', describe: 'Owner organization for a new unscoped package' })
          .option('repository', { type: 'string', describe: 'GitHub owner/repository coordinate' })
          .option('tag', { type: 'string', describe: 'GitHub Release tag (defaults to v<version>)' })
          .option('asset', { type: 'string', describe: 'GitHub Release asset name (defaults to package.tgz)' })
          .option('manifest-path', {
            type: 'string',
            describe: 'Repository-relative package manifest path',
          })
          .option('auth', {
            type: 'string',
            choices: AUTH_MODES,
            default: 'auto',
            describe: 'Publishing authentication method',
          })
          .option('detach', {
            type: 'boolean',
            default: false,
            describe: 'Return immediately after submitting the publishing request',
          })
          .option('json', {
            type: 'boolean',
            default: false,
            describe: 'Emit JSON on stdout',
          }),
      (argv) => {
        sink.set(
          this.factory.createPublish({
            cwd: process.cwd(),
            registry: stringOption(argv.registry),
            owner: stringOption(argv.owner),
            repository: stringOption(argv.repository),
            tag: stringOption(argv.tag),
            asset: stringOption(argv.asset),
            manifestPath: stringOption(argv['manifest-path']),
            auth: String(argv.auth) as UAPKGControlPlaneAuthMode,
            detach: argv.detach === true,
            outputFormat: argv.json ? 'json' : 'text',
          }),
        );
      },
    );
  }
}

function stringOption(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
