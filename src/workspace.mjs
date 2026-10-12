export function isPersonalWorkspace(workspace) {
  return workspace?.is_personal === true ||
    [workspace?.type, workspace?.workspace_type, workspace?.structure]
      .some(value => String(value || '').toLowerCase() === 'personal') ||
    /\bpersonal\b|个人/i.test(String(workspace?.title || workspace?.name || ''))
}

export function chooseWorkspace(workspaces, { index = 1, expectedAccountId } = {}) {
  if (!Array.isArray(workspaces)) throw new Error('The consent page did not return a workspace list')
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('workspace index must be a non-negative integer')
  const usable = workspaces.filter(item => item && item.disabled !== true && typeof item.id === 'string' && item.id.trim())
  const personal = usable.filter(isPersonalWorkspace)
  const teams = usable.filter(item => !isPersonalWorkspace(item))

  if (expectedAccountId) {
    const exact = usable.find(item => item.id === expectedAccountId)
    if (exact) return exact
    if (!teams.length && personal[0]) return personal[0]
    throw new Error('The expected account ID is not present in the consent workspace list')
  }
  if (index === 0) {
    if (!personal[0]) throw new Error('No personal workspace is available')
    return personal[0]
  }

  // If the provider returns no team workspace, automatically use personal.
  // This is the important fallback: do not invent a personal workspace ID.
  return (teams.length ? teams[index - 1] : personal[index - 1] || personal[0]) ||
    (() => { throw new Error(`workspace index ${index} is out of range`) })()
}
