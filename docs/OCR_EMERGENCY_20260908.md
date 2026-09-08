# OCR delivery repair — 2026-09-08

AromaSense now consumes LuckyBean `cdb23b36d796476e2477562a386eaac6987ff42f` (PP-OCR provider 0.4.9), including decoded Worker byte-length/SHA-256 validation. The package lock and producer-pin regression use that exact immutable commit.

The build explicitly prepares missing pinned OCR resources and invokes the producer's runtime verifier before packaging. The verifier rejects missing models, invalid WASM, unresolved module imports and Worker integrity mismatches. The local-first sample data and native Android OCR contracts are unchanged.

Read-only build resource requests now retry transient transport/5xx errors up to three times. Timeouts cover response bodies; HTTP 404 and final integrity failures still fail the build. This addresses the previously observed ECONNRESET in the web bundle job.

The connected Pages workflow runs product checks before packaging and verifies the exact deployed build by recognizing a JPEG through the production Worker runtime. Successful source tests alone do not establish production OCR availability.

No new service, model, paid API or dependency is introduced. All OCR remains the existing free/local shared Foundation implementation.
