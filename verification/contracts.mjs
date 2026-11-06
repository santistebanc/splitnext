import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import { z } from 'zod';
import YAML from 'yaml';
import { filesUnder } from './provenance.mjs';

const text = z.string().min(1);

const featureSchema = z.object({
  id: text.regex(/^[a-z][a-z0-9-]*$/), promise: text, entryPoint: text, contract: text, scenario: text,
  command: text, prerequisites: z.array(text).nonempty(), sideEffects: z.array(text).nonempty(),
  fidelity: text, limits: z.array(text).nonempty(), expected: z.array(text).nonempty(), oracleControls: z.array(text).nonempty(),
  negativeControl: z.object({ id: text, expectedCheck: text, fault: text }).strict(), affectedPaths: z.array(text).nonempty(),
}).strict();

export const catalogSchema = z.object({ version: z.literal(1), features: z.array(featureSchema).nonempty(),
  gates: z.array(z.object({ id: text, command: text, scope: text }).strict()).nonempty() }).strict();

export async function catalog() {
  return catalogSchema.parse(JSON.parse(await readFile('verification/features.json', 'utf8')));
}

export function artifactBoundary(workflow) {
  const errors = [];

  for (const job of Object.values(workflow.jobs))
    for (const step of job.steps ?? [])
      if (step.uses?.startsWith('actions/upload-artifact@') && step.with?.path !== '.wrangler/verification/public/')
        errors.push('CI artifacts must upload only .wrangler/verification/public/');

  return errors;
}

export function ciSemantics(workflow) {
  const errors = [];

  for (const [name, commands] of Object.entries({ check: { contracts: 'verify:check', checks: 'check:fast' }, browser: { build: 'frontend:build', browsers: 'test:e2e' } })) {
    const job = workflow.jobs[name];

    if (!job || !Number.isInteger(job['timeout-minutes']) || job['timeout-minutes'] < 1 || job['timeout-minutes'] > 45) {
      errors.push(`${name}: missing bounded CI job`);
      continue;
    }

    for (const [id, script] of Object.entries(commands))
      if (!job.steps.some((step) => step.id === id && step.run?.includes(`npm run ${script}`))) errors.push(`${name}: missing ${id} gate`);

    if (!job.steps.some((step) => step.uses?.startsWith('actions/setup-node@') && step.with?.['node-version-file'] === '.nvmrc')) errors.push(`${name}: Node must follow .nvmrc`);

    if (!job.steps.some((step) => step.run === 'node scripts/verification-ci-result.mjs' && step.if === 'always()')) errors.push(`${name}: failure summary must run always`);

    if (!job.steps.some((step) => step.uses?.startsWith('actions/upload-artifact@') && step.if === 'always()')) errors.push(`${name}: evidence upload must run always`);

    if (job.steps.some((step) => /verify:expense-recovery|verify.*run expense-recovery/.test(step.run ?? ''))) errors.push(`${name}: expense scenario already runs in e2e`);
  }

  return errors;
}

/** Shared rules must run in clients and Workers, without importing either. */
export function domainImports(file, source) {
  const errors = [];
  const syntax = parse(source, { sourceType: 'module', plugins: ['typescript'], createImportExpressions: true });
  const root = path.resolve('src/domain');

  const check = (node, specifier) => {
    const target = specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier) : null;
    const relative = target && path.relative(root, target);

    if (specifier === 'zod' || (relative !== null && !relative.startsWith('..') && !path.isAbsolute(relative))) return;
    const line = node.loc.start.line;

    errors.push(`${file}:${line}: pure domain cannot import ${specifier}`);
  };

  const visit = (node) => {
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source)
      check(node, node.source.value);

    if (node.type === 'TSImportType') check(node, node.argument.value);

    if (node.type === 'TSImportEqualsDeclaration' && node.moduleReference.type === 'TSExternalModuleReference') check(node, node.moduleReference.expression.value);

    if (node.type === 'ImportExpression') check(node, node.source.type === 'StringLiteral' ? node.source.value : '<computed module>');

    if (node.type === 'CallExpression' && (node.callee.type === 'Import' || (node.callee.type === 'Identifier' && node.callee.name === 'require')))
      check(node, node.arguments[0]?.type === 'StringLiteral' ? node.arguments[0].value : '<computed module>');

    for (const value of Object.values(node))
      for (const child of Array.isArray(value) ? value : [value])
        if (child?.type) visit(child);
  };

  visit(syntax);

  return errors;
}

export async function checkContracts() {
  const map = await catalog();
  const errors = [];
  const ids = new Set();
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

  for (const item of [...map.features, ...map.gates]) {
    if (ids.has(item.id)) errors.push(`duplicate verification id: ${item.id}`);
    ids.add(item.id);
    const script = /^npm run ([\w:-]+)/.exec(item.command)?.[1];

    if (!script || !packageJson.scripts[script]) errors.push(`${item.id}: command references missing npm script`);
  }

  for (const feature of map.features) {
    for (const ref of [feature.entryPoint, feature.contract, feature.scenario])
      if (!existsSync(ref)) errors.push(`${feature.id}: missing reference ${ref}`);

    if (new Set(feature.expected).size !== feature.expected.length) errors.push(`${feature.id}: duplicate expected check`);
  }

  const domain = (await filesUnder('src/domain')).filter((file) => file.endsWith('.ts'));

  if (!domain.length) errors.push('pure-domain boundary executed on zero files');

  for (const file of domain) errors.push(...domainImports(file, await readFile(file, 'utf8')));

  const skillPath = '.agents/skills/verify-splitnext/SKILL.md';
  const skill = await readFile(skillPath, 'utf8');

  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skill)?.[1];
  const header = frontmatter ? YAML.parse(frontmatter) : null;

  if (!header || header.name !== 'verify-splitnext' || !z.string().min(1).safeParse(header.description).success) errors.push(`${skillPath}: invalid frontmatter`);

  for (const [, ref] of skill.matchAll(/\]\(([^)]+)\)/g))
    if (!existsSync(path.resolve(path.dirname(skillPath), ref))) errors.push(`${skillPath}: missing reference ${ref}`);

  const workflow = YAML.parse(await readFile('.github/workflows/check.yml', 'utf8'));

  // A deliberate narrow allowlist: private lab data and Playwright traces contain credentials.
  errors.push(...artifactBoundary(workflow));
  errors.push(...ciSemantics(workflow));

  if (Number((await readFile('.nvmrc', 'utf8')).trim()) < 24) errors.push('Node >=24 is required for verification SQLite');

  if (errors.length) throw new Error(errors.join('\n'));

  return { status: 'passed', checks: ['feature-map', 'skill-references', 'pure-domain-imports', 'ci-artifact-boundary'], domainFiles: domain.length };
}
