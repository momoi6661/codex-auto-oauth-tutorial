// Map the standalone .env config to the extracted protocol's task interface.
export function buildTask(config) {
  return {
    mode: 'oauth_protocol',
    resultType: 'code',
    proxyURL: config.proxyURL,
    resendAfterSeconds: config.resendAfterSeconds,
    context: {
      loginEmail: config.email,
      mailboxAddress: config.mailboxAddress,
      secret: config.mailbox.password,
      since: new Date().toISOString(),
      workspaceIndex: config.workspaceIndex,
      expectedAccountID: config.expectedAccountId || undefined
    },
    mailbox: {
      host: config.mailbox.host,
      port: config.mailbox.port,
      username: config.mailbox.user,
      folder: config.mailbox.folder,
      waitSeconds: config.mailbox.waitSeconds,
      codePattern: config.mailbox.codePattern,
      senderFilter: config.mailbox.senderFilter
    }
  }
}
