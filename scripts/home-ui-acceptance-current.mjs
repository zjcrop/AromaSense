import { readFile, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const scriptsDir = import.meta.dirname;
const sourcePath = resolve(scriptsDir, "home-ui-acceptance.mjs");
const tempPath = resolve(scriptsDir, ".home-ui-acceptance-current.tmp.mjs");

const replacements = [
  [
    `const actionNodes=[...document.querySelectorAll('.batch-setup__capture-actions button')];`,
    `const actionNodes=[...document.querySelectorAll('.batch-setup__capture-actions button')].filter(n=>getComputedStyle(n).display!=='none');`
  ],
  [
    `requireCondition(JSON.stringify(home?.capture) === JSON.stringify(["批量识别","分割识别","手工录入","清空列表","导入数据","二维码导入"]), \`Wrong homepage actions: \${JSON.stringify(home)}\`);`,
    `requireCondition(JSON.stringify(home?.capture) === JSON.stringify(["批量录入","清空列表"]), \`Wrong visible homepage actions: \${JSON.stringify(home)}\`);`
  ],
  [
    `requireCondition(styleKeys.length === 6 && new Set(styleKeys).size === 1, \`Six home intake actions are not visually identical: \${JSON.stringify(home?.captureStyles)}\`);`,
    `requireCondition(styleKeys.length === 2 && new Set(styleKeys).size === 1, \`Two primary home intake actions are not visually identical: \${JSON.stringify(home?.captureStyles)}\`);`
  ],
  [
    `requireCondition(rowTops.length === 3, \`Six home intake actions must form three balanced rows: \${JSON.stringify(home?.captureStyles)}\`);`,
    `requireCondition(rowTops.length === 1, \`Two primary home intake actions must share one balanced row: \${JSON.stringify(home?.captureStyles)}\`);`
  ]
];

let source = await readFile(sourcePath, "utf8");
for (const [before, after] of replacements) {
  if (!source.includes(before)) throw new Error(`Homepage acceptance source changed; missing patch target: ${before.slice(0, 90)}`);
  source = source.replace(before, after);
}

const marker = `requireCondition(home?.brandGeometry?.brandError <= 1.5 && home?.brandGeometry?.chineseError <= 1.5 && home?.brandGeometry?.englishError <= 1.5, \`Homepage brand is not geometrically centered: \${JSON.stringify(home?.brandGeometry)}\`);`;
if (!source.includes(marker)) throw new Error("Homepage geometry marker changed; batch intake acceptance must be re-anchored explicitly.");
const batchPickerAcceptance = `

    const batchOpened = await cdp.evaluate(\`(() => { const n=document.querySelector('[data-home-action="batch-recognition"]'); if(!(n instanceof HTMLElement)) return false; n.click(); return true; })()\`);
    requireCondition(batchOpened === true, "Unable to open batch intake picker");
    await waitUntil(async () => (await cdp.evaluate(\`document.querySelectorAll('.import-source__option').length===6 && Boolean(document.querySelector('.import-source__footer .import-source__close'))\`)) === true, "six-source batch intake picker");
    const intakePicker = await cdp.evaluate(\`(() => {
      const panel=document.querySelector('.import-source__panel');
      const grid=document.querySelector('.import-source__grid');
      const footer=document.querySelector('.import-source__footer');
      if(!(panel instanceof HTMLElement)||!(grid instanceof HTMLElement)||!(footer instanceof HTMLElement)) return null;
      const pr=panel.getBoundingClientRect(), gr=grid.getBoundingClientRect(), fr=footer.getBoundingClientRect();
      const rows=[...new Set([...grid.querySelectorAll('.import-source__option')].map(n=>Math.round(n.getBoundingClientRect().top)))];
      return {
        titles:[...grid.querySelectorAll('.import-source__option-title')].map(n=>n.textContent?.trim()),
        visibleTitle:[...panel.querySelectorAll('.import-source__title')].some(n=>getComputedStyle(n).display!=='none' && n.textContent?.trim()==='选择识别来源'),
        header:Boolean(panel.querySelector('.import-source__header')),
        close:footer.querySelector('.import-source__close')?.textContent?.trim() || '',
        footerAfterGrid:Boolean(grid.compareDocumentPosition(footer)&Node.DOCUMENT_POSITION_FOLLOWING),
        footerBelowGrid:fr.top>gr.bottom,
        rows:rows.length,
        horizontalError:Math.abs((gr.left+gr.right)/2-(pr.left+pr.right)/2),
        verticalError:Math.abs((gr.top+gr.bottom)/2-(pr.top+pr.bottom)/2),
        panelHeight:pr.height
      };
    })()\`);
    requireCondition(JSON.stringify(intakePicker?.titles) === JSON.stringify(["图片","分割识别","文字录入","表格","链接","二维码"]), \`Wrong six-source picker order: \${JSON.stringify(intakePicker)}\`);
    requireCondition(intakePicker?.visibleTitle === false && intakePicker?.header === false, \`Batch intake picker must not show source title/header: \${JSON.stringify(intakePicker)}\`);
    requireCondition(intakePicker?.close === "关闭" && intakePicker?.footerAfterGrid === true && intakePicker?.footerBelowGrid === true, \`Close action is not isolated at the bottom: \${JSON.stringify(intakePicker)}\`);
    requireCondition(intakePicker?.rows === 3, \`Six intake sources must form a 2x3 grid: \${JSON.stringify(intakePicker)}\`);
    requireCondition((intakePicker?.horizontalError ?? 999) <= 2 && (intakePicker?.verticalError ?? 999) <= 12, \`Six intake sources are not geometrically centered in the panel: \${JSON.stringify(intakePicker)}\`);
    await cdp.evaluate(\`document.querySelector('.import-source__footer .import-source__close')?.click()\`);
`;
source = source.replace(marker, `${marker}${batchPickerAcceptance}`);

await writeFile(tempPath, source, "utf8");
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
