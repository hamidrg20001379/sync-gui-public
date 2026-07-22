import { readJsonConfig } from '../lib/config.js';
import { writeDbConfig } from '../lib/db-config.js';

async function migrate() {
  console.log('Starting migration from JSON config to database...');

  const config = await readJsonConfig();
  console.log(`Migrating ${config.projects.length} projects, ${config.remotes.length} remotes, and stream mappings...`);
  await writeDbConfig(config);
  console.log('Migration completed successfully!');
}

migrate().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
