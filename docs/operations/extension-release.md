# Extension release and browser compatibility

## Release procedure

1. Build from a signed, reviewed commit with `npm run build:extension`; archive the manifest, bundle checksums, compiler version, protocol manifest, and controlled-run evidence.
2. Review the manifest diff. Any new host or Chrome permission requires a plain-language explanation and explicit approval before store submission.
3. Run unit tests plus the 50-run controlled replay, then test the current stable and previous stable Chrome releases on supported fixture pages.
4. Verify pairing, offline capture retention, reconnect/sync, local run pause/resume, downloads, and service-worker suspension recovery.
5. Roll out to an internal channel, then a small percentage, then general beta. Monitor handshake compatibility and extension-sync availability.
6. Keep the previous signed package available. Roll back through the store if error rate or incompatibility crosses the release threshold.

## Compatibility policy

Support current stable Chrome and the immediately previous stable release. Record Chromium version, extension version, capture protocol version, compiler version, and executor version in compatibility evidence. Firefox, Safari, Edge-specific behavior, mobile browsers, desktop automation, shadow-DOM execution, and multi-tab execution remain unsupported until a beta workflow and verification suite justify expansion.

Protocol evolution is additive within a major version. The server negotiates capabilities at handshake; an extension must never infer support from a successful network connection alone.
