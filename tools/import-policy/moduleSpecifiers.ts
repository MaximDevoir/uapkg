import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync, Visitor, type ESTree } from 'vite/rolldown/utils';
import { isProductionModule, isRelativeModule } from './policy.ts';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

// Supplement Oxlint's import rules for import types, template literals and locally created require functions.
// This uses the parser already shipped with Vite+, without another linter or parser dependency.
export function moduleSpecifiers(path: string, source: string): string[] {
  const result = parseSync(path, source);
  if (result.errors.length > 0) {
    throw new Error(`${path}: ${result.errors.map((error) => error.message).join('; ')}`);
  }
  const requireFactories = new Set<string>();
  const moduleBindings = new Set<string>(['module']);
  const requireBindings = new Set<string>(['require']);
  const specifiers: string[] = [];

  function record(node: ESTree.Node | null | undefined): void {
    if (node?.type === 'Literal' && typeof node.value === 'string') specifiers.push(node.value);
    if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
      specifiers.push(node.quasis[0].value.cooked ?? node.quasis[0].value.raw);
    }
  }

  function isMember(node: ESTree.Expression, objects: Set<string>, property: string): boolean {
    return (
      node.type === 'MemberExpression' &&
      node.object.type === 'Identifier' &&
      objects.has(node.object.name) &&
      ((!node.computed && node.property.type === 'Identifier' && node.property.name === property) ||
        (node.computed && node.property.type === 'Literal' && node.property.value === property))
    );
  }

  // Collect bindings before usages, since import declarations need not be textually first.
  new Visitor({
    ImportDeclaration(node) {
      if (!['node:module', 'module'].includes(node.source.value)) return;
      for (const binding of node.specifiers) {
        if (binding.type === 'ImportSpecifier') {
          const imported = binding.imported.type === 'Identifier' ? binding.imported.name : binding.imported.value;
          if (imported === 'createRequire') requireFactories.add(binding.local.name);
        } else {
          moduleBindings.add(binding.local.name);
        }
      }
    },
  }).visit(result.program);
  new Visitor({
    VariableDeclarator(node) {
      if (node.id.type !== 'Identifier' || node.init?.type !== 'CallExpression') return;
      const callee = node.init.callee;
      if (
        (callee.type === 'Identifier' && requireFactories.has(callee.name)) ||
        isMember(callee, moduleBindings, 'createRequire')
      ) {
        requireBindings.add(node.id.name);
      }
    },
  }).visit(result.program);
  new Visitor({
    ImportDeclaration: (node) => record(node.source),
    ExportAllDeclaration: (node) => record(node.source),
    ExportNamedDeclaration: (node) => record(node.source),
    ImportExpression: (node) => record(node.source),
    TSImportType: (node) => record(node.source),
    TSExternalModuleReference: (node) => record(node.expression),
    CallExpression(node) {
      const callee = node.callee;
      if (
        (callee.type === 'Identifier' && requireBindings.has(callee.name)) ||
        isMember(callee, moduleBindings, 'require') ||
        isMember(callee, requireBindings, 'resolve')
      ) {
        record(node.arguments[0]);
      }
    },
  }).visit(result.program);
  return specifiers;
}

export function relativeModuleImports(path: string, source: string): string[] {
  return moduleSpecifiers(path, source).filter(isRelativeModule);
}

export function productionModulePaths(): string[] {
  const packages = resolve(repositoryRoot, 'packages');
  return readdirSync(packages, { withFileTypes: true }).flatMap((entry) => {
    const sourceRoot = resolve(packages, entry.name, 'src');
    if (!entry.isDirectory() || !existsSync(sourceRoot)) return [];
    return readdirSync(sourceRoot, { recursive: true, encoding: 'utf8' })
      .map((path) => `packages/${entry.name}/src/${path.replaceAll('\\', '/')}`)
      .filter(isProductionModule);
  });
}
