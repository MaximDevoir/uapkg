import type { Argv } from 'yargs';
import type { UAPKGCommandLine } from '../UAPKGCommandLine.js';
import type { UAPKGCommandModule } from './contracts/UAPKGCommandModule.js';
import { AddCommandModule } from './modules/AddCommandModule.js';
import { ConfigCommandModule } from './modules/ConfigCommandModule.js';
import { InitCommandModule } from './modules/InitCommandModule.js';
import { InstallCommandModule } from './modules/InstallCommandModule.js';
import { LifecycleCommandModule } from './modules/LifecycleCommandModule.js';
import { ListCommandModule } from './modules/ListCommandModule.js';
import { LoginCommandModule } from './modules/LoginCommandModule.js';
import { LogoutCommandModule } from './modules/LogoutCommandModule.js';
import { OutdatedCommandModule } from './modules/OutdatedCommandModule.js';
import { PackCommandModule } from './modules/PackCommandModule.js';
import { ProjectGetNameCommandModule } from './modules/ProjectGetNameCommandModule.js';
import { PublishCommandModule } from './modules/PublishCommandModule.js';
import { RegistryCommandModule } from './modules/RegistryCommandModule.js';
import { RemoveCommandModule } from './modules/RemoveCommandModule.js';
import { RequestsCommandModule } from './modules/RequestsCommandModule.js';
import { UpdateCommandModule } from './modules/UpdateCommandModule.js';
import { WhoamiCommandModule } from './modules/WhoamiCommandModule.js';
import { WhyCommandModule } from './modules/WhyCommandModule.js';

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
