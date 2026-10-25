"use client";

import { Check, Copy, Download, Link2, LogOut, X } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { ErrorNote, Field, Pill, Segmented, Skeleton } from "@/components/ui";
import {
  api,
  errorMessage,
  isTeamAdmin,
  type WorkspaceInfo,
  type WorkspaceInvite,
  type WorkspaceRole,
} from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useApi } from "@/lib/use-api";
import { useWorkspace } from "@/lib/workspace";
import { PolicyEditor } from "./policy-editor";

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

/**
 * Settings → Team: one workspace whose rules apply to everyone in it, admins who sign off
 * on risky actions, and an audit export. Tasks, connections and memory stay personal.
 */
export function TeamSettings() {
  const info = useApi(() => api.workspace());
  const { reload } = useWorkspace();

  if (info.error) return <ErrorNote>{errorMessage(info.error)}</ErrorNote>;
  if (!info.data)
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-40 rounded-card" />
      </div>
    );
  const changed = (next: WorkspaceInfo) => {
    info.setData(next);
    void reload();
  };
  if (!info.data.workspace) return <CreateTeam onCreated={changed} />;
  const admin = isTeamAdmin(info.data.role);

  return (
    <div className="space-y-12">
      <TeamName info={info.data} onChanged={changed} />
      <Members
        info={info.data}
        onChanged={changed}
        onReload={() => {
          void info.reload();
          void reload();
        }}
      />
      {admin ? <Invites /> : null}
      <PolicyEditor scope="team" />
      {admin ? <AuditExport /> : null}
    </div>
  );
}

function CreateTeam({ onCreated }: { onCreated: (info: WorkspaceInfo) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-8">
      <div className="rounded-[16px] bg-sunken/70 px-5 py-5">
        <p className="font-serif text-[24px] leading-tight text-fg">Work as a team</p>
        <p className="mt-2 max-w-[34rem] text-13 text-fg-muted">
          A team workspace has one set of rules that applies to everyone in it, can send risky
          actions to an admin for sign-off, and keeps an exportable audit log. Tasks, connections
          and memory stay personal. Got an invite link? Open it to join.
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            onCreated(await api.createWorkspace(name.trim()));
            toast("Team created. You're its owner.", "success");
          } catch (err) {
            toast(errorMessage(err), "error");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Team name" htmlFor="team-name" className="min-w-0 flex-1 basis-60">
          <input
            id="team-name"
            className="input"
            placeholder="Acme"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create team"}
        </button>
      </form>
    </div>
  );
}

function TeamName({
  info,
  onChanged,
}: {
  info: WorkspaceInfo;
  onChanged: (info: WorkspaceInfo) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(info.workspace?.name ?? "");
  const [busy, setBusy] = useState(false);
  const admin = isTeamAdmin(info.role);
  const dirty = name.trim() !== "" && name.trim() !== info.workspace?.name;
  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-serif text-[28px] leading-tight text-fg">{info.workspace?.name}</h3>
        {info.role ? <Pill tone="accent">You're {ROLE_LABEL[info.role].toLowerCase()}</Pill> : null}
      </div>
      {admin ? (
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              onChanged(await api.renameWorkspace(name.trim()));
              toast("Team renamed", "success");
            } catch (err) {
              toast(errorMessage(err), "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Team name" htmlFor="team-rename" className="min-w-0 flex-1 basis-60">
            <input
              id="team-rename"
              className="input"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          {dirty ? (
            <button type="submit" className="btn" disabled={busy}>
              {busy ? "Saving…" : "Rename"}
            </button>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

function Members({
  info,
  onChanged,
  onReload,
}: {
  info: WorkspaceInfo;
  onChanged: (info: WorkspaceInfo) => void;
  onReload: () => void;
}) {
  const toast = useToast();
  const { user } = useWorkspace();
  const [busy, setBusy] = useState<string | null>(null);
  const admin = isTeamAdmin(info.role);
  const owner = info.role === "owner";

  async function setRole(userId: string, role: WorkspaceRole) {
    setBusy(userId);
    try {
      onChanged(await api.setMemberRole(userId, role));
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  }

  async function remove(userId: string, self: boolean) {
    const ok = window.confirm(
      self
        ? "Leave this team? Its rules stop applying to you, and you'll need a new invite to come back."
        : "Remove this person from the team? Their tasks stay theirs.",
    );
    if (!ok) return;
    setBusy(userId);
    try {
      await api.removeMember(userId);
      toast(self ? "You left the team" : "Removed from the team", "success");
      onReload();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Members">
      <h3 className="font-serif text-[24px] leading-tight text-fg">Members</h3>
      <p className="mt-1 mb-4 text-13 text-fg-muted">
        Owners and admins manage the team and its rules, and sign off on actions the team says need
        an admin. Only owners make owners; a team always keeps at least one.
      </p>
      <ul className="divide-y divide-line rounded-[16px] border border-line bg-surface">
        {info.members.map((m) => {
          const self = m.userId === user?.id;
          // Admins manage members and admins; only owners touch owners.
          const canChange = admin && (owner || m.role !== "owner");
          return (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate text-14 font-medium text-fg">
                  {m.name}
                  {self ? <span className="font-normal text-fg-faint"> · you</span> : null}
                </p>
                <p className="truncate text-12 text-fg-muted">
                  {m.email} ·{" "}
                  <span title={formatDateTime(m.joinedAt)}>
                    joined {formatRelative(m.joinedAt)}
                  </span>
                </p>
              </div>
              {canChange ? (
                <Segmented<WorkspaceRole>
                  label={`Role for ${m.name}`}
                  size="sm"
                  value={m.role}
                  onChange={(role) => void setRole(m.userId, role)}
                  options={(owner
                    ? (["owner", "admin", "member"] as const)
                    : (["admin", "member"] as const)
                  ).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
                />
              ) : (
                <Pill tone={m.role === "member" ? "neutral" : "accent"}>{ROLE_LABEL[m.role]}</Pill>
              )}
              {self ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy === m.userId}
                  onClick={() => void remove(m.userId, true)}
                >
                  <LogOut className="size-3.5" />
                  Leave
                </button>
              ) : canChange ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm text-danger"
                  aria-label={`Remove ${m.name}`}
                  disabled={busy === m.userId}
                  onClick={() => void remove(m.userId, false)}
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const INVITE_TONE: Record<WorkspaceInvite["status"], "ok" | "neutral" | "danger" | "outline"> = {
  active: "ok",
  used: "neutral",
  revoked: "danger",
  expired: "outline",
};

function Invites() {
  const toast = useToast();
  const invites = useApi(() => api.invites());
  const [role, setRole] = useState<"admin" | "member">("member");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const res = await api.createInvite(role);
      setLink(res.link);
      setCopied(false);
      void invites.reload();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      toast("Couldn't copy. Select the link and copy it yourself.", "error");
    }
  }

  async function revoke(id: string) {
    try {
      await api.revokeInvite(id);
      void invites.reload();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <section aria-label="Invites">
      <h3 className="font-serif text-[24px] leading-tight text-fg">Invite people</h3>
      <p className="mt-1 mb-4 text-13 text-fg-muted">
        Each link works once and expires in 7 days. Send it however you like; whoever opens it while
        signed in joins the team.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<"admin" | "member">
          label="Invite as"
          value={role}
          onChange={setRole}
          options={[
            { value: "member", label: "Member" },
            { value: "admin", label: "Admin" },
          ]}
        />
        <button type="button" className="btn" disabled={busy} onClick={() => void create()}>
          <Link2 className="size-3.5" />
          {busy ? "Creating…" : "Create invite link"}
        </button>
      </div>
      {link ? (
        <div className="slip mt-4 px-4 py-3">
          <p className="eyebrow">Shown once. Copy it now.</p>
          <div className="mt-2 flex items-center gap-2">
            <input
              aria-label="Invite link"
              readOnly
              className="input min-w-0 flex-1 font-mono text-12"
              value={link}
              onFocus={(e) => e.target.select()}
            />
            <button type="button" className="btn btn-primary" onClick={() => void copy()}>
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}
      {invites.data && invites.data.invites.length > 0 ? (
        <ul className="mt-5 divide-y divide-line rounded-[16px] border border-line bg-surface">
          {invites.data.invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-13">
              <Pill tone={INVITE_TONE[i.status]}>{i.status}</Pill>
              <span className="text-fg">{ROLE_LABEL[i.role]}</span>
              <span className="min-w-0 flex-1 truncate text-fg-muted">
                {i.status === "used"
                  ? `Joined by ${i.usedByEmail ?? "someone"}`
                  : i.status === "active"
                    ? `Expires ${formatRelative(i.expiresAt)}`
                    : `Created ${formatRelative(i.createdAt)}`}
              </span>
              {i.status === "active" ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-danger"
                  onClick={() => void revoke(i.id)}
                >
                  Revoke
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

const day = (d: Date) => d.toISOString().slice(0, 10);

function AuditExport() {
  const [from, setFrom] = useState(() => day(new Date(Date.now() - 30 * 24 * 3600_000)));
  const [to, setTo] = useState(() => day(new Date()));
  const valid = from !== "" && to !== "" && from <= to;
  return (
    <section aria-label="Audit log">
      <h3 className="font-serif text-[24px] leading-tight text-fg">Audit log</h3>
      <p className="mt-1 mb-4 text-13 text-fg-muted">
        Every action members' tasks proposed while in the team: when, who, which task and tool, what
        the rules said, and who decided. A CSV for your spreadsheet or compliance folder.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From" htmlFor="audit-from">
          <input
            id="audit-from"
            type="date"
            className="input"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="To" htmlFor="audit-to">
          <input
            id="audit-to"
            type="date"
            className="input"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <a
          className="btn"
          href={valid ? api.auditCsvUrl(from, to) : undefined}
          aria-disabled={!valid}
          download
        >
          <Download className="size-3.5" />
          Download CSV
        </a>
      </div>
    </section>
  );
}
