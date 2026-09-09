import { readFile, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const scriptsDir = import.meta.dirname;
const sourcePath = resolve(scriptsDir, "home-ui-acceptance.mjs");
const tempPath = resolve(scriptsDir, ".home-ui-acceptance-current.tmp.mjs");
const oldExpectation = `requireCondition(JSON.stringify(home?.capture) === JSON.stringify(["批量识别","分割识别","手工录入","清空列表","导入数据","二维码导入"]), \`Wrong homepage actions: \${JSON.stringify(home)}\`);`;
const newExpectation = `requireCondition(JSON.stringify(home?.capture) === JSON.stringify(["拍照识别","分割识别","文字录入","二维码录入","数据导入","清空列"]), \`Wrong homepage actions: \${JSON.stringify(home)}\`);`;

const source = await readFile(sourcePath, "utf8");
if (!source.includes(oldExpectation)) throw new Error("Legacy homepage action expectation changed; update current acceptance explicitly instead of silently weakening it.");
const patched = source.replace(oldExpectation, newExpectation);
await writeFile(tempPath, patched, "utf8");

try {
  const code = await new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [tempPath], { cwd: resolve(scriptsDir, ".."), stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (value, signal) => signal ? reject(new Error(`home acceptance terminated by ${signal}`)) : resolveExit(value ?? 1));
  });
  if (code !== 0) process.exitCode = code;
} finally {
  await rm(tempPath, { force: true });
}
