import { parseDocument } from 'htmlparser2'

const walk = node => [node, ...(node.children || []).flatMap(walk)]
const text = node => node.type === 'text' ? node.data : ['script', 'style'].includes(node.name) ? '' : (node.children || []).map(text).join(' ')

// React Router sends loader data as a flat reference array inside a JSON
// string. Decode data only; never evaluate the surrounding inline JavaScript.
function streamedWorkspaces(nodes) {
  for (const node of nodes.filter(node => node.name === 'script')) {
    const body = (node.children || []).map(child => child.data || '').join('')
    for (const match of body.matchAll(/streamController\.enqueue\(("(?:\\.|[^"\\])*")\)/g)) {
      try {
        const flat = JSON.parse(JSON.parse(match[1]))
        if (!Array.isArray(flat)) continue
        const key = flat.indexOf('workspaces')
        if (key < 0) continue
        const decode = (index, active = new Set()) => {
          if (!Number.isInteger(index) || index < 0 || index >= flat.length || active.has(index) || active.size > 12) return undefined
          const value = flat[index], seen = new Set([...active, index])
          if (Array.isArray(value)) return value.map(ref => decode(ref, seen))
          if (value && typeof value === 'object') {
            const result = Object.create(null)
            for (const [name, ref] of Object.entries(value)) {
              if (!/^_\d+$/.test(name)) continue
              const field = flat[Number(name.slice(1))]
              if (typeof field === 'string') result[field] = decode(ref, seen)
            }
            return result
          }
          return value
        }
        for (const entry of flat) {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !Object.hasOwn(entry, '_' + key)) continue
          const list = decode(entry['_' + key])
          if (!Array.isArray(list)) continue
          const workspaces = list.filter(item => item && typeof (item.id || item.workspace_id) === 'string' && (item.id || item.workspace_id).trim() && item.disabled !== true)
            .map(item => ({ id: item.id || item.workspace_id, title: item.title || item.name || '', type: item.type || item.workspace_type || item.structure || '', is_personal: item.is_personal === true }))
          if (workspaces.length) return workspaces
        }
      } catch { /* Unsupported or partial stream data falls back to form controls. */ }
    }
  }
  return []
}

// Read the provider's rendered form without evaluating scripts or following
// third-party actions. Values stay task-local and are never included in logs.
export function readConsentForm(html, pageURL) {
  const nodes = walk(parseDocument(html))
  const labels = new Map(nodes.filter(node => node.name === 'label' && node.attribs.for).map(node => [node.attribs.for, text(node).trim()]))
  for (const form of nodes.filter(node => node.name === 'form')) {
    const action = new URL(form.attribs.action || pageURL, pageURL)
    if ((form.attribs.method || 'get').toLowerCase() !== 'post' || action.origin !== new URL(pageURL).origin ||
        action.username || action.password || !/\/(consent|workspace)$/.test(action.pathname)) continue
    const controls = walk(form).filter(node => ['input', 'option', 'button'].includes(node.name) && !Object.hasOwn(node.attribs, 'disabled'))
    const workspaces = []
    for (const node of controls) {
      const attr = node.attribs
      const workspaceControl = (node.name === 'input' && attr.name === 'workspace_id') ||
        (node.name === 'option' && node.parent?.attribs?.name === 'workspace_id')
      if (workspaceControl && attr.value?.trim()) {
        let label = labels.get(attr.id) || attr['aria-label'] || ''
        for (let parent = node.parent; !label && parent && parent !== form; parent = parent.parent) {
          if (parent.name === 'label') label = text(parent).trim()
        }
        if (node.name === 'option') label = text(node).trim()
        if (!workspaces.some(item => item.id === attr.value)) workspaces.push({ id: attr.value, title: label })
      }
    }
    const streamed = streamedWorkspaces(nodes)
    if (streamed.length) return { action: action.href, workspaces: streamed }
    if (workspaces.length) return { action: action.href, workspaces }
    // Personal-only consent can provide a Continue form without a workspace selector.
    const fields = controls.filter(node => node.attribs.name && (
      node.name === 'input' && ['hidden', 'submit'].includes(node.attribs.type) ||
      node.name === 'button' && (!node.attribs.type || node.attribs.type === 'submit')
    )).map(node => [node.attribs.name, node.attribs.value || ''])
    return { action: action.href, workspaces: [], fields }
  }
  return null
}
