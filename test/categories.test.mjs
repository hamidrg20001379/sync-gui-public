import assert from 'node:assert/strict';
import test from 'node:test';

import {
  categoryBreadcrumbs,
  categoryPathVariables,
  duplicateCategoryTree,
  removeCategory,
  visibleCategoryContents
} from '../lib/categories.js';

const categories = [
  { id: 'a', name: 'A', projectId: 'p', parentId: '' },
  { id: 'b', name: 'B', projectId: 'p', parentId: 'a' },
  { id: 'other', name: 'Other', projectId: 'q', parentId: '' }
];
const items = [
  { id: 'root', projectId: 'p', categoryId: '' },
  { id: 'nested', projectId: 'p', categoryId: 'a' }
];

test('visibleCategoryContents returns only immediate cards in the open folder', () => {
  assert.deepEqual(visibleCategoryContents(categories, items, 'p', 'a'), {
    categories: [categories[1]],
    items: [items[1]]
  });
});

test('categoryBreadcrumbs builds the path to a nested category', () => {
  assert.deepEqual(categoryBreadcrumbs(categories, 'b').map(category => category.id), ['a', 'b']);
});

test('removing a category removes its full subtree and items', () => {
  const sourceCategories = [
    ...categories,
    { id: 'c', name: 'C', projectId: 'p', parentId: 'b' }
  ];
  const sourceItems = [
    ...items,
    { id: 'deep', projectId: 'p', categoryId: 'c' }
  ];
  const result = removeCategory(sourceCategories, sourceItems, 'a');

  assert.deepEqual(result.categories.map(category => category.id), ['other']);
  assert.deepEqual(result.items.map(item => item.id), ['root']);
});

test('categoryPathVariables inherits and lets child categories override base paths', () => {
  const source = [
    { id: 'a', parentId: '', base_path: '/root', target_base_path: '/remote-root' },
    { id: 'b', parentId: 'a' },
    { id: 'c', parentId: 'b', base_path: '/child', target_base_path: '/remote-child' },
  ];
  assert.deepEqual(categoryPathVariables(source, 'b'), {
    BASE_PATH: '/root',
    TARGET_BASE_PATH: '/remote-root'
  });
  assert.deepEqual(categoryPathVariables(source, 'c'), {
    BASE_PATH: '/child',
    TARGET_BASE_PATH: '/remote-child'
  });
});

test('duplicating a category copies its full subtree and items', () => {
  const sourceCategories = [
    ...categories,
    { id: 'c', name: 'C', projectId: 'p', parentId: 'b' }
  ];
  const sourceItems = [
    ...items,
    { id: 'deep', name: 'Deep', projectId: 'p', categoryId: 'c', targets: [{ variables: { A: '1' } }] }
  ];
  let nextId = 0;
  const result = duplicateCategoryTree(
    sourceCategories,
    sourceItems,
    'a',
    type => `${type}-${++nextId}`
  );

  const rootCopy = result.categories.find(category => category.id === 'category-1');
  const childCopy = result.categories.find(category => category.id === 'category-2');
  const grandchildCopy = result.categories.find(category => category.id === 'category-3');
  const directItemCopy = result.items.find(item => item.id === 'item-4');
  const deepItemCopy = result.items.find(item => item.id === 'item-5');

  assert.equal(rootCopy.name, 'A copy');
  assert.equal(rootCopy.parentId, '');
  assert.equal(childCopy.parentId, rootCopy.id);
  assert.equal(grandchildCopy.parentId, childCopy.id);
  assert.equal(directItemCopy.categoryId, rootCopy.id);
  assert.equal(deepItemCopy.categoryId, grandchildCopy.id);
  assert.notEqual(deepItemCopy.targets, sourceItems.at(-1).targets);
  assert.equal(result.categories.find(category => category.id === 'other'), categories[2]);
});
