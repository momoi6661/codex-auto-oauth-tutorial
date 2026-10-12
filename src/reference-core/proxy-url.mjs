// Resolve SOCKS destinations through the selected proxy, consistently across
// OAuth and custom mailbox fetches. Never expose credentials in diagnostics.
export function normalizeProxyURL(value = '') {
  if (!value) return ''
  const url = new URL(value)
  if (!['http:', 'https:', 'socks5:', 'socks5h:', 'socks4:', 'socks4a:', 'socks:'].includes(url.protocol) || !url.hostname) {
    throw new Error('Unsupported authorization proxy protocol')
  }
  if (url.protocol === 'socks5:' || url.protocol === 'socks:') url.protocol = 'socks5h:'
  return url.href
}
