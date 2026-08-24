import type { UAPKGCommandLine } from '../cli/UAPKGCommandLine.ts';
import { AddCommand } from '../commands/AddCommand.ts';
import { ConfigCommand } from '../commands/ConfigCommand.ts';
import { InitCommand } from '../commands/InitCommand.ts';
import { InstallCommand } from '../commands/InstallCommand.ts';
import { ListCommand } from '../commands/ListCommand.ts';
import { LoginCommand } from '../commands/LoginCommand.ts';
import { LogoutCommand } from '../commands/LogoutCommand.ts';
import { OutdatedCommand } from '../commands/OutdatedCommand.ts';
import { PackageLifecycleCommand } from '../commands/PackageLifecycleCommand.ts';
import { PackCommand } from '../commands/PackCommand.ts';
import { ProjectGetNameCommand } from '../commands/ProjectGetNameCommand.ts';
import { PublishCommand } from '../commands/PublishCommand.ts';
import { RegistryCommand } from '../commands/RegistryCommand.ts';
import { RemoveCommand } from '../commands/RemoveCommand.ts';
import { RequestsCommand } from '../commands/RequestsCommand.ts';
import { UpdateCommand } from '../commands/UpdateCommand.ts';
import { WhoamiCommand } from '../commands/WhoamiCommand.ts';
import { WhyCommand } from '../commands/WhyCommand.ts';
import { InkPromptService } from '../prompts/InkPromptService.tsx';
import { ProjectContextDetector } from '../prompts/ProjectContextDetector.ts';
import { CompositionRoot } from './CompositionRoot.ts';

/**
 * Dispatcher: maps the parsed command-line shape to a concrete command
 * implementation, wiring dependencies via {@link CompositionRoot}.
 *
 * Every command now composes over {@link CompositionRoot}. The `init` and
 * `project-get-name` commands additionally receive a prompt service +
 * project-context detector (split out of the legacy `ui/` + `services/`
 * folders in Phase 10).
 */
export class UAPKGApplication {
  async run(commandLine: UAPKGCommandLine): Promise<number> {
    const root = new CompositionRoot({ cwd: commandLine.cwd });

    switch (commandLine.command) {
      case 'install':
        return new InstallCommand(root, {
          force: commandLine.force,
          frozen: commandLine.frozen,
          dryRun: commandLine.dryRun,
          outputFormat: commandLine.outputFormat,
        }).execute();

      case 'add':
        return new AddCommand(root, {
          spec: commandLine.source,
          pin: commandLine.pin,
          dev: commandLine.dev,
          registry: commandLine.registry,
          force: commandLine.force,
          dryRun: commandLine.dryRun,
          outputFormat: commandLine.outputFormat,
        }).execute();

      case 'update':
        return new UpdateCommand(root, {
          specs: commandLine.specs,
          force: commandLine.force,
          dryRun: commandLine.dryRun,
          outputFormat: commandLine.outputFormat,
        }).execute();

      case 'remove':
        return new RemoveCommand(root, {
          packageName: commandLine.packageName,
          outputFormat: commandLine.outputFormat,
        }).execute();

      case 'outdated':
        return new OutdatedCommand(root, { outputFormat: commandLine.outputFormat }).execute();

      case 'why':
        return new WhyCommand(root, {
          target: commandLine.target,
          outputFormat: commandLine.outputFormat,
        }).execute();

      case 'list':
        return new ListCommand(root, {
          depth: commandLine.depth,
          outputFormat: commandLine.outputFormat,
        }).execute();

      case 'pack':
        return new PackCommand({
          cwd: commandLine.cwd,
          dryRun: commandLine.dryRun,
          allowMissingLfs: commandLine.allowMissingLfs,
          outFile: commandLine.outFile,
        }).execute();

      case 'config':
        return new ConfigCommand({
          cwd: commandLine.cwd,
          action: commandLine.action,
          pathToProperty: commandLine.path,
          rawValue: commandLine.value,
          scope: commandLine.scope,
          output: commandLine.output,
          showOrigin: commandLine.showOrigin,
          trace: commandLine.trace,
        }).execute();

      case 'registry':
        return new RegistryCommand(root, {
          action: commandLine.action,
          name: commandLine.name,
          url: commandLine.url,
          refType: commandLine.refType,
          refValue: commandLine.refValue,
          scope: commandLine.scope,
          output: commandLine.output,
        }).execute();

      case 'login':
        return new LoginCommand(root, {
          registry: commandLine.registry,
          deviceName: commandLine.deviceName,
          reauthorize: commandLine.reauthorize,
          outputFormat: commandLine.outputFormat,
        }).execute();

      case 'logout':
        return new LogoutCommand(root, {
          registry: commandLine.registry,
          localOnly: commandLine.localOnly,
          outputFormat: commandLine.outputFormat,
        }).execute();

      case 'whoami':
        return new WhoamiCommand(root, {
          field: commandLine.field,
          registry: commandLine.registry,
          outputFormat: commandLine.outputFormat,
        }).execute();

      case 'publish':
        return new PublishCommand(root, {
          registry: commandLine.registry,
          owner: commandLine.owner,
          repository: commandLine.repository,
          tag: commandLine.tag,
          asset: commandLine.asset,
          assetPath: commandLine.assetPath,
          auth: commandLine.auth,
          detach: commandLine.detach,
          outputFormat: commandLine.outputFormat,
        }).execute();

      case 'yank':
      case 'unyank':
      case 'unpublish':
      case 'deprecate':
      case 'undeprecate':
        return new PackageLifecycleCommand(root, {
          operation: commandLine.command,
          packageName: commandLine.packageName,
          packageVersion: commandLine.packageVersion,
          reason: commandLine.reason,
          registry: commandLine.registry,
          auth: commandLine.auth,
          detach: commandLine.detach,
          outputFormat: commandLine.outputFormat,
        }).execute();

      case 'requests':
        return new RequestsCommand(root, {
          action: commandLine.action,
          requestId: commandLine.requestId,
          registry: commandLine.registry,
          status: commandLine.status,
          watch: commandLine.watch,
          outputFormat: commandLine.outputFormat,
        }).execute();

      case 'init':
        return new InitCommand(
          root,
          { explicitKind: commandLine.type, explicitName: commandLine.name },
          new ProjectContextDetector(),
          new InkPromptService(),
        ).execute();

      case 'project-get-name':
        return new ProjectGetNameCommand(root).execute();

      default: {
        const exhaustive: never = commandLine;
        void exhaustive;
        return 1;
      }
    }
  }
}
