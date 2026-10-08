// Bridge to the phone preview (mobile/preview). The preview defines __MVC_PREVIEW__ before the app loads;
// in the real app it is absent, so both helpers do nothing.
type PreviewBridge = { accessMode?: string; screen?: (name: string) => void };

function bridge(): PreviewBridge | undefined {
  return (globalThis as { __MVC_PREVIEW__?: PreviewBridge }).__MVC_PREVIEW__;
}

export function reportScreen(name: string): void {
  bridge()?.screen?.(name);
}

export function previewAccessMode(): string | undefined {
  return bridge()?.accessMode;
}
