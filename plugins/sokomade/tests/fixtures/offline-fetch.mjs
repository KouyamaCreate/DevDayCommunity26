// Loaded only by the STDIO integration child. Normal tests must not contact public APIs.
globalThis.fetch = async () => { throw new Error('External requests disabled in integration tests'); };
