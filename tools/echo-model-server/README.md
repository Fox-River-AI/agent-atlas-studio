# echo-model-server (DIAG-37 dev tool)

A zero-dependency local "model provider" that honors the Agent Atlas provider
contract and returns the Causeway sample model, ignoring the requirements. Proves
the studio↔endpoint plumbing (option a) with no LLM / no key.

## Use
```
node tools/echo-model-server/server.mjs    # http://localhost:8799
```
In Agent Atlas → Settings → "Requirements model endpoint":
```
http://localhost:8799/generate-model
```
Then: Generate from requirements → paste anything → Generate. You should get the
Causeway model applied + "✓ registry valid".

`sample-model.json` is regenerated from src/atlas/seedModel.js (the current demo
seed). This is a dev tool — not part of the app build.
