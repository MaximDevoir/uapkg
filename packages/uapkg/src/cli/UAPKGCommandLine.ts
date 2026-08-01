export type UAPKGCommandName =
  | 'init'
  | 'add'
  | 'install'
  | 'update'
  | 'project-get-name'
  | 'config'
  | 'registry'
  | 'pack'
  | 'outdated'
  | 'why'
  | 'list'
  | 'remove'
  | 'login'
  | 'logout'
  | 'whoami'
  | 'publish'
  | 'requests';
export type UAPKGConfigAction = 'get' | 'list' | 'set' | 'delete' | 'edit';
export type UAPKGRegistryAction = 'add' | 'remove' | 'list' | 'use' | 'auth' | 'refresh';
export type UAPKGRequestsAction = 'list' | 'status';
export type UAPKGControlPlaneAuthMode = 'auto' | 'login' | 'gat' | 'oidc';
export type UAPKGRegistryRequestStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_pr_checks'
  | 'accepted'
  | 'failed'
  | 'timed_out'
  | 'finalization_failed';
export type UAPKGConfigScope = 'global' | 'local';
export type UAPKGOutputFormat = 'text' | 'json';

interface BaseCommandLine {
  command: UAPKGCommandName;
  cwd: string;
}

export interface InitCommandLine extends BaseCommandLine {
  command: 'init';
  type?: 'project' | 'plugin';
  name?: string;
}

export interface AddCommandLine extends BaseCommandLine {
  command: 'add';
  source: string;
  force: boolean;
  pin: boolean;
  dev: boolean;
  registry?: string;
  dryRun: boolean;
  outputFormat: UAPKGOutputFormat;
}

export interface InstallCommandLine extends BaseCommandLine {
  command: 'install';
  force: boolean;
  frozen: boolean;
  dryRun: boolean;
  outputFormat: UAPKGOutputFormat;
}

export interface UpdateCommandLine extends BaseCommandLine {
  command: 'update';
  specs: string[];
  force: boolean;
  dryRun: boolean;
  outputFormat: UAPKGOutputFormat;
}

export interface ProjectGetNameCommandLine extends BaseCommandLine {
  command: 'project-get-name';
}

export interface ConfigCommandLine extends BaseCommandLine {
  command: 'config';
  action: UAPKGConfigAction;
  path?: string;
  value?: string;
  scope?: UAPKGConfigScope;
  output: UAPKGOutputFormat;
  showOrigin: boolean;
  trace: boolean;
}

export interface RegistryCommandLine extends BaseCommandLine {
  command: 'registry';
  action: UAPKGRegistryAction;
  name?: string;
  url?: string;
  refType?: 'branch' | 'tag' | 'rev';
  refValue?: string;
  scope?: UAPKGConfigScope;
  output: UAPKGOutputFormat;
}

export interface PackCommandLine extends BaseCommandLine {
  command: 'pack';
  dryRun: boolean;
  allowMissingLfs: boolean;
  outFile?: string;
}

export interface OutdatedCommandLine extends BaseCommandLine {
  command: 'outdated';
  outputFormat: UAPKGOutputFormat;
}

export interface WhyCommandLine extends BaseCommandLine {
  command: 'why';
  target: string;
  outputFormat: UAPKGOutputFormat;
}

export interface ListCommandLine extends BaseCommandLine {
  command: 'list';
  depth: number;
  outputFormat: UAPKGOutputFormat;
}

export interface RemoveCommandLine extends BaseCommandLine {
  command: 'remove';
  packageName: string;
  outputFormat: UAPKGOutputFormat;
}

export interface LoginCommandLine extends BaseCommandLine {
  command: 'login';
  registry?: string;
  deviceName?: string;
  reauthorize: boolean;
  outputFormat: UAPKGOutputFormat;
}

export interface LogoutCommandLine extends BaseCommandLine {
  command: 'logout';
  registry?: string;
  localOnly: boolean;
  outputFormat: UAPKGOutputFormat;
}

export interface WhoamiCommandLine extends BaseCommandLine {
  command: 'whoami';
  registry?: string;
  outputFormat: UAPKGOutputFormat;
}

export interface PublishCommandLine extends BaseCommandLine {
  command: 'publish';
  registry?: string;
  owner?: string;
  repository?: string;
  tag?: string;
  asset?: string;
  manifestPath?: string;
  auth: UAPKGControlPlaneAuthMode;
  detach: boolean;
  outputFormat: UAPKGOutputFormat;
}

export interface RequestsCommandLine extends BaseCommandLine {
  command: 'requests';
  action: UAPKGRequestsAction;
  requestId?: string;
  registry?: string;
  status?: UAPKGRegistryRequestStatus;
  watch: boolean;
  outputFormat: UAPKGOutputFormat;
}

export type UAPKGCommandLine =
  | InitCommandLine
  | AddCommandLine
  | InstallCommandLine
  | UpdateCommandLine
  | ProjectGetNameCommandLine
  | ConfigCommandLine
  | RegistryCommandLine
  | PackCommandLine
  | OutdatedCommandLine
  | WhyCommandLine
  | ListCommandLine
  | RemoveCommandLine
  | LoginCommandLine
  | LogoutCommandLine
  | WhoamiCommandLine
  | PublishCommandLine
  | RequestsCommandLine;

export interface CommonCommandLineOptions {
  cwd?: string;
}

export interface AddCommandLineOptions extends CommonCommandLineOptions {
  force?: boolean;
  pin?: boolean;
  dev?: boolean;
  registry?: string;
  dryRun?: boolean;
  outputFormat?: UAPKGOutputFormat;
}

export interface InstallOrUpdateCommandLineOptions extends CommonCommandLineOptions {
  force?: boolean;
  frozen?: boolean;
  dryRun?: boolean;
  outputFormat?: UAPKGOutputFormat;
}

export interface UpdateFactoryOptions extends InstallOrUpdateCommandLineOptions {
  specs?: string[];
}

export interface OutdatedFactoryOptions extends CommonCommandLineOptions {
  outputFormat?: UAPKGOutputFormat;
}

export interface WhyFactoryOptions extends CommonCommandLineOptions {
  outputFormat?: UAPKGOutputFormat;
}

export interface ListFactoryOptions extends CommonCommandLineOptions {
  depth?: number;
  outputFormat?: UAPKGOutputFormat;
}

export interface RemoveFactoryOptions extends CommonCommandLineOptions {
  outputFormat?: UAPKGOutputFormat;
}

export interface RegistryAuthCommandLineOptions extends CommonCommandLineOptions {
  registry?: string;
  outputFormat?: UAPKGOutputFormat;
}

export interface LoginCommandLineOptions extends RegistryAuthCommandLineOptions {
  deviceName?: string;
  reauthorize?: boolean;
}

export interface LogoutCommandLineOptions extends RegistryAuthCommandLineOptions {
  localOnly?: boolean;
}

export interface PublishCommandLineOptions extends RegistryAuthCommandLineOptions {
  owner?: string;
  repository?: string;
  tag?: string;
  asset?: string;
  manifestPath?: string;
  auth?: UAPKGControlPlaneAuthMode;
  detach?: boolean;
}

export interface RequestsCommandLineOptions extends RegistryAuthCommandLineOptions {
  requestId?: string;
  status?: UAPKGRegistryRequestStatus;
  watch?: boolean;
}

export interface ConfigCommonOptions extends CommonCommandLineOptions {
  scope?: UAPKGConfigScope;
  output?: UAPKGOutputFormat;
}

export interface RegistryCommandLineOptions extends ConfigCommonOptions {
  name?: string;
  url?: string;
  refType?: 'branch' | 'tag' | 'rev';
  refValue?: string;
}

export interface ConfigGetOptions extends ConfigCommonOptions {
  showOrigin?: boolean;
  trace?: boolean;
}

export interface PackCommandLineOptions extends CommonCommandLineOptions {
  dryRun?: boolean;
  allowMissingLfs?: boolean;
  outFile?: string;
}

export class UAPKGCommandLineFactory {
  constructor(private readonly cwdProvider: () => string = () => process.cwd()) {}

  createInit(options: { type?: 'project' | 'plugin'; name?: string } & CommonCommandLineOptions = {}): InitCommandLine {
    return {
      command: 'init',
      cwd: this.resolveCwd(options.cwd),
      type: options.type,
      name: options.name,
    };
  }

  createAdd(source: string, options: AddCommandLineOptions = {}): AddCommandLine {
    return {
      command: 'add',
      cwd: this.resolveCwd(options.cwd),
      source,
      force: options.force === true,
      pin: options.pin === true,
      dev: options.dev === true,
      registry: options.registry,
      dryRun: options.dryRun === true,
      outputFormat: options.outputFormat ?? 'text',
    };
  }

  createInstall(options: InstallOrUpdateCommandLineOptions = {}): InstallCommandLine {
    return {
      command: 'install',
      cwd: this.resolveCwd(options.cwd),
      force: options.force === true,
      frozen: options.frozen === true,
      dryRun: options.dryRun === true,
      outputFormat: options.outputFormat ?? 'text',
    };
  }

  createUpdate(options: UpdateFactoryOptions = {}): UpdateCommandLine {
    return {
      command: 'update',
      cwd: this.resolveCwd(options.cwd),
      specs: options.specs ?? [],
      force: options.force === true,
      dryRun: options.dryRun === true,
      outputFormat: options.outputFormat ?? 'text',
    };
  }

  createOutdated(options: OutdatedFactoryOptions = {}): OutdatedCommandLine {
    return {
      command: 'outdated',
      cwd: this.resolveCwd(options.cwd),
      outputFormat: options.outputFormat ?? 'text',
    };
  }

  createWhy(target: string, options: WhyFactoryOptions = {}): WhyCommandLine {
    return {
      command: 'why',
      cwd: this.resolveCwd(options.cwd),
      target,
      outputFormat: options.outputFormat ?? 'text',
    };
  }

  createList(options: ListFactoryOptions = {}): ListCommandLine {
    return {
      command: 'list',
      cwd: this.resolveCwd(options.cwd),
      depth: options.depth ?? 0,
      outputFormat: options.outputFormat ?? 'text',
    };
  }

  createRemove(packageName: string, options: RemoveFactoryOptions = {}): RemoveCommandLine {
    return {
      command: 'remove',
      cwd: this.resolveCwd(options.cwd),
      packageName,
      outputFormat: options.outputFormat ?? 'text',
    };
  }

  createLogin(options: LoginCommandLineOptions = {}): LoginCommandLine {
    return {
      command: 'login',
      cwd: this.resolveCwd(options.cwd),
      registry: options.registry,
      deviceName: options.deviceName,
      reauthorize: options.reauthorize === true,
      outputFormat: options.outputFormat ?? 'text',
    };
  }

  createLogout(options: LogoutCommandLineOptions = {}): LogoutCommandLine {
    return {
      command: 'logout',
      cwd: this.resolveCwd(options.cwd),
      registry: options.registry,
      localOnly: options.localOnly === true,
      outputFormat: options.outputFormat ?? 'text',
    };
  }

  createWhoami(options: RegistryAuthCommandLineOptions = {}): WhoamiCommandLine {
    return {
      command: 'whoami',
      cwd: this.resolveCwd(options.cwd),
      registry: options.registry,
      outputFormat: options.outputFormat ?? 'text',
    };
  }

  createPublish(options: PublishCommandLineOptions = {}): PublishCommandLine {
    return {
      command: 'publish',
      cwd: this.resolveCwd(options.cwd),
      registry: options.registry,
      owner: options.owner,
      repository: options.repository,
      tag: options.tag,
      asset: options.asset,
      manifestPath: options.manifestPath,
      auth: options.auth ?? 'auto',
      detach: options.detach === true,
      outputFormat: options.outputFormat ?? 'text',
    };
  }

  createRequests(action: UAPKGRequestsAction, options: RequestsCommandLineOptions = {}): RequestsCommandLine {
    return {
      command: 'requests',
      action,
      cwd: this.resolveCwd(options.cwd),
      requestId: options.requestId,
      registry: options.registry,
      status: options.status,
      watch: options.watch === true,
      outputFormat: options.outputFormat ?? 'text',
    };
  }

  createProjectGetName(options: CommonCommandLineOptions = {}): ProjectGetNameCommandLine {
    return {
      command: 'project-get-name',
      cwd: this.resolveCwd(options.cwd),
    };
  }

  createConfigGet(path: string, options: ConfigGetOptions = {}): ConfigCommandLine {
    return {
      command: 'config',
      action: 'get',
      cwd: this.resolveCwd(options.cwd),
      path,
      scope: options.scope,
      output: options.output ?? 'text',
      showOrigin: options.showOrigin === true,
      trace: options.trace === true,
    };
  }

  createConfigList(options: ConfigCommonOptions = {}): ConfigCommandLine {
    return {
      command: 'config',
      action: 'list',
      cwd: this.resolveCwd(options.cwd),
      scope: options.scope,
      output: options.output ?? 'text',
      showOrigin: false,
      trace: false,
    };
  }

  createConfigSet(path: string, value: string, options: ConfigCommonOptions = {}): ConfigCommandLine {
    return {
      command: 'config',
      action: 'set',
      cwd: this.resolveCwd(options.cwd),
      path,
      value,
      scope: options.scope,
      output: options.output ?? 'text',
      showOrigin: false,
      trace: false,
    };
  }

  createConfigDelete(path: string, options: ConfigCommonOptions = {}): ConfigCommandLine {
    return {
      command: 'config',
      action: 'delete',
      cwd: this.resolveCwd(options.cwd),
      path,
      scope: options.scope,
      output: options.output ?? 'text',
      showOrigin: false,
      trace: false,
    };
  }

  createConfigEdit(options: ConfigCommonOptions = {}): ConfigCommandLine {
    return {
      command: 'config',
      action: 'edit',
      cwd: this.resolveCwd(options.cwd),
      scope: options.scope,
      output: options.output ?? 'text',
      showOrigin: false,
      trace: false,
    };
  }

  createRegistry(action: UAPKGRegistryAction, options: RegistryCommandLineOptions = {}): RegistryCommandLine {
    return {
      command: 'registry',
      action,
      cwd: this.resolveCwd(options.cwd),
      name: options.name,
      url: options.url,
      refType: options.refType,
      refValue: options.refValue,
      scope: options.scope,
      output: options.output ?? 'text',
    };
  }

  createPack(options: PackCommandLineOptions = {}): PackCommandLine {
    return {
      command: 'pack',
      cwd: this.resolveCwd(options.cwd),
      dryRun: options.dryRun === true,
      allowMissingLfs: options.allowMissingLfs === true,
      outFile: options.outFile,
    };
  }

  private resolveCwd(cwd?: string) {
    return cwd ?? this.cwdProvider();
  }
}

export function createUAPKGCommandLineFactory(cwdProvider?: () => string) {
  return new UAPKGCommandLineFactory(cwdProvider);
}
