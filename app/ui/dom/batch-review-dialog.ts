import { button, element } from "./dom-helpers";

export interface BatchReviewField {
  key: string;
  label: string;
  group: string;
  value: string;
  candidates?: readonly string[];
  confidence?: number;
  multiline?: boolean;
  date?: boolean;
}

export interface BatchReviewValue {
  label: string;
  fields: Record<string, string>;
}

export interface BatchReviewDialogOptions {
  root: HTMLElement;
  rowId: string;
  index: number;
  total: number;
  confirmed: number;
  finalPending?: boolean;
  previewUrl?: string;
  recognitionStatus?: string;
  rawText?: string;
  label: string;
  fields: readonly BatchReviewField[];
  onChange?(value: BatchReviewValue): void;
  onExit(value: BatchReviewValue): void | Promise<void>;
  onPrevious?(value: BatchReviewValue): void | Promise<void>;
  onConfirm(value: BatchReviewValue): boolean | void | Promise<boolean | void>;
}

export interface BatchReviewDialogHandle {
  close(): void;
  read(): BatchReviewValue;
}

function readValue(overlay: HTMLElement): BatchReviewValue {
  const label = overlay.querySelector<HTMLInputElement>("[data-sample-label]")?.value.trim() ?? "";
  const fields: Record<string, string> = {};
  for (const control of overlay.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-field-key]")) {
    const key = String(control.dataset.fieldKey ?? "");
    const value = control.value.trim();
    if (key && value) fields[key] = value;
  }
  return { label, fields };
}

function validConfirmedLabel(value: string): boolean {
  const label = value.trim();
  return Boolean(label) && !/^待确认样品\s+\d+$/u.test(label);
}

export function openBatchReviewDialog(options: BatchReviewDialogOptions): BatchReviewDialogHandle {
  const previous = options.root.querySelector<HTMLElement>(".batch-review");
  previous?.remove();

  const overlay = element("div", "batch-review");
  overlay.dataset.rowId = options.rowId;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  const panel = element("section", "batch-review__panel");
  const header = element("header", "batch-review__header");
  const copy = element("div", "batch-review__header-copy");
  copy.append(
    element("h2", "batch-review__title", "样品信息确认"),
    element("p", "batch-review__subtitle", `样品 ${options.index + 1}/${options.total} · 已确认 ${options.confirmed}/${options.total}`)
  );
  const exit = button("batch-review__close", "暂存退出", () => options.onExit(readValue(overlay)));
  header.append(copy, exit);
  panel.append(header);

  if (options.previewUrl) {
    const figure = element("figure", "batch-review__figure");
    const image = element("img", "batch-review__image");
    image.src = options.previewUrl;
    image.alt = "当前样品来源图片";
    figure.append(image);
    if (options.recognitionStatus) figure.append(element("figcaption", "batch-review__image-caption", options.recognitionStatus));
    panel.append(figure);
  }

  const form = element("form", "batch-review__form");
  form.addEventListener("submit", (event) => event.preventDefault());
  const nameField = element("label", "batch-review__field batch-review__field--name");
  nameField.append(element("span", "batch-review__label", "样品名称 *"));
  const nameInput = element("input", "batch-review__control batch-review__control--name");
  nameInput.type = "text";
  nameInput.dataset.sampleLabel = "true";
  nameInput.placeholder = "请输入用于杯测列表显示的样品名称";
  nameInput.value = options.label;
  nameField.append(nameInput);
  form.append(nameField);

  const groups = [...new Set(options.fields.map((field) => field.group))];
  let listIndex = 0;
  for (const group of groups) {
    const section = element("fieldset", "batch-review__section");
    section.append(element("legend", "batch-review__section-title", group));
    const grid = element("div", "batch-review__grid");
    for (const field of options.fields.filter((item) => item.group === group)) {
      const wrapper = element("label", `batch-review__field${field.candidates?.length ? " is-review" : ""}`);
      wrapper.append(element("span", "batch-review__label", field.label));
      const control = field.multiline
        ? element("textarea", "batch-review__control")
        : element("input", "batch-review__control");
      control.dataset.fieldKey = field.key;
      if (control instanceof HTMLInputElement && field.date) control.type = "date";
      control.value = field.value;
      wrapper.append(control);
      if (field.candidates?.length && control instanceof HTMLInputElement) {
        const list = element("datalist");
        list.id = `batch-review-candidate-${options.rowId}-${listIndex}`;
        listIndex += 1;
        for (const candidate of field.candidates) {
          const option = element("option");
          option.value = candidate;
          list.append(option);
        }
        control.setAttribute("list", list.id);
        wrapper.append(list);
      }
      if (field.candidates?.length || field.confidence !== undefined) {
        const hint = [
          field.candidates?.length ? `候选：${field.candidates.join(" / ")}` : "OCR 待核对",
          field.confidence !== undefined ? `置信度 ${Math.round(field.confidence * 100)}%` : ""
        ].filter(Boolean).join(" · ");
        wrapper.append(element("small", "batch-review__field-hint", hint));
      }
      grid.append(wrapper);
    }
    section.append(grid);
    form.append(section);
  }

  if (options.rawText?.trim()) {
    const details = element("details", "batch-review__raw");
    details.append(element("summary", "batch-review__raw-title", "查看 OCR 原文"));
    details.append(element("pre", "batch-review__raw-text", options.rawText.trim()));
    form.append(details);
  }
  const validation = element("p", "batch-review__validation");
  validation.hidden = true;
  form.append(validation);
  form.addEventListener("input", () => options.onChange?.(readValue(overlay)));
  panel.append(form);

  const footer = element("footer", "batch-review__footer");
  const previousButton = button("batch-review__secondary", "上一个", () => options.onPrevious?.(readValue(overlay)));
  previousButton.disabled = !options.onPrevious;
  const confirmButton = button("batch-review__primary", options.finalPending ? "确认并完成" : "确认并下一个", async () => {
    const value = readValue(overlay);
    if (!validConfirmedLabel(value.label)) {
      validation.textContent = value.label
        ? "当前仍是系统生成的待确认名称，请修改为有效样品名称后继续。"
        : "样品名称不能为空。请确认名称后继续。";
      validation.hidden = false;
      nameInput.focus();
      nameInput.select();
      return;
    }
    validation.hidden = true;
    const accepted = await options.onConfirm(value);
    if (accepted === false) return;
  });
  footer.append(previousButton, confirmButton);
  panel.append(footer);
  overlay.append(panel);
  options.root.append(overlay);
  nameInput.focus();

  return {
    close: () => overlay.remove(),
    read: () => readValue(overlay)
  };
}
