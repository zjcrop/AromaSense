import type { VoicePromptEvent } from "../voice-prompt-events";

export interface VoicePromptPlayer {
  play(event: VoicePromptEvent): void;
  cancel(): void;
}

export class BrowserVoicePromptPlayer implements VoicePromptPlayer {
  play(event: VoicePromptEvent): void {
    if (!("speechSynthesis" in globalThis) || typeof SpeechSynthesisUtterance === "undefined") return;
    globalThis.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(event.text);
    utterance.lang = "zh-CN";
    utterance.rate = 1;
    globalThis.speechSynthesis.speak(utterance);
  }

  cancel(): void {
    if ("speechSynthesis" in globalThis) globalThis.speechSynthesis.cancel();
  }
}
