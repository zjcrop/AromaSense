function installBatchIntakePickerLayoutFix(): void {
  if (typeof document === "undefined") return;
  if (document.head.querySelector("style[data-aromasense-batch-intake-layout-fix]")) return;

  const style = document.createElement("style");
  style.dataset.aromasenseBatchIntakeLayoutFix = "true";
  style.textContent = `
    .import-source__panel.is-batch-intake-picker{
      padding:22px!important;
      overflow:hidden!important;
    }
    .import-source__panel.is-batch-intake-picker .import-source__grid{
      margin:auto!important;
    }
    .import-source__panel.is-batch-intake-picker .import-source__option{
      min-height:92px!important;
      padding:10px 12px!important;
      grid-template-rows:30px auto auto!important;
      gap:5px!important;
    }
    .import-source__panel.is-batch-intake-picker .import-source__icon{
      width:28px!important;
      height:28px!important;
    }
    .import-source__panel.is-batch-intake-picker .import-source__footer{
      bottom:8px!important;
      padding-top:8px!important;
    }
    .import-source__panel.is-batch-intake-picker .import-source__close{
      min-height:36px!important;
    }
    @media(max-width:620px){
      .import-source__panel.is-batch-intake-picker{
        padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom))!important;
      }
      .import-source__panel.is-batch-intake-picker .import-source__option{
        min-height:90px!important;
        padding:9px 8px!important;
      }
      .import-source__panel.is-batch-intake-picker .import-source__footer{
        bottom:max(6px,env(safe-area-inset-bottom))!important;
      }
    }
  `;
  document.head.append(style);
}

installBatchIntakePickerLayoutFix();
