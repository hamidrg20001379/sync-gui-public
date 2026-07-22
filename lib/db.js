import path from 'node:path';
import { PrismaLibSql } from '@prisma/adapter-libsql';

let prisma = null;

export async function getDb() {
  if (prisma) return prisma;

  const dbPath = process.env.DATABASE_URL || `file:${path.join(process.cwd(), 'sync-gui.db')}`;

  const { PrismaClient } = await import('./generated/prisma/client.ts');
  const adapter = new PrismaLibSql({ url: dbPath });
  prisma = new PrismaClient({
    adapter
  });

  return prisma;
}

export async function seedDefaultTemplates(db) {
  const client = db || await getDb();
  await client.template.upsert({
    where: { id: 'default-category' },
    update: {},
    create: {
      id: 'default-category',
      name: 'Default category',
      relativePath: '',
      relativeRemotePath: '',
      variableKeys: '[]',
      hidden: 1
    }
  });
}
