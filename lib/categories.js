export function visibleCategoryContents(categories, items, projectId, parentId = '') {
  return {
    categories: categories.filter(category =>
      category.projectId === projectId && (category.parentId || '') === parentId
    ),
    items: items.filter(item =>
      item.projectId === projectId && (item.categoryId || '') === parentId
    )
  };
}

export function categoryBreadcrumbs(categories, categoryId) {
  const byId = new Map(categories.map(category => [category.id, category]));
  const result = [];
  const seen = new Set();
  let current = byId.get(categoryId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    result.unshift(current);
    current = byId.get(current.parentId);
  }
  return result;
}

export function categoryPathVariables(categories, categoryId) {
  const byId = new Map(categories.map(category => [category.id, category]));
  const chain = [];
  const seen = new Set();
  let current = byId.get(categoryId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = byId.get(current.parentId);
  }

  const values = {};
  for (const category of chain) {
    if (category.base_path) values.BASE_PATH = category.base_path;
    if (category.target_base_path) values.TARGET_BASE_PATH = category.target_base_path;
  }
  return values;
}

export function removeCategory(categories, items, categoryId) {
  const removed = categories.find(category => category.id === categoryId);
  if (!removed) return { categories, items };

  const childrenByParent = new Map();
  for (const category of categories) {
    const children = childrenByParent.get(category.parentId || '') || [];
    children.push(category.id);
    childrenByParent.set(category.parentId || '', children);
  }

  const removedIds = new Set([categoryId]);
  const pending = [categoryId];
  while (pending.length) {
    const parentId = pending.shift();
    for (const childId of childrenByParent.get(parentId) || []) {
      if (removedIds.has(childId)) continue;
      removedIds.add(childId);
      pending.push(childId);
    }
  }

  return {
    categories: categories.filter(category => !removedIds.has(category.id)),
    items: items.filter(item => !removedIds.has(item.categoryId))
  };
}

function copyName(name, existingNames) {
  const base = `${name} copy`;
  if (!existingNames.includes(base)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base} ${index}`;
    if (!existingNames.includes(candidate)) return candidate;
  }
}

export function duplicateCategoryTree(
  categories,
  items,
  categoryId,
  createId = type => `${type === 'category' ? 'c' : 'i'}-${globalThis.crypto.randomUUID()}`
) {
  const root = categories.find(category => category.id === categoryId);
  if (!root) return { categories, items };

  const childrenByParent = new Map();
  for (const category of categories) {
    const siblings = childrenByParent.get(category.parentId) || [];
    siblings.push(category);
    childrenByParent.set(category.parentId, siblings);
  }

  const originals = [];
  const pending = [root];
  const seen = new Set();
  while (pending.length) {
    const category = pending.shift();
    if (seen.has(category.id)) continue;
    seen.add(category.id);
    originals.push(category);
    pending.push(...(childrenByParent.get(category.id) || []));
  }

  const usedIds = new Set([
    ...categories.map(category => category.id),
    ...items.map(item => item.id),
  ]);
  const idByOriginal = new Map();
  for (const category of originals) {
    const id = createId('category', category);
    if (!id || usedIds.has(id)) throw new Error(`Could not create a unique category ID for "${category.name}".`);
    usedIds.add(id);
    idByOriginal.set(category.id, id);
  }

  const siblingNames = categories
    .filter(category =>
      category.projectId === root.projectId &&
      (category.parentId || '') === (root.parentId || '')
    )
    .map(category => category.name);
  const categoryCopies = originals.map(category => ({
    ...structuredClone(category),
    id: idByOriginal.get(category.id),
    name: category.id === root.id ? copyName(category.name, siblingNames) : category.name,
    parentId: category.id === root.id
      ? category.parentId
      : idByOriginal.get(category.parentId),
  }));

  const itemCopies = items
    .filter(item => idByOriginal.has(item.categoryId))
    .map(item => {
      const id = createId('item', item);
      if (!id || usedIds.has(id)) throw new Error(`Could not create a unique item ID for "${item.name}".`);
      usedIds.add(id);
      return {
        ...structuredClone(item),
        id,
        categoryId: idByOriginal.get(item.categoryId),
      };
    });

  return {
    categories: [...categories, ...categoryCopies],
    items: [...items, ...itemCopies],
  };
}
