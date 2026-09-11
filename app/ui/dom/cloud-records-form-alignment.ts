/* AromaSense cloud-record visual alignment override.
 * This module intentionally mirrors the existing account form metrics so the
 * cloud library feels like part of the same form system rather than a new UI.
 */
const style = document.createElement("style");
style.dataset.aromasenseCloudFormAlignment = "true";
style.textContent = `
.cloud-records-panel{width:min(460px,calc(100vw - 32px))!important;border:1px solid rgba(185,153,90,.4)!important;border-radius:18px!important;background:#1d1d1d!important;box-shadow:0 16px 42px rgba(0,0,0,.44)!important}
.cloud-records-header{align-items:flex-start!important;gap:12px!important;padding:22px 22px 12px!important;border-bottom:0!important;background:#1d1d1d!important}
.cloud-records-title{margin:0!important;font-size:22px!important;line-height:1.2!important;color:#b9995a!important}
.cloud-records-subtitle{margin:5px 0 0!important;color:#aaa49a!important;font-size:13px!important;line-height:1.55!important}
.cloud-records-close{min-height:44px!important;border:1px solid rgba(185,153,90,.5)!important;border-radius:10px!important;padding:0 12px!important;color:#f4efe4!important;font-size:13px!important;font-weight:650!important}
.cloud-records-body{padding:0 22px 12px!important}
.cloud-records-modes{gap:8px!important;margin:0 0 12px!important;padding:0!important;border:0!important;background:transparent!important}
.cloud-records-mode,.cloud-records-chip{min-height:44px!important;border:1px solid rgba(185,153,90,.4)!important;border-radius:10px!important;background:#242424!important;color:#aaa49a!important;font-size:13px!important;font-weight:650!important}
.cloud-records-mode.is-active,.cloud-records-chip.is-active{border-color:#b9995a!important;background:rgba(185,153,90,.12)!important;color:#f4efe4!important;box-shadow:none!important}
.cloud-records-section{margin:0 0 12px!important;padding:12px!important;border-radius:10px!important;background:#171717!important}
.cloud-records-section__title{margin:0 0 8px!important;color:#aaa49a!important;font-size:13px!important;font-weight:650!important;line-height:1.55!important;letter-spacing:0!important}
.cloud-records-recent-options{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important}
.cloud-records-range{gap:8px!important}
.cloud-records-label{color:#aaa49a!important;font-size:11px!important}
.cloud-records-control{min-height:44px!important;border:1px solid rgba(185,153,90,.4)!important;border-radius:10px!important;padding:0 12px!important;background:#242424!important;color:#f4efe4!important;font-size:13px!important}
.cloud-records-list{border-radius:10px!important;background:#171717!important}
.cloud-record-row{background:#171717!important}.cloud-record-row.is-selected{background:#242424!important;box-shadow:inset 3px 0 0 #b9995a!important}
.cloud-record-date{color:#b9995a!important}.cloud-record-organizer{color:#aaa49a!important}
.cloud-records-feedback{min-height:18px!important;margin:10px 1px 0!important;padding:8px 10px!important;border-radius:8px!important;background:rgba(185,153,90,.10)!important;color:#d8c9aa!important;font-size:12px!important;line-height:1.5!important}
.cloud-records-feedback.is-error{background:rgba(190,70,70,.16)!important;color:#f4b4b4!important}
.cloud-records-footer{grid-template-columns:1fr 1fr!important;gap:8px!important;padding:0 22px max(22px,env(safe-area-inset-bottom))!important;border-top:0!important;background:#1d1d1d!important}
.cloud-records-secondary,.cloud-records-primary{min-height:44px!important;border-radius:10px!important;padding:0 12px!important;font-size:13px!important;font-weight:650!important}
.cloud-records-secondary{border:1px solid rgba(185,153,90,.5)!important;background:transparent!important;color:#f4efe4!important}.cloud-records-primary{border:0!important;background:#b9995a!important;color:#111!important}
@media(max-width:520px){.cloud-records-panel{width:calc(100vw - 20px)!important}.cloud-records-header{padding:18px 18px 12px!important}.cloud-records-body{padding:0 18px 12px!important}.cloud-records-footer{padding-left:18px!important;padding-right:18px!important;padding-bottom:max(18px,env(safe-area-inset-bottom))!important}.cloud-records-range{grid-template-columns:1fr!important}}
`;
document.head.append(style);

const attachAccountLauncher = (): void => {
  for (const card of document.querySelectorAll<HTMLElement>(".account-card")) {
    if (!card.querySelector(".account-card__status--good")) continue;
    const actions = card.querySelector<HTMLElement>(".account-card__actions");
    if (!actions || actions.querySelector("[data-cloud-records-account-launcher]")) continue;
    const source = document.querySelector<HTMLButtonElement>("[data-cloud-records-launcher]");
    if (!source) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "account-card__secondary";
    button.dataset.cloudRecordsAccountLauncher = "true";
    button.textContent = "云端记录";
    button.addEventListener("click", () => source.click());
    actions.insertBefore(button, actions.children[1] ?? null);
  }
};
const observer = new MutationObserver(attachAccountLauncher);
observer.observe(document.documentElement, { childList: true, subtree: true });
attachAccountLauncher();
