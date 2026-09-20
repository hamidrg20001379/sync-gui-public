import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSyncMappings } from '../lib/sync.js';

test('sync mappings reject a target with a deleted remote', () => {
  const config = {
    remotes: [{ id: 'available', name: 'Available', kind: 'local' }],
    projects: [],
    categories: [],
    items: [{
      id: 'cms',
      name: 'CMS main controller',
      source: 'C:\\source.php',
      type: 'file',
      targets: [{ name: 'CMS target', remoteIds: ['removed'], dest: 'C:\\target.php' }]
    }]
  };

  assert.throws(
    () => resolveSyncMappings(config, 'down'),
    /CMS main controller.*CMS target.*unknown remote "removed"/
  );
});
