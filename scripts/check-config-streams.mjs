import assert from 'node:assert/strict';
import { flattenMappings, readConfig } from '../lib/config.js';

const config = await readConfig();
const rows = flattenMappings(config);

for (const project of config.projects) {
  assert.ok(project.streams?.length, `${project.id} has no streams`);
  for (const stream of project.streams) {
    for (const category of stream.categories) {
      checkStreamCategory(project.id, stream.id, category);
    }
  }
}

assert.ok(rows.length, 'no sync mappings were derived');
for (const row of rows) {
  assert.ok(row.mapping.remote, `${row.key} has no compatibility remote path`);
}

console.log(`Config streams ok: ${config.projects.length} projects, ${rows.length} mappings.`);

function checkStreamCategory(projectId, streamId, category) {
  for (const mapping of category.mappings) {
    assert.ok(Array.isArray(mapping.remotePaths), `${projectId}/${streamId}/${category.id}/${mapping.id} has no remotePaths`);
  }
  for (const child of category.categories) {
    checkStreamCategory(projectId, streamId, child);
  }
}
