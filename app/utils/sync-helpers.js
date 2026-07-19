import { getProjectRemotes } from './config-helpers';

export function mappingKey(project, remote, categoryPath, mapping) {
  return `${project.id}/${remote.id}/${categoryPath.join('/')}/${mapping.id}`;
}

export function categoryLiveKey(project, remote, categoryPath) {
  return `${project.id}/${remote.id}/${categoryPath.join('/')}`;
}

export function categoryKeys(project, remote, category, path = [category.id]) {
  return [
    ...category.mappings.map((mapping) => mappingKey(project, remote, path, mapping)),
    ...category.categories.flatMap((child) => categoryKeys(project, remote, child, [...path, child.id]))
  ];
}

export function remoteKeys(project, remote) {
  return remote.categories.flatMap((category) => categoryKeys(project, remote, category));
}

export function collectCategoryTargets(config) {
  return config.projects.flatMap((project) => (
    getProjectRemotes(config, project).flatMap((remote) => (
      remote.categories.flatMap((category) => collectRemoteCategoryTargets(project, remote, category))
    ))
  ));
}

export function collectRemoteCategoryTargets(project, remote, category, path = [category.id]) {
  return [
    {
      id: categoryLiveKey(project, remote, path),
      label: `${project.label || project.id}/${remote.label || remote.id}/${path.join('/')}`,
      keys: categoryKeys(project, remote, category, path)
    },
    ...category.categories.flatMap((child) => collectRemoteCategoryTargets(project, remote, child, [...path, child.id]))
  ];
}
