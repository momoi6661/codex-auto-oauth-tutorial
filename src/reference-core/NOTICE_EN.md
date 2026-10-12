# Module boundaries and licensing

[中文](NOTICE.md) | **English**

The protocol core and corresponding tests use LGPL v3. The complete LGPL text is retained in LICENSE, with its incorporated GPL text in COPYING. The root MIT license covers the standalone teaching files and UI/CLI adapters; it does not relicense these core modules as MIT.

The standalone call chain retains OAuth/PKCE, IMAP OTP, curl_cffi transport, Sentinel, consent, workspace fallback and identity checks. script-process.mjs accepts IMAP tasks only: custom scripts, direct custom auth-file returns and their dedicated proxy adapter are excluded. The executeScript name is retained only for interface compatibility. index.mjs is the standalone export entry.

No panel, database, account batch management, task queue or compiled auth_core is included.

The Sentinel SDK is downloaded at runtime and is not bundled. sentinel-fixture.mjs simulates SDK behavior only in tests; it cannot generate live-provider credentials and is never used for real requests.

Retain the applicable license texts when distributing and follow their requirements for modifying and distributing the corresponding modules.
