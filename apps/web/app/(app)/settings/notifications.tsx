"use client";

import { BellRing, Smartphone } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/toast";
import { Pill, Skeleton, Switch } from "@/components/ui";
import { api, errorMessage, type Settings, type SettingsUpdate } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import {
  currentSubscription,
  isIOS,
  PermissionError,
  type PushSupport,
  pushSupport,
  subscribe,
} from "@/lib/push";
import { useApi } from "@/lib/use-api";

type SaveFn = (update: SettingsUpdate, message?: string) => Promise<boolean>;

export function Notifications({
  settings,
  save,
  emailConfigured,
}: {
  settings: Settings;
  save: SaveFn;
  emailConfigured: boolean;
}) {
  return (
    <div className="space-y-10">
      <PushSection />
      <EmailAlerts settings={settings} save={save} configured={emailConfigured} />
    </div>
  );
}

function PushSection() {
  const toast = useToast();
  const config = useApi(() => api.pushConfig());
  const devices = useApi(() => api.pushDevices());
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshDevice = useCallback(async () => {
    const s = pushSupport();
    setSupport(s);
    if (typeof Notification !== "undefined") setPermission(Notification.permission);
    if (s === "supported")
      setEndpoint((await currentSubscription().catch(() => null))?.endpoint ?? null);
  }, []);
  useEffect(() => {
    void refreshDevice();
  }, [refreshDevice]);

  const list = devices.data?.subscriptions ?? [];
  const thisDevice = endpoint ? list.find((d) => d.endpoint === endpoint) : undefined;

  async function turnOn() {
    const key = config.data?.publicKey;
    if (!key) return;
    setBusy(true);
    try {
      const sub = await subscribe(key);
      await api.addPushDevice(sub.toJSON());
      toast("Notifications are on for this device", "success");
    } catch (err) {
      toast(err instanceof PermissionError ? err.message : errorMessage(err), "error");
    } finally {
      await refreshDevice();
      await devices.reload();
      setBusy(false);
    }
  }

  async function remove(id: string, local: boolean) {
    setBusy(true);
    try {
      if (local) await (await currentSubscription())?.unsubscribe();
      await api.removePushDevice(id);
      toast(local ? "Notifications are off for this device" : "Device removed", "success");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      await refreshDevice();
      await devices.reload();
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const { sent } = await api.testPush();
      toast(
        sent === 0
          ? "No device took the test. Turn notifications on first."
          : `Sent to ${sent} device${sent === 1 ? "" : "s"}`,
        sent === 0 ? "error" : "success",
      );
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      await devices.reload();
      setBusy(false);
    }
  }

  let deviceState: ReactNode;
  if (config.loading && !config.data) deviceState = <Skeleton className="h-16 rounded-[16px]" />;
  else if (config.error) deviceState = <Note>{errorMessage(config.error)}</Note>;
  else if (!config.data?.enabled)
    deviceState = (
      <Note title="Not set up on this server">
        Push needs VAPID keys. Generate a pair with{" "}
        <code className="font-mono text-12">bunx web-push generate-vapid-keys</code>, then set{" "}
        <Env>VAPID_PUBLIC_KEY</Env>, <Env>VAPID_PRIVATE_KEY</Env> and <Env>VAPID_SUBJECT</Env> (a
        mailto: address) and restart. See docs/notifications.md.
      </Note>
    );
  else if (support === null) deviceState = <Skeleton className="h-16 rounded-[16px]" />;
  else if (support === "needs-install")
    deviceState = (
      <Note title="Add Synapse to your Home Screen first">
        On iPhone and iPad, notifications only work from the installed app. Tap Share, then{" "}
        <span className="text-fg">Add to Home Screen</span>, open Synapse from there and come back
        to this page.
      </Note>
    );
  else if (support === "unsupported")
    deviceState = (
      <Note title="This browser can't receive notifications">
        Try Chrome, Edge, Firefox or Safari 16+.
        {isIOS() ? " On iPhone, use Safari and add Synapse to your Home Screen." : ""}
      </Note>
    );
  else if (support === "disabled")
    deviceState = (
      <Note title="Off in development builds">
        The service worker only runs in production builds. To try it with{" "}
        <code className="font-mono text-12">next dev</code>, set{" "}
        <Env>NEXT_PUBLIC_ENABLE_SW=true</Env>.
      </Note>
    );
  else if (permission === "denied" && !thisDevice)
    deviceState = (
      <Note title="Notifications are blocked">
        This browser was told not to show notifications from Synapse. Allow them in the site
        settings (the icon next to the address), then reload this page.
      </Note>
    );
  else
    deviceState = (
      <div className="flex flex-wrap items-center gap-3 rounded-[16px] border border-line bg-surface px-4 py-3.5">
        <BellRing className="size-4 text-fg-muted" />
        <div className="min-w-0 flex-1">
          <p className="text-14 text-fg">
            {thisDevice ? "On for this device" : "Off for this device"}
          </p>
          <p className="text-12 text-fg-muted">
            {thisDevice
              ? "Approvals show up here, even when Synapse is closed."
              : "Get a notification when a task needs your OK."}
          </p>
        </div>
        {thisDevice ? (
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => void remove(thisDevice.id, true)}
          >
            Turn off
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => void turnOn()}
          >
            Turn on
          </button>
        )}
      </div>
    );

  return (
    <section>
      <h3 className="font-serif text-[24px] leading-tight text-fg">Push notifications</h3>
      <p className="mt-1 mb-4 text-13 text-fg-muted">
        Approve or deny right from the notification. Sends and deletes still wait out your undo
        window, so a lock-screen “Approve” can be taken back.
      </p>
      {deviceState}

      {list.length > 0 ? (
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="label mb-0">Your devices</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy || !config.data?.enabled}
              onClick={() => void test()}
            >
              Send a test
            </button>
          </div>
          <ul className="divide-y divide-line rounded-[16px] border border-line bg-surface">
            {list.map((d) => {
              const local = d.id === thisDevice?.id;
              return (
                <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                  <Smartphone className="size-4 shrink-0 text-fg-faint" />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-14 text-fg">
                        {d.label ?? "Unknown device"}
                      </span>
                      {local ? <Pill tone="accent">This device</Pill> : null}
                    </div>
                    <p className="text-12 text-fg-faint">
                      Added {formatRelative(d.createdAt)}
                      {d.lastUsedAt ? ` · last notified ${formatRelative(d.lastUsedAt)}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-danger"
                    disabled={busy}
                    onClick={() => void remove(d.id, local)}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function EmailAlerts({
  settings,
  save,
  configured,
}: {
  settings: Settings;
  save: SaveFn;
  configured: boolean;
}) {
  const [on, setOn] = useState(settings.emailAlerts);
  useEffect(() => setOn(settings.emailAlerts), [settings.emailAlerts]);
  return (
    <section className="border-t border-line pt-8">
      <h3 className="font-serif text-[24px] leading-tight text-fg">Email alerts</h3>
      <div className="mt-3 flex items-start justify-between gap-4 rounded-[16px] border border-line bg-surface px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-14 text-fg">Email me when something needs my OK</p>
          <p className="hint mt-1">
            {configured ? (
              "Sent to your account email, with a link to the task. There are no approve buttons in email: mail scanners open links, so you decide in the app."
            ) : (
              <>
                Not set up on this server: it needs <Env>SMTP_URL</Env> and <Env>EMAIL_FROM</Env>.
              </>
            )}
          </p>
        </div>
        <Switch
          label="Email alerts"
          checked={on && configured}
          disabled={!configured}
          onChange={async (v) => {
            setOn(v);
            if (!(await save({ emailAlerts: v }, v ? "Email alerts on" : "Email alerts off")))
              setOn(!v);
          }}
        />
      </div>
    </section>
  );
}

function Note({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-[16px] border border-line bg-surface px-4 py-3.5 text-13 text-fg-muted">
      {title ? <p className="mb-1 text-14 text-fg">{title}</p> : null}
      {children}
    </div>
  );
}

function Env({ children }: { children: ReactNode }) {
  return <code className="rounded bg-sunken px-1 font-mono text-12 text-fg">{children}</code>;
}
