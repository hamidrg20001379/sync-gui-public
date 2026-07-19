export const blankProject = { id: '', label: '', root: '', remotes: [], streams: [], categories: [] };
export const blankStream = { id: '', label: '', remoteId: '' };
export const blankRemote = {
  id: '',
  label: '',
  kind: 'ssh',
  root: '',
  host: '',
  port: '22',
  username: '',
  password: '',
  hostEnv: 'SERVER_HOST',
  portEnv: 'SERVER_PORT',
  usernameEnv: 'SERVER_USERNAME',
  passwordEnv: 'SERVER_PASSWORD',
  categories: []
};
export const blankCategory = { id: '', label: '', categories: [], mappings: [] };
export const blankMapping = { id: '', label: '', type: 'dir', local: '', remote: '' };
