import assert from 'node:assert/strict';
import { readConfig, writeConfig } from '../lib/config.js';

const config = await readConfig();
const mapping = config.projects
  .flatMap((project) => project.streams || [])
  .flatMap((stream) => stream.categories || [])
  .flatMap((category) => category.mappings || [])[0];

assert.ok(mapping, 'expected at least one mapping');

const originalTemplateId = mapping.templateId;
const originalVariables = mapping.variables;
mapping.templateId = 'default-category';
mapping.variables = { ...(mapping.variables || {}), roundtripCheck: 'ok' };
await writeConfig(config);

const nextConfig = await readConfig();
const nextMapping = nextConfig.projects
  .flatMap((project) => project.streams || [])
  .flatMap((stream) => stream.categories || [])
  .flatMap((category) => category.mappings || [])
  .find((item) => item.id === mapping.id);

assert.equal(nextMapping?.templateId, 'default-category');
assert.equal(nextMapping?.variables?.roundtripCheck, 'ok');

nextMapping.templateId = originalTemplateId;
nextMapping.variables = originalVariables;
await writeConfig(nextConfig);
console.log('template round-trip passed');
