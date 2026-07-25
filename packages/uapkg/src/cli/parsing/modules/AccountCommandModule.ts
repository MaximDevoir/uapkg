import type { Argv } from 'yargs';
import { createUAPKGCommandLineFactory, type UAPKGAccountAction } from '../../UAPKGCommandLine.js';
import type { CommandLineSink, UAPKGCommandModule } from '../contracts/UAPKGCommandModule.js';

const ACCOUNT_ACTIONS = ['status', 'logout', 'token-list', 'token-create', 'token-revoke'] as const;

export class AccountCommandModule implements UAPKGCommandModule {
  private readonly factory = createUAPKGCommandLineFactory();

  register(parser: Argv, sink: CommandLineSink): Argv {
    return parser.command(
      'account <action>',
      'Manage publishing-platform account session and API tokens',
      (builder) =>
        builder
          .positional('action', {
            type: 'string',
            choices: ACCOUNT_ACTIONS,
            describe: 'Account action to execute',
            demandOption: true,
          })
          .option('api-url', {
            type: 'string',
            describe: 'Publishing platform API base URL',
            default: process.env.UAPKG_ACCOUNT_API_URL,
          })
          .option('bearer', {
            type: 'string',
            describe: 'Bearer token for account API authentication',
            default: process.env.UAPKG_ACCOUNT_BEARER_TOKEN,
          })
          .option('token-id', {
            type: 'string',
            describe: 'Token id for token-revoke action',
          })
          .option('name', {
            type: 'string',
            describe: 'Token name for token-create action',
          })
          .option('resource-owner', {
            type: 'string',
            describe: 'Resource-owner organization UUID for token-create action',
          })
          .option('expires-in-days', {
            type: 'number',
            default: 30,
            describe: 'Token expiration in days for token-create action',
          })
          .option('registry-access', {
            type: 'string',
            choices: ['none', 'all', 'selected'] as const,
            default: 'none',
            describe: 'Registry Access mode for token-create action',
          })
          .option('registry-id', {
            type: 'string',
            array: true,
            default: [],
            describe: 'Selected owned registry UUID for token-create action (repeatable)',
          })
          .option('package-access', {
            type: 'string',
            choices: ['none', 'all', 'selected'] as const,
            default: 'none',
            describe: 'Package Access mode for token-create action',
          })
          .option('package-id', {
            type: 'string',
            array: true,
            default: [],
            describe: 'Selected owned package UUID for token-create action (repeatable)',
          })
          .option('permission', {
            type: 'string',
            array: true,
            default: [],
            describe: 'Optional token permission beyond required reads (repeatable)',
          })
          .option('justification', {
            type: 'string',
            describe: 'Approval justification for token-create action',
          })
          .option('json', {
            type: 'boolean',
            default: false,
            describe: 'Emit JSON on stdout',
          }),
      (argv) => {
        sink.set(
          this.factory.createAccount(String(argv.action) as UAPKGAccountAction, {
            cwd: process.cwd(),
            outputFormat: argv.json ? 'json' : 'text',
            apiUrl: typeof argv['api-url'] === 'string' ? argv['api-url'] : undefined,
            bearerToken: typeof argv.bearer === 'string' ? argv.bearer : undefined,
            tokenId: typeof argv['token-id'] === 'string' ? argv['token-id'] : undefined,
            tokenName: typeof argv.name === 'string' ? argv.name : undefined,
            tokenResourceOwnerOrganizationId:
              typeof argv['resource-owner'] === 'string' ? argv['resource-owner'] : undefined,
            tokenRegistryAccessMode:
              argv['registry-access'] === 'all' || argv['registry-access'] === 'selected'
                ? argv['registry-access']
                : 'none',
            tokenRegistryIds: Array.isArray(argv['registry-id'])
              ? argv['registry-id'].filter((entry): entry is string => typeof entry === 'string')
              : [],
            tokenPackageAccessMode:
              argv['package-access'] === 'all' || argv['package-access'] === 'selected'
                ? argv['package-access']
                : 'none',
            tokenPackageIds: Array.isArray(argv['package-id'])
              ? argv['package-id'].filter((entry): entry is string => typeof entry === 'string')
              : [],
            tokenPermissions: Array.isArray(argv.permission)
              ? argv.permission.filter((entry): entry is string => typeof entry === 'string')
              : [],
            tokenExpiresInDays: typeof argv['expires-in-days'] === 'number' ? argv['expires-in-days'] : undefined,
            tokenJustification: typeof argv.justification === 'string' ? argv.justification : undefined,
          }),
        );
      },
    );
  }
}
