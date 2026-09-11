const STYLE_FLAG = "data-aromasense-source-choice-layout-hotfix";

function installSourceChoiceLayout(): void {
  if (document.head.querySelector(`style[${STYLE_FLAG}]`)) return;
  const style = document.createElement("style");
  style.setAttribute(STYLE_FLAG, "true");
  style.textContent = `
    /* Keep batch-photo and manual-split source pickers geometrically identical:
       title/help stay at the top; the two primary source choices sit in the
       lower action area for easier thumb reach. */
    .import-source__panel.is-photo-choice,
    .manual-split-photo--source .manual-split-photo__panel{
      width:min(420px,100%)!important;
      min-height:260px!important;
      max-height:96dvh!important;
      box-sizing:border-box!important;
      display:flex!important;
      flex-direction:column!important;
      padding:14px!important;
    }

    .import-source__photo-form{
      flex:1 1 auto!important;
      min-height:230px!important;
      display:flex!important;
      flex-direction:column!important;
      padding:0!important;
    }

    .import-source__photo-help,
    .manual-split-photo--source .manual-split-photo__help{
      margin:5px 0 10px!important;
    }

    .import-source__photo-grid,
    .manual-split-photo--source .manual-split-photo__source-actions{
      display:grid!important;
      grid-template-columns:repeat(2,minmax(0,1fr))!important;
      gap:10px!important;
      width:100%!important;
      margin-top:auto!important;
    }

    .import-source__photo-choice,
    .manual-split-photo--source .manual-split-photo__source-actions button{
      width:100%!important;
      min-height:46px!important;
      margin:0!important;
      box-sizing:border-box!important;
      border:1px solid rgba(185,153,90,.36)!important;
      border-radius:9px!important;
      padding:8px 12px!important;
      background:#242424!important;
      color:#e7d9ba!important;
      font:inherit!important;
      font-weight:700!important;
      cursor:pointer!important;
    }

    .import-source__photo-choice.is-primary,
    .manual-split-photo--source .manual-split-photo__source-actions button.primary{
      border-color:#b9995a!important;
      background:#b9995a!important;
      color:#111!important;
    }

    .import-source__photo-actions,
    .manual-split-photo--source .manual-split-photo__actions{
      flex:0 0 auto!important;
      display:flex!important;
      justify-content:flex-end!important;
      width:100%!important;
      margin-top:10px!important;
    }

    .import-source__photo-cancel,
    .manual-split-photo--source [data-cancel]{
      min-height:40px!important;
      border:1px solid rgba(185,153,90,.36)!important;
      border-radius:9px!important;
      padding:7px 12px!important;
      background:#242424!important;
      color:#e7d9ba!important;
      font:inherit!important;
      font-weight:700!important;
    }

    @media(max-width:620px){
      .import-source__panel.is-photo-choice,
      .manual-split-photo--source .manual-split-photo__panel{
        min-height:260px!important;
        width:min(420px,100%)!important;
      }
      .import-source__photo-form{min-height:230px!important}
    }
  `;
  document.head.append(style);
}

if (typeof document !== "undefined") installSourceChoiceLayout();
