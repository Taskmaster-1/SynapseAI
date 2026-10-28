/*
 * Synapse service worker: approval notifications and their Approve / Deny buttons.
 * It caches nothing and never intercepts requests. Payloads are written by
 * apps/server/src/notify/push.ts (PushMessage).
 */

const ICON = "/icons/icon-192.png";
const BADGE = "/icons/badge-96.png";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** Notification buttons, where the platform has them (not iOS/macOS Safari). */
function maxActions() {
  return self.Notification?.maxActions || 0;
}

/** Only ever open pages of this app, whatever a payload says. */
function sameOriginUrl(url) {
  try {
    const u = new URL(url || "/", self.location.origin);
    return u.origin === self.location.origin ? u.href : self.location.origin;
  } catch {
    return self.location.origin;
  }
}

function show(title, options) {
  const actions = maxActions() > 0 ? (options.actions || []).slice(0, maxActions()) : [];
  return self.registration.showNotification(title, {
    icon: ICON,
    badge: BADGE,
    ...options,
    actions,
  });
}

self.addEventListener("push", (event) => {
  let msg;
  try {
    msg = event.data ? event.data.json() : null;
  } catch {
    msg = null;
  }
  if (!msg) msg = { title: "Synapse", body: "Something needs your attention.", data: {} };
  const data = msg.data || {};
  event.waitUntil(
    show(msg.title, {
      body: msg.body,
      tag: msg.tag,
      data,
      actions: msg.actions,
      // Stays until handled where supported: it is waiting on you.
      requireInteraction: Boolean(data.toolCallId),
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  const data = notification.data || {};
  const url = sameOriginUrl(data.url);
  notification.close();
  const action = event.action;
  if ((action === "approve" || action === "deny") && data.runId && data.toolCallId) {
    event.waitUntil(decide(action === "approve", data, notification.body, url));
  } else if (action === "undo" && data.runId && data.toolCallId) {
    event.waitUntil(undo(data, url));
  } else {
    event.waitUntil(focusOrOpen(url));
  }
});

function callPath(data, suffix) {
  return `/api/runs/${encodeURIComponent(data.runId)}/tool-calls/${encodeURIComponent(data.toolCallId)}/${suffix}`;
}

/** Same-origin call with the session cookie; throws on anything but success. */
async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function decide(approved, data, body, url) {
  let result;
  try {
    result = await post(callPath(data, "decision"), { approved, via: "push" });
  } catch {
    // Signed out, already decided elsewhere, or offline: let the person see it in the app.
    return focusOrOpen(url);
  }
  // Two-person sign-off: the first of two approvals; it waits for someone else.
  if (approved && result.partial)
    return show("Approved · needs a second approval", {
      body: body || "Someone else on your team has to approve it too.",
      tag: data.toolCallId,
      data: { url: data.url },
      silent: true,
    });
  if (!approved || !result.executeAfter) return;
  // A send or delete waits out the undo window: say so, and offer Undo where possible.
  const seconds = Math.max(1, Math.round((Date.parse(result.executeAfter) - Date.now()) / 1000));
  const verb = data.effect === "send" ? "sending" : "running";
  return show(`Approved · ${verb} in ${seconds}s`, {
    body: body || "Tap to open the task.",
    tag: data.toolCallId,
    data: { ...data, approved: true },
    actions: [{ action: "undo", title: "Undo" }],
    silent: true,
  });
}

async function undo(data, url) {
  try {
    await post(callPath(data, "undo"), {});
    await show("Undone", {
      body: "It won't run. Open the task to tell Synapse what to do instead.",
      tag: data.toolCallId,
      data: { url: data.url },
      silent: true,
    });
  } catch {
    // Too late, or signed out: show the task as it is.
    await focusOrOpen(url);
  }
}

async function focusOrOpen(url) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if (client.url === url && "focus" in client) return client.focus();
  }
  const any = windows.find((c) => "navigate" in c && "focus" in c);
  if (any) {
    try {
      await any.navigate(url);
      return any.focus();
    } catch {
      // Not controlled by this worker: fall through to a new window.
    }
  }
  return self.clients.openWindow(url);
}

/** The push service rotated this device's subscription: register the new one. */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const res = await fetch("/api/push/config", { credentials: "include" });
      if (!res.ok) return;
      const config = await res.json();
      if (!config.enabled || !config.publicKey) return;
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: config.publicKey,
      });
      await post("/api/push/subscriptions", sub.toJSON());
    })(),
  );
});
