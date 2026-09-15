import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");

test("Safari account UI uses stable viewport units and 16px text inputs", () => {
  const css = read("app/ui/dom/account.css");
  assert.match(css, /\.account-screen\s*\{[^}]*100svh/s);
  assert.match(css, /\.account-card__input\s*\{[^}]*font-size:\s*16px/s);
  assert.doesNotMatch(css, /\.account-screen\s*\{[^}]*100dvh/s);
});

test("Web template declares Apple standalone behavior and stable WebKit app-shell height", () => {
  const html = read("web/index.template.html");
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /apple-mobile-web-app-status-bar-style/);
  assert.match(html, /@supports \(-webkit-touch-callout: none\)/);
  assert.match(html, /\.cupping-layout[\s\S]*?100svh/);
  assert.match(html, /\.cupping-layout__main[\s\S]*?100svh/);
});

test("Account renderer serializes submits and exposes verification-mail retry state", () => {
  const source = read("app/ui/dom/account-renderer.ts");
  assert.match(source, /let submitting = false/);
  assert.match(source, /if \(submitting\) return/);
  assert.match(source, /verificationEmail === "retry_required"/);
  assert.match(source, /请不要重复注册/);
});

test("Auth requests bypass caches and preserve pending registration before verification delivery", () => {
  const source = read("app/core/auth-client.ts");
  const rememberIndex = source.indexOf("await this.rememberPendingRegistration(registeredEmail)");
  const sendIndex = source.indexOf("await this.trySendVerification(signup.idToken)");
  assert.ok(rememberIndex >= 0 && sendIndex > rememberIndex, "pending registration must be persisted before sending verification email");
  assert.match(source, /cache:\s*"no-store"/);
  assert.match(source, /DEFAULT_AUTH_REQUEST_TIMEOUT_MS = 15_000/);
});
