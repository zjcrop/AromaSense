function installBatchIntakePickerLayout(): void {
  if (document.head.querySelector("style[data-aromasense-batch-intake-layout]")) return;
  const style = document.createElement("style");
  style.dataset.aromasenseBatchIntakeLayout = "true";
  style.textContent = `
    .import-source__panel.is-batch-intake-picker .import-source__grid{
      position:absolute!important;
      left:50%!important;
      top:50%!important;
      transform:translate(-50%,-50%)!important;
      width:min(620px,calc(100% - 44px))!important;
      margin:0!important;
    }
    @media(max-width:620px){
      .import-source__panel.is-batch-intake-picker .import-source__grid{
        width:calc(100% - 32px)!important;
      }
    }
  `;
  document.head.append(style);
}

if (typeof document !== "undefined") installBatchIntakePickerLayout();
