import { getDb, seedDefaultTemplates } from './db.js';
import { normalizeConfig, validateConfig } from './config.js';

const templateId = 'default-category';

export async function readDbConfig() {
  const db = await getDb();
  const [projects, remotes, projectRemotes, streams, categories, mappings, syncTargets] = await Promise.all([
    db.project.findMany({ orderBy: { id: 'asc' } }),
    db.remote.findMany({ orderBy: { id: 'asc' } }),
    db.projectRemote.findMany({ orderBy: { id: 'asc' } }),
    db.stream.findMany({ orderBy: { id: 'asc' } }),
    db.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
    db.mapping.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
    db.syncTarget.findMany({ orderBy: { id: 'asc' } })
  ]);

  if (projects.length === 0 && remotes.length === 0) return null;

  const categoriesByParent = Map.groupBy(categories, (category) => category.parentId || '');
  const mappingsByCategory = Map.groupBy(mappings, (mapping) => mapping.categoryId);

  const config = {
    projects: projects.map((project) => {
      const remotesForProject = projectRemotes
        .filter((remote) => remote.projectId === project.id)
        .map((remote) => ({
          id: lastIdPart(remote.id),
          remoteId: remote.remoteId,
          label: remote.name,
          categories: buildCategories(categoriesByParent, mappingsByCategory, { projectRemoteId: remote.id })
        }));

      return {
        id: project.id,
        label: project.name,
        root: project.rootPath,
        remotes: remotesForProject,
        streams: streams
          .filter((stream) => stream.projectId === project.id)
          .map((stream) => ({
            id: lastIdPart(stream.id),
            label: stream.name,
            categories: buildCategories(categoriesByParent, mappingsByCategory, { streamId: stream.id })
          })),
        syncTargets: syncTargets
          .filter((target) => target.projectId === project.id)
          .map((target) => target.targetKey)
      };
    }),
    remotes: remotes.map((remote) => ({
      id: remote.id,
      label: remote.name,
      kind: remote.kind,
      root: remote.rootPath || '',
      ...parseJson(remote.configJson, {})
    })),
    ui: {}
  };

  normalizeConfig(config);
  validateConfig(config);
  return config;
}

export async function writeDbConfig(config) {
  normalizeConfig(config);
  validateConfig(config);

  const db = await getDb();
  await db.$transaction(async (tx) => {
    await tx.mapping.deleteMany();
    await tx.category.deleteMany();
    await tx.syncTarget.deleteMany();
    await tx.stream.deleteMany();
    await tx.projectRemote.deleteMany();
    await tx.project.deleteMany();
    await tx.remote.deleteMany();
    await seedDefaultTemplates(tx);

    for (const remote of config.remotes) {
      await tx.remote.create({
        data: {
          id: remote.id,
          name: remote.label || remote.id,
          kind: remote.kind || 'ssh',
          rootPath: remote.root || null,
          configJson: JSON.stringify({
            host: remote.host || '',
            port: remote.port || '',
            username: remote.username || '',
            password: remote.password || '',
            hostEnv: remote.hostEnv || '',
            portEnv: remote.portEnv || '',
            usernameEnv: remote.usernameEnv || '',
            passwordEnv: remote.passwordEnv || ''
          })
        }
      });
    }

    for (const project of config.projects) {
      await tx.project.create({
        data: { id: project.id, name: project.label || project.id, rootPath: project.root }
      });

      for (const [sortOrder, targetKey] of project.syncTargets.entries()) {
        await tx.syncTarget.create({
          data: { id: `${project.id}:target:${sortOrder}`, projectId: project.id, targetKey }
        });
      }

      for (const remote of project.remotes) {
        const projectRemoteId = `${project.id}:remote:${remote.id}`;
        await tx.projectRemote.create({
          data: {
            id: projectRemoteId,
            projectId: project.id,
            remoteId: remote.remoteId || remote.id,
            name: remote.label || remote.id
          }
        });
        await writeCategories(tx, remote.categories || [], { projectRemoteId });
      }

      for (const stream of project.streams || []) {
        await tx.stream.create({
          data: { id: `${project.id}:stream:${stream.id}`, projectId: project.id, name: stream.label || stream.id }
        });
        await writeCategories(tx, stream.categories || [], { streamId: `${project.id}:stream:${stream.id}` });
      }
    }
  });
}

function buildCategories(categoriesByParent, mappingsByCategory, owner, parentId = '') {
  return (categoriesByParent.get(parentId) || [])
    .filter((category) => owner.projectRemoteId
      ? category.projectRemoteId === owner.projectRemoteId
      : category.streamId === owner.streamId)
    .filter((category) => !category.hidden)
    .map((category) => {
      const vars = parseJson(category.variables, {});
      return {
        id: vars.id || lastIdPart(category.id),
        label: vars.label || vars.id || lastIdPart(category.id),
        categories: buildCategories(categoriesByParent, mappingsByCategory, owner, category.id),
        mappings: (mappingsByCategory.get(category.id) || [])
          .filter((mapping) => !mapping.hidden)
          .map((mapping) => {
            const mappingVars = parseJson(mapping.variables, {});
            return {
              id: mappingVars.id || lastIdPart(mapping.id),
              label: mappingVars.label || mappingVars.id || lastIdPart(mapping.id),
              type: mapping.type,
              local: mappingVars.local || '',
              remote: mappingVars.remote || '',
              ...(mappingVars.remoteId ? { remoteId: mappingVars.remoteId } : {})
            };
          })
      };
    });
}

async function writeCategories(tx, categories, owner, parentId = null, prefix = '') {
  for (const [sortOrder, category] of categories.entries()) {
    const categoryId = `${owner.projectRemoteId || owner.streamId}:${prefix}${category.id}`;
    await tx.category.create({
      data: {
        id: categoryId,
        projectRemoteId: owner.projectRemoteId || null,
        streamId: owner.streamId || null,
        templateId,
        parentId,
        variables: JSON.stringify({ id: category.id, label: category.label || category.id }),
        sortOrder
      }
    });

    for (const [mappingSortOrder, mapping] of (category.mappings || []).entries()) {
      await tx.mapping.create({
        data: {
          id: `${categoryId}:${mapping.id}`,
          categoryId,
          templateId,
          type: mapping.type,
          variables: JSON.stringify({
            id: mapping.id,
            label: mapping.label || mapping.id,
            local: mapping.local,
            remote: mapping.remote,
            remoteId: mapping.remoteId || ''
          }),
          sortOrder: mappingSortOrder
        }
      });
    }

    await writeCategories(tx, category.categories || [], owner, categoryId, `${prefix}${category.id}:`);
  }
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch {
    return fallback;
  }
}

function lastIdPart(value) {
  return String(value).split(':').at(-1);
}
