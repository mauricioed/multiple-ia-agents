'use strict';
const MODES = new Set(['ask', 'auto', 'full', 'custom', 'read']);
function permissionMode(value) { return MODES.has(value) ? value : 'ask'; }
function codexPermissions(value, root) {
  const mode = permissionMode(value);
  if (mode === 'custom') return { thread: {}, turn: {} };
  const approvalPolicy = mode === 'full' ? 'never' : 'on-request';
  const approvalsReviewer = mode === 'auto' ? 'auto_review' : 'user';
  const sandbox = mode === 'full' ? 'danger-full-access' : mode === 'read' ? 'read-only' : 'workspace-write';
  const sandboxPolicy = mode === 'full' ? { type: 'dangerFullAccess' } : mode === 'read' ? { type: 'readOnly' } : { type: 'workspaceWrite', writableRoots: [root], networkAccess: false };
  return { thread: { approvalPolicy, approvalsReviewer, sandbox }, turn: { approvalPolicy, approvalsReviewer, sandboxPolicy } };
}
function permissionArguments(provider, value) {
  const mode = permissionMode(value);
  if (mode === 'custom') return [];
  if (provider === 'codex') {
    const { thread } = codexPermissions(mode);
    return ['--sandbox', thread.sandbox, '--ask-for-approval', thread.approvalPolicy, '-c', 'approvals_reviewer="' + thread.approvalsReviewer + '"'];
  }
  return [];
}
module.exports = { permissionArguments, MODES, permissionMode, codexPermissions };
