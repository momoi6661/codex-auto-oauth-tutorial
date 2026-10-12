# Source and changes

These modules were extracted on 2026-10-12 from
[momoi6661/sub2api](https://github.com/momoi6661/sub2api),
`tools/reauth-runner/`, at checkout `34f77e8ce3e19852a776d3d27efa7fc6cde64ef2`.
The last commit affecting that runner was
`4c130721ec67909217e11eac572ac168ee6572bb`.
The upstream license is LGPL version 3; its text is retained in `LICENSE`,
with the incorporated GPL text in `COPYING`.
The MIT license at the repository root applies to the original teaching files;
it does not relicense these copied modules or the adapted upstream tests.

This is the independent protocol implementation developed in that runner with
guidance from the readable `Wenfxl-Codex-Manager-v18.2.0` OAuth-only and mailbox
flows. It is not a source port of the reference's compiled `auth_core` extension;
no compiled reference module is included.

Local changes: the mailbox child process accepts IMAP tasks only. Custom script
execution, direct custom auth-file returns, and their proxy adapter are excluded.
The original internal name `executeScript` is retained for protocol compatibility.
Tests are adapted only for import paths and to omit the custom auth-file test.

The Sentinel SDK is downloaded at runtime by the protocol module, not vendored.
The synthetic SDK in `test/reference-core/sentinel-fixture.mjs` is a mock used
only for local tests and never generates credentials for a real provider.
