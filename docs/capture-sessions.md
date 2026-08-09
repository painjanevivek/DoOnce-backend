# Capture session synchronization

Browser recording is split into four independent layers: page observation, event normalization, durable local buffering, and API synchronization. The recorder never imports or calls runner code.

The extension records semantic target evidence, a bounded DOM fingerprint, visibility, frame ancestry, normalized URL patterns, before/after page state, and value classifications. Raw password, OTP, payment, and token values are replaced with placeholders. Rapid typing and duplicate click/change pairs collapse into one action with a stable ID and sequence.

Sessions progress through recording, paused, stopped, synchronizing, finalized, or discarded states. Chrome local storage holds at most 1,000 validated actions. Batches contain at most 50 actions and use a cursor plus a unique batch ID. PostgreSQL locks the cursor, inserts actions in one bulk statement, and stores acknowledgements so retries are idempotent.

## Connecting an extension

1. A signed-in dashboard user opens **Connect the browser recorder** and generates a code.
2. The user enters the code in the extension within ten minutes.
3. The code is stored only as a SHA-256 hash, is single-use, and creates a random bearer token whose hash is stored server-side.
4. The extension stores the bearer token in Chrome local storage and uses it only for capture synchronization.

Pairing and token tables are authentication indexes queried only by exact, high-entropy hashes. Tenant capture data remains protected by forced row-level security and every sync runs inside `withTenantTransaction`.

## Operations

Apply migration 012 before enabling synchronization. The extension retries buffered work every minute and after startup. A stopped session can be finalized only after the server acknowledges its final cursor. Local JSON export remains available for diagnosis and migration when the API is unavailable.
