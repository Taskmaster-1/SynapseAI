/**
 * Browser side of Web Push: the service worker (public/sw.js), permission and the
 * PushManager subscription for this device.
 */

/** The worker is only registered in production builds, or in dev with NEXT_PUBLIC_ENABLE_SW=true. */
export const SW_ENABLED =
  process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENABLE_SW === "true";

export type PushSupport =
  | "supported"
  /** iOS/iPadOS Safari: push only works once the app is on the Home Screen. */
  | "needs-install"
  | "unsupported"
  /** Built without the service worker (development). */
  | "disabled";

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS reports itself as a Mac with touch.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const apis = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!apis) return isIOS() && !isStandalone() ? "needs-install" : "unsupported";
  if (!SW_ENABLED) return "disabled";
  return "supported";
}

export function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

/** This device's current subscription, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Asks for permission (must run from a user gesture on iOS) and subscribes this device. */
export async function subscribe(publicKey: string): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new PermissionError(permission);
  const reg = await registerServiceWorker();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another server key can't receive our pushes.
  if (sub && !sameKey(sub, publicKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  return (
    sub ??
    reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(publicKey),
    })
  );
}

export class PermissionError extends Error {
  constructor(readonly permission: NotificationPermission) {
    super(
      permission === "denied"
        ? "Notifications are blocked for this site. Allow them in your browser's site settings."
        : "Notifications weren't allowed.",
    );
  }
}

function sameKey(sub: PushSubscription, publicKey: string) {
  const key = sub.options.applicationServerKey;
  if (!key) return false;
  return bytesToBase64Url(new Uint8Array(key)) === publicKey.replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
