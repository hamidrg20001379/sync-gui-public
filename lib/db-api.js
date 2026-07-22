export function asTemplate(template) {
  return template && {
    id: template.id,
    name: template.name,
    relative_path: template.relativePath,
    relative_remote_path: template.relativeRemotePath,
    variable_keys: template.variableKeys,
    hidden: template.hidden
  };
}

export function asProject(project) {
  return project && {
    id: project.id,
    name: project.name,
    root_path: project.rootPath
  };
}

export function asRemote(remote) {
  return remote && {
    id: remote.id,
    name: remote.name,
    kind: remote.kind,
    root_path: remote.rootPath,
    config_json: remote.configJson
  };
}

export function asProjectRemote(projectRemote) {
  return projectRemote && {
    id: projectRemote.id,
    project_id: projectRemote.projectId,
    remote_id: projectRemote.remoteId,
    name: projectRemote.name
  };
}

export function asCategory(category) {
  return category && {
    id: category.id,
    project_remote_id: category.projectRemoteId,
    template_id: category.templateId,
    parent_id: category.parentId,
    variables: category.variables,
    hidden: category.hidden,
    sort_order: category.sortOrder
  };
}

export function asMapping(mapping) {
  return mapping && {
    id: mapping.id,
    category_id: mapping.categoryId,
    template_id: mapping.templateId,
    type: mapping.type,
    variables: mapping.variables,
    hidden: mapping.hidden,
    sort_order: mapping.sortOrder
  };
}

export function jsonText(value, fallback) {
  if (value === undefined) return fallback;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  JSON.parse(text);
  return text;
}
