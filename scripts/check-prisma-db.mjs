import assert from 'node:assert/strict';
import { getDb, seedDefaultTemplates } from '../lib/db.js';

const db = await getDb();

await seedDefaultTemplates(db);

const template = await db.template.findUnique({
  where: { id: 'default-category' }
});

assert.equal(template?.name, 'Default category');
assert.equal(template?.variableKeys, '[]');
assert.equal(template?.hidden, 1);

await db.$disconnect();
console.log('prisma database self-check passed');
