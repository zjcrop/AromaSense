import * as QRCode from "qrcode";

function installStyles(): void {
  if (document.head.querySelector("style[data-yingxiang-invite-share]")) return;
  const style = document.createElement("style"); style.dataset.yingxiangInviteShare = "true";
  style.textContent = `
    .yx-invite-share{display:grid;gap:10px;justify-items:center;padding:13px;border:1px solid rgba(105,163,128,.3);border-radius:9px;background:rgba(62,111,82,.08)}
    .yx-invite-share canvas{display:block;width:min(220px,70vw)!important;height:auto!important;border-radius:8px;background:#fff;padding:8px;box-sizing:border-box}
    .yx-invite-share__url{width:100%;overflow-wrap:anywhere;color:#d9d4ca;font:11px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;text-align:left}
    .yx-invite-share__copy{min-height:42px;min-width:120px;padding:7px 13px;border:1px solid rgba(185,153,90,.35);border-radius:8px;background:#1c1c1c;color:#d7c7a7;font-weight:700}
  `;
  document.head.append(style);
}

export async function renderYingxiangInviteShare(container: HTMLElement, url: string): Promise<void> {
  installStyles(); container.replaceChildren(); container.classList.add("yx-invite-share");
  const canvas = document.createElement("canvas");
  const text = document.createElement("div"); text.className = "yx-invite-share__url"; text.textContent = url;
  const copy = document.createElement("button"); copy.type = "button"; copy.className = "yx-invite-share__copy"; copy.textContent = "一键复制链接";
  container.append(canvas, text, copy);
  try {
    await QRCode.toCanvas(canvas, url, { width: 220, margin: 2, errorCorrectionLevel: "M" });
  } catch {
    canvas.remove();
  }
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(url); copy.textContent = "已复制"; window.setTimeout(() => { copy.textContent = "一键复制链接"; }, 1200); }
    catch { copy.textContent = "复制失败"; }
  };
}
