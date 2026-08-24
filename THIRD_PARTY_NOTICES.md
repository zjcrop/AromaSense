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

## Current application/runtime dependencies

### Android platform runtime

- Android uses platform `WebView` and `SQLiteDatabase` APIs.
- The Android database is stored in the application private directory as `aromasense.sqlite`.
- No external Android SQLite plugin is bundled.

### sql.js

- Status: browser/GitHub Pages runtime dependency
- Version: `1.14.2`
- Upstream: https://github.com/sql-js/sql.js
- License: MIT
- Modified: no
- Purpose: run SQLite in WebAssembly for the browser test version
- Persistence: AromaSense exports the SQLite database and stores it in IndexedDB; sql.js itself is an in-memory SQLite runtime
- Distributed assets: bundled JavaScript plus `sql-wasm.wasm`

The Node SQLite persistence adapter used by CI/recovery tests relies on Node.js built-in `node:sqlite` and is not part of the Android or browser runtime.

## Development / build toolchain

### TypeScript

- Status: development/build dependency
- Version range: `^5.9.0`
- Upstream: https://github.com/microsoft/TypeScript
- License: Apache-2.0
- Modified: no
- Distribution implication: development tool only

### @types/node

- Status: development/type-check dependency
- Version range: `^24.0.0`
- Upstream: https://github.com/DefinitelyTyped/DefinitelyTyped
- License: MIT for the package, subject to the resolved package metadata
- Modified: no
- Distribution implication: type declarations only

### esbuild

- Status: development/bundling dependency
- Version: `0.28.2`
- Upstream: https://github.com/evanw/esbuild
- License: MIT
- Modified: no
- Distribution implication: build tool only; the esbuild executable is not shipped inside the application

### Android build toolchain

- Android Gradle Plugin: `9.3.0`
- Gradle: `9.5.0`
- Kotlin support: AGP 9 built-in Kotlin
- compileSdk / targetSdk: Android API 36
- Distribution implication: build toolchain only; Android platform/framework licensing applies independently

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
