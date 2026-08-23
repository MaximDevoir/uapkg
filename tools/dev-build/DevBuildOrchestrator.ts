import type { UAPKGBuildMode } from '@uapkg/common';
import { BuildService } from './BuildService.ts';
import { CleanupService } from './CleanupService.ts';
import { DevBuildStatusPrinter } from './DevBuildStatusPrinter.ts';
import { GlobalCommandShimService } from './GlobalCommandShimService.ts';
import { GlobalUapkgDevModeService } from './GlobalUapkgDevModeService.ts';
import { GlobalUapkgSnapshotStore } from './GlobalUapkgSnapshotStore.ts';
import { GlobalUapkgStateService } from './GlobalUapkgStateService.ts';
import { ProcessRunner } from './ProcessRunner.ts';

export class DevBuildOrchestrator {
  private readonly buildService: BuildService;
  private readonly devModeService: GlobalUapkgDevModeService;
  private readonly cleanupService: CleanupService;
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    const runner = new ProcessRunner();
    this.buildService = new BuildService(runner, this.workspaceRoot);
    this.cleanupService = new CleanupService(runner, this.workspaceRoot);

    const stateService = new GlobalUapkgStateService(runner, this.workspaceRoot);
    const snapshotStore = new GlobalUapkgSnapshotStore(this.workspaceRoot);
    const statusPrinter = new DevBuildStatusPrinter();
    const shimService = new GlobalCommandShimService(runner, this.workspaceRoot);
    this.devModeService = new GlobalUapkgDevModeService(
      this.buildService,
      stateService,
      snapshotStore,
      statusPrinter,
      shimService,
    );
  }

  buildAll(mode: UAPKGBuildMode) {
    this.buildService.buildAll(mode);
  }

  link(options: { force: boolean }) {
    this.devModeService.link(options);
  }

  watch() {
    this.buildService.watchCliAndDependents();
  }

  unlink(options: { force: boolean }) {
    this.devModeService.unlink(options);
  }

  status() {
    this.devModeService.printStatus();
  }

  clean() {
    this.cleanupService.cleanBuildArtifacts();
  }

  cleanAll() {
    this.devModeService.unlink({ force: true });
    this.cleanupService.cleanAll();
  }
}
