import assert from 'node:assert/strict';
import test from 'node:test';

import {
  categoryBreadcrumbs,
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

test('removing a category moves its direct contents to its parent', () => {
  const result = removeCategory(categories, items, 'a');
  assert.equal(result.categories.find(category => category.id === 'b').parentId, '');
  assert.equal(result.items.find(item => item.id === 'nested').categoryId, '');
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
