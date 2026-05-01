import type { Diagnostic, DiagnosticLevel } from '@uapkg/diagnostics';

/**
 * Process-wide aggregator for all diagnostics emitted by `@uapkg/registry-tools`.
 *
 * Goals:
 *  - Single source of truth for CI consumers that want one consolidated list of
 *    warnings and errors across an entire run.
 *  - Plan-then-apply flows do not double-report: diagnostics with
 *    `emitPolicy: 'once'` are deduplicated by their stable `emitFingerprint`.
 *
 * This is a true singleton — instantiating multiple `RegistryTools` objects in
 * the same process all push into the same aggregator.
 */
export class RegistryToolsAggregator {
  private static instance: RegistryToolsAggregator | undefined;

  private readonly items: Diagnostic[] = [];
  private readonly seenFingerprints = new Set<string>();

  /** Get (or lazily create) the process-wide singleton aggregator. */
  static getInstance(): RegistryToolsAggregator {
    if (!RegistryToolsAggregator.instance) {
      RegistryToolsAggregator.instance = new RegistryToolsAggregator();
    }
    return RegistryToolsAggregator.instance;
  }

  /** Replace the singleton — primarily intended for tests. */
  static resetForTests(): void {
    RegistryToolsAggregator.instance = new RegistryToolsAggregator();
  }

  /**
   * Add a diagnostic to the aggregator.
   *
   * If the diagnostic uses `emitPolicy: 'once'` and a matching fingerprint has
   * already been recorded, the call is a no-op and the method returns `false`.
   */
  add(diagnostic: Diagnostic): boolean {
    if (diagnostic.emitPolicy === 'once' && diagnostic.emitFingerprint) {
      if (this.seenFingerprints.has(diagnostic.emitFingerprint)) {
        return false;
      }
      this.seenFingerprints.add(diagnostic.emitFingerprint);
    }
    this.items.push(diagnostic);
    return true;
  }

  /** Add many diagnostics. */
  addMany(diagnostics: readonly Diagnostic[]): void {
    for (const d of diagnostics) {
      this.add(d);
    }
  }

  /** All diagnostics collected so far, in insertion order. */
  all(): readonly Diagnostic[] {
    return this.items;
  }

  /** Diagnostics filtered by level. */
  byLevel(level: DiagnosticLevel): readonly Diagnostic[] {
    return this.items.filter((d) => d.level === level);
  }

  errors(): readonly Diagnostic[] {
    return this.byLevel('error');
  }

  warnings(): readonly Diagnostic[] {
    return this.byLevel('warning');
  }

  hasErrors(): boolean {
    return this.items.some((d) => d.level === 'error');
  }

  /** Wipe collected diagnostics. */
  clear(): void {
    this.items.length = 0;
    this.seenFingerprints.clear();
  }
}

/** Convenience accessor for the process-wide singleton. */
export function getRegistryToolsAggregator(): RegistryToolsAggregator {
  return RegistryToolsAggregator.getInstance();
}
