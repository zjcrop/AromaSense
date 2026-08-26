import { button, element } from "./dom-helpers";

interface BarcodeResult { rawValue?: string }
interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<BarcodeResult[]> }
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;

function detectorCtor(): BarcodeDetectorCtor | undefined {
  return (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
}

export interface QrScannerDialogOptions {
  root: HTMLElement;
  onResult(value: string): void | Promise<void>;
  onFallbackImage(): void;
}

export async function openQrScannerDialog(options: QrScannerDialogOptions): Promise<void> {
  const Detector = detectorCtor();
  if (!Detector || !navigator.mediaDevices?.getUserMedia) {
    options.onFallbackImage();
    return;
  }

  const overlay = element("div", "qr-scanner");
  const panel = element("section", "qr-scanner__panel");
  const header = element("header", "qr-scanner__header");
  header.append(element("strong", "qr-scanner__title", "扫描二维码"));
  const video = element("video", "qr-scanner__video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  const guide = element("div", "qr-scanner__guide");
  const status = element("p", "qr-scanner__status", "将 AromaSense 分享二维码置于取景框内");
  const stage = element("div", "qr-scanner__stage");
  stage.append(video, guide);
  const actions = element("footer", "qr-scanner__actions");

  let stream: MediaStream | undefined;
  let stopped = false;
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  const detector = new Detector({ formats: ["qr_code"] });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (scanTimer) clearTimeout(scanTimer);
    stream?.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    overlay.remove();
  };
  actions.append(
    button("qr-scanner__secondary", "选择二维码图片", () => { stop(); options.onFallbackImage(); }),
    button("qr-scanner__secondary", "取消", stop)
  );
  panel.append(header, stage, status, actions);
  overlay.append(panel);
  options.root.append(overlay);

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    if (stopped) { stream.getTracks().forEach((track) => track.stop()); return; }
    video.srcObject = stream;
    await video.play();
  } catch (error) {
    stop();
    options.onFallbackImage();
    return;
  }

  const scan = async () => {
    if (stopped) return;
    try {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const results = await detector.detect(video);
        const value = results.find((item) => item.rawValue?.trim())?.rawValue?.trim();
        if (value) {
          stopped = true;
          if (scanTimer) clearTimeout(scanTimer);
          stream?.getTracks().forEach((track) => track.stop());
          video.srcObject = null;
          status.textContent = "二维码已识别，正在读取数据…";
          await options.onResult(value);
          overlay.remove();
          return;
        }
      }
    } catch {
      // A transient decode failure is normal while the camera is moving.
    }
    if (!stopped) scanTimer = setTimeout(() => void scan(), 180);
  };
  void scan();
}
