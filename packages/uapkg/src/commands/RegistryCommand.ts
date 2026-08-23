import fs from 'node:fs';
import path from 'node:path';
import type { ConfigInstance } from '@uapkg/config';
import { createParseErrorDiagnostic, type Diagnostic } from '@uapkg/diagnostics';
import Log from '@uapkg/log';
import type { CompositionRoot } from '../app/CompositionRoot.js';
import type { UAPKGConfigScope, UAPKGOutputFormat, UAPKGRegistryAction } from '../cli/UAPKGCommandLine.js';
import type { Command } from './Command.js';

export interface RegistryCommandOptions {
  action: UAPKGRegistryAction;
  name?: string;
  url?: string;
  refType?: 'branch' | 'tag' | 'rev';
  refValue?: string;
  scope?: UAPKGConfigScope;
  output: UAPKGOutputFormat;
}

export interface RegistryCommandRuntime {
  isInteractiveTerminal(): boolean;
}

const processRuntime: RegistryCommandRuntime = {
  isInteractiveTerminal: () => process.stdin.isTTY === true && process.stderr.isTTY === true,
};

export class RegistryCommand implements Command {
  private configDiagnostics: readonly Diagnostic[] = [];

  constructor(
    private readonly root: CompositionRoot,
    private readonly options: RegistryCommandOptions,
    private readonly runtime: RegistryCommandRuntime = processRuntime,
  ) {}

  public async execute(): Promise<number> {
    const config = this.root.config;
    this.configDiagnostics = config.getDiagnostics();
    this.reportIfText(this.configDiagnostics);

    switch (this.options.action) {
      case 'list':
        return this.executeList(config);
      case 'add':
        return this.executeAdd(config);
      case 'remove':
        return this.executeRemove(config);
      case 'use':
        return this.executeUse(config);
      case 'auth':
        return this.executeAuth(config);
      case 'refresh':
        return this.executeRefresh(config);
      default:
        return this.fail([
          createParseErrorDiagnostic(`Unsupported registry action: ${String(this.options.action satisfies never)}`),
        ]);
    }
  }

  private executeList(config: ConfigInstance): number {
    const registries = this.options.scope
      ? config.get('registries', { scope: this.options.scope })
      : config.get('registries');
    this.print(registries ?? {});
    return 0;
  }

  private executeAdd(config: ConfigInstance): number {
    const name = this.options.name;
    const url = this.options.url;
    if (!name || !url) {
      return this.fail([createParseErrorDiagnostic('registry add requires <name> and <url>.')]);
    }

    const ref = this.resolveRef();

    const setUrl = config.set(`registries.${name}.url`, url, this.scopeOptions());
    if (!setUrl.ok) return this.fail(setUrl.diagnostics);
    this.persistPlan(setUrl.value.file, setUrl.value.values);

    const setRef = config.set(`registries.${name}.ref`, ref, this.scopeOptions());
    if (!setRef.ok) return this.fail(setRef.diagnostics);
    this.persistPlan(setRef.value.file, setRef.value.values);

    config.reload({ cwd: this.root.cwd });
    this.reportIfText(config.getDiagnostics());
    this.print({
      action: 'add',
      name,
      url,
      ref,
      scope: this.options.scope ?? 'auto',
    });
    return 0;
  }

  private executeRemove(config: ConfigInstance): number {
    const name = this.options.name;
    if (!name) {
      return this.fail([createParseErrorDiagnostic('registry remove requires <name>.')]);
    }

    const plan = config.delete(`registries.${name}`, this.scopeOptions());
    if (!plan.ok) return this.fail(plan.diagnostics);
    this.persistPlan(plan.value.file, plan.value.values);

    config.reload({ cwd: this.root.cwd });
    this.reportIfText(config.getDiagnostics());
    this.print({ action: 'remove', name, scope: this.options.scope ?? 'auto' });
    return 0;
  }

  private executeUse(config: ConfigInstance): number {
    const name = this.options.name;
    if (!name) {
      return this.fail([createParseErrorDiagnostic('registry use requires <name>.')]);
    }

    const plan = config.set('registry', name, this.scopeOptions());
    if (!plan.ok) return this.fail(plan.diagnostics);
    this.persistPlan(plan.value.file, plan.value.values);

    config.reload({ cwd: this.root.cwd });
    this.reportIfText(config.getDiagnostics());
    this.print({ action: 'use', name, scope: this.options.scope ?? 'auto' });
    return 0;
  }

  private async executeAuth(config: ConfigInstance): Promise<number> {
    if (this.options.scope) {
      return this.fail([createParseErrorDiagnostic('registry auth does not accept --global or --local.')]);
    }

    const name = this.resolveRegistryName(config);
    if (!name) return 1;
    const registryResult = this.root.registryCore.getOrCreateRegistry(name);
    if (!registryResult.ok) return this.fail(registryResult.diagnostics);

    let accessResult = await registryResult.value.probeAccess({ interactive: false });
    let usedInteractivePrompt = false;
    const hasTerminal = this.runtime.isInteractiveTerminal();
    if (!accessResult.ok && hasTerminal) {
      usedInteractivePrompt = true;
      accessResult = await registryResult.value.probeAccess({ interactive: true });
    }

    if (!accessResult.ok) {
      return this.fail(this.withAuthenticationGuidance(accessResult.diagnostics, name, hasTerminal));
    }

    this.succeedOperational(
      'auth',
      {
        action: 'auth',
        name,
        accessible: true,
        interactive: usedInteractivePrompt,
      },
      `Registry "${name}" is accessible with the current system Git credentials.`,
      accessResult.diagnostics,
    );
    return 0;
  }

  private async executeRefresh(config: ConfigInstance): Promise<number> {
    if (this.options.scope) {
      return this.fail([createParseErrorDiagnostic('registry refresh does not accept --global or --local.')]);
    }

    const name = this.resolveRegistryName(config);
    if (!name) return 1;
    const registryResult = this.root.registryCore.getOrCreateRegistry(name);
    if (!registryResult.ok) return this.fail(registryResult.diagnostics);

    const refreshResult = await registryResult.value.ensureUpToDate({
      bypassFreshnessCheck: true,
      logicalRegistryName: name,
    });
    if (!refreshResult.ok) return this.fail(refreshResult.diagnostics);
    if (refreshResult.value === 'Failed') {
      const diagnostics =
        refreshResult.diagnostics.length > 0
          ? refreshResult.diagnostics
          : [createParseErrorDiagnostic(`Registry "${name}" could not be refreshed.`)];
      return this.fail(diagnostics);
    }

    this.succeedOperational(
      'refresh',
      { action: 'refresh', name, result: refreshResult.value },
      `Registry "${name}" refreshed.`,
      refreshResult.diagnostics,
    );
    return 0;
  }

  private resolveRegistryName(config: ConfigInstance): string | undefined {
    const candidate = this.options.name ?? config.get('registry');
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
      this.fail([
        createParseErrorDiagnostic(
          `registry ${this.options.action} requires a registry alias or a selected default registry.`,
        ),
      ]);
      return undefined;
    }
    return candidate.trim();
  }

  private withAuthenticationGuidance(
    diagnostics: readonly Diagnostic[],
    name: string,
    interactiveTerminalAvailable: boolean,
  ): readonly Diagnostic[] {
    return diagnostics.map((diagnostic) => ({
      ...diagnostic,
      message: `Git could not access registry "${name}".`,
      hint: interactiveTerminalAvailable
        ? 'Configure access with a system Git credential helper, SSH key/agent, or deploy key, then retry.'
        : `No interactive terminal is available. Configure a system Git credential helper, GIT_ASKPASS, SSH key/agent, or CI deploy key, then retry 'uapkg registry auth ${name}'.`,
    }));
  }

  private resolveRef(): { type: 'branch' | 'tag' | 'rev'; value: string } {
    const type = this.options.refType ?? 'branch';
    const value = this.options.refValue ?? 'main';
    return { type, value };
  }

  private scopeOptions(): { scope?: UAPKGConfigScope } {
    return this.options.scope ? { scope: this.options.scope } : {};
  }

  private persistPlan(filePath: string, values: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(values, null, 2)}\n`, 'utf8');
  }

  private fail(diagnostics: readonly Diagnostic[]): number {
    if (this.options.output === 'json') {
      this.root.json.emit({
        status: 'error',
        command: `registry ${this.options.action}`,
        diagnostics: [...this.configDiagnostics, ...diagnostics],
      });
    } else {
      this.root.diagnostics.reportAll(diagnostics);
    }
    return 1;
  }

  private reportIfText(diagnostics: readonly Diagnostic[]): void {
    if (this.options.output === 'text') {
      this.root.diagnostics.reportAll(diagnostics);
    }
  }

  private succeedOperational(
    action: 'auth' | 'refresh',
    data: Record<string, unknown>,
    text: string,
    diagnostics: readonly Diagnostic[],
  ): void {
    if (this.options.output === 'json') {
      this.root.json.emit({
        status: 'ok',
        command: `registry ${action}`,
        data,
        diagnostics: [...this.configDiagnostics, ...diagnostics],
      });
      return;
    }

    this.root.diagnostics.reportAll(diagnostics);
    process.stdout.write(`${text}\n`);
  }

  private print(value: unknown): void {
    if (this.options.output === 'json' || typeof value === 'object') {
      Log.info(JSON.stringify(value, null, 2));
      return;
    }
    Log.info(JSON.stringify(value));
  }
}
