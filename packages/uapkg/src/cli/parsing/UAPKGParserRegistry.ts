import type { Argv } from 'yargs';
import type { UAPKGCommandLine } from '../UAPKGCommandLine.ts';
import type { UAPKGCommandModule } from './contracts/UAPKGCommandModule.ts';
import { AddCommandModule } from './modules/AddCommandModule.ts';
import { ConfigCommandModule } from './modules/ConfigCommandModule.ts';
import { InitCommandModule } from './modules/InitCommandModule.ts';
import { InstallCommandModule } from './modules/InstallCommandModule.ts';
import { LifecycleCommandModule } from './modules/LifecycleCommandModule.ts';
import { ListCommandModule } from './modules/ListCommandModule.ts';
import { LoginCommandModule } from './modules/LoginCommandModule.ts';
import { LogoutCommandModule } from './modules/LogoutCommandModule.ts';
import { OutdatedCommandModule } from './modules/OutdatedCommandModule.ts';
import { PackCommandModule } from './modules/PackCommandModule.ts';
import { ProjectGetNameCommandModule } from './modules/ProjectGetNameCommandModule.ts';
import { PublishCommandModule } from './modules/PublishCommandModule.ts';
import { RegistryCommandModule } from './modules/RegistryCommandModule.ts';
import { RemoveCommandModule } from './modules/RemoveCommandModule.ts';
import { RequestsCommandModule } from './modules/RequestsCommandModule.ts';
import { UpdateCommandModule } from './modules/UpdateCommandModule.ts';
import { WhoamiCommandModule } from './modules/WhoamiCommandModule.ts';
import { WhyCommandModule } from './modules/WhyCommandModule.ts';

export class UAPKGParserRegistry {
  constructor(
    private readonly modules: UAPKGCommandModule[] = [
      new InitCommandModule(),
      new AddCommandModule(),
      new InstallCommandModule(),
      new UpdateCommandModule(),
      new RemoveCommandModule(),
      new OutdatedCommandModule(),
      new WhyCommandModule(),
      new ListCommandModule(),
      new PackCommandModule(),
      new ProjectGetNameCommandModule(),
      new ConfigCommandModule(),
      new RegistryCommandModule(),
      new LoginCommandModule(),
      new LogoutCommandModule(),
      new WhoamiCommandModule(),
      new PublishCommandModule(),
      new LifecycleCommandModule(),
      new RequestsCommandModule(),
    ],
  ) {}

  registerAll(parser: Argv, sink: { set: (commandLine: UAPKGCommandLine) => void }) {
    let next = parser;
    for (const module of this.modules) {
      next = module.register(next, sink);
    }

    return next;
  }
}
