# Third-Party Notices

AromaSense is proprietary software. Third-party components remain governed by their respective licenses.

This file is the authoritative inventory for third-party code, models, datasets, fonts, dictionaries, and other externally licensed assets used by AromaSense.

## Dependency admission policy

Preferred permissive licenses:

- Apache License 2.0
- MIT License
- BSD 2-Clause / BSD 3-Clause

The following require explicit legal/license review before adoption:

- LGPL
- GPL
- AGPL
- SSPL
- source-available licenses
- non-commercial licenses
- custom model/data/content licenses

## Current runtime dependencies

No production third-party OCR/model dependency is bundled in the repository at this infrastructure-baseline stage.

The Node SQLite persistence adapter used by CI/recovery tests relies on Node.js built-in `node:sqlite`; no external SQLite npm runtime package is introduced.

## Development toolchain

### TypeScript

- Status: development/build dependency
- Version range: `^5.9.0`
- Upstream: https://github.com/microsoft/TypeScript
- License: Apache-2.0
- Modified: no
- Distribution implication: development tool only; not intended to be bundled as an application runtime dependency

### @types/node

- Status: development/type-check dependency
- Version range: `^24.0.0`
- Upstream: https://github.com/DefinitelyTyped/DefinitelyTyped
- License: MIT for the package, subject to the package metadata for the resolved version
- Modified: no
- Distribution implication: type declarations used during development; not intended to be bundled as application runtime code

## Planned / under evaluation

### PaddleOCR / PP-OCR

- Status: planned/under evaluation; not yet bundled here
- Intended use: local OCR preprocessing for coffee-label information capture
- License: Apache-2.0 for the upstream PaddleOCR codebase, subject to re-verification for the exact version, model files, datasets, and packaged assets before release
- Modification status: not yet determined
- Required action before inclusion: add exact upstream URL, pinned version/commit, license copy, NOTICE requirements, and model/data license review

## Required record format for new components

For every dependency, add:

- Name
- Exact version or commit
- Upstream URL
- License identifier and license file location
- Whether source was modified
- Whether binary/model/data assets have a separate license
- Attribution/NOTICE obligations
- Distribution implications

Do not infer that a model, dataset, font, dictionary, or other asset inherits the source-code license merely because it is hosted in the same upstream repository.
