import { button, element } from "./dom-helpers";

const IDENTITY_FIELDS: readonly [string, string, string][] = [
  ["country", "国家", "例如 Ethiopia / 埃塞俄比亚"],
  ["region", "产区", "例如 Guji / 古吉"],
  ["farm", "庄园/处理站", "庄园、合作社或处理站"],
  ["variety", "品种", "例如 Gesha / 瑰夏"],
  ["process", "处理法", "例如 Washed / 水洗"],
  ["roast", "烘焙度", "例如 Light / 浅烘"],
  ["roastDate", "烘焙日期", "YYYY-MM-DD 或原标签日期"],
  ["altitude", "海拔", "例如 1900–2100 m"],
  ["flavorNotes", "豆袋风味", "豆袋或资料标注的风味信息"]
];

export interface SampleIdentityDialogOptions {
  displayNumber: number;
  label?: string;
  metadata: Readonly<Record<string, unknown>>;
  modeLabel: string;
  onSave(label: string | undefined, metadataPatch: Readonly<Record<string, unknown>>): void | Promise<void>;
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return value.map((item) => String(item ?? "").trim()).filter(Boolean).join(" / ");
  return "";
}

function field(label: string, input: HTMLInputElement): HTMLElement {
  const wrapper = element("label", "sample-identity__field");
  wrapper.append(element("span", "sample-identity__label", label), input);
  return wrapper;
}

function closeAndRemove(dialog: HTMLDialogElement): void {
  if (dialog.open) dialog.close();
  dialog.remove();
}

export function openSampleIdentityDialog(options: SampleIdentityDialogOptions): HTMLDialogElement {
  const dialog = element("dialog", "sample-identity") as HTMLDialogElement;
  dialog.setAttribute("aria-label", `编辑样品 ${String(options.displayNumber).padStart(2, "0")} 豆子信息`);

  const form = element("form", "sample-identity__form") as HTMLFormElement;
  form.method = "dialog";

  const header = element("header", "sample-identity__header");
  const title = element("div", "sample-identity__title-block");
  title.append(
    element("strong", "sample-identity__title", `样品 ${String(options.displayNumber).padStart(2, "0")} · 豆子信息`),
    element("span", "sample-identity__mode", options.modeLabel)
  );
  const cancelTop = button("sample-identity__close", "×", () => closeAndRemove(dialog));
  cancelTop.setAttribute("aria-label", "关闭豆子信息编辑");
  header.append(title, cancelTop);

  const note = element(
    "p",
    "sample-identity__note",
    "这里保存真实豆子资料；盲测/半盲测进行中仍保持身份隐藏，不会把填写内容显示到杯测主界面，整场完成后再统一揭盲。"
  );

  const body = element("div", "sample-identity__body");
  const nameInput = document.createElement("input");
  nameInput.className = "sample-identity__input";
  nameInput.type = "text";
  nameInput.autocomplete = "off";
  nameInput.placeholder = "豆子名称 / 批次名称";
  nameInput.value = options.label?.trim() ?? "";
  body.append(field("豆子名称", nameInput));

  const inputs = new Map<string, HTMLInputElement>();
  for (const [key, label, placeholder] of IDENTITY_FIELDS) {
    const input = document.createElement("input");
    input.className = "sample-identity__input";
    input.type = "text";
    input.autocomplete = "off";
    input.placeholder = placeholder;
    input.value = textValue(options.metadata[key]);
    inputs.set(key, input);
    body.append(field(label, input));
  }

  const footer = element("footer", "sample-identity__footer");
  const cancel = button("sample-identity__cancel", "取消", () => closeAndRemove(dialog));
  const save = button("sample-identity__save", "保存", () => undefined);
  save.type = "submit";
  footer.append(cancel, save);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    save.disabled = true;
    cancel.disabled = true;
    cancelTop.disabled = true;
    const metadataPatch: Record<string, unknown> = {};
    for (const [key, input] of inputs) metadataPatch[key] = input.value.trim();
    const label = nameInput.value.trim() || undefined;
    void Promise.resolve(options.onSave(label, metadataPatch))
      .then(() => closeAndRemove(dialog))
      .catch((error) => {
        save.disabled = false;
        cancel.disabled = false;
        cancelTop.disabled = false;
        const current = dialog.querySelector<HTMLElement>(".sample-identity__error");
        const message = error instanceof Error ? error.message : String(error);
        if (current) current.textContent = `保存失败：${message}`;
        else form.insertBefore(element("p", "sample-identity__error", `保存失败：${message}`), footer);
      });
  });

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeAndRemove(dialog);
  });
  dialog.addEventListener("close", () => dialog.remove(), { once: true });

  form.append(header, note, body, footer);
  dialog.append(form);
  document.body.append(dialog);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  queueMicrotask(() => nameInput.focus());
  return dialog;
}
