import { type FakeSlackMessage, fakeSlackApi } from "@synapse/tools/slack-testing";
import { signSlackRequest } from "./slack-api";

export type { FakeSlackMessage };

/**
 * The fake Slack Web API (`fakeSlackApi`) plus signed button clicks, for the approval DMs.
 * Pass `fake.fetch` as `SlackAppConfig.fetch` in tests.
 */
export function fakeSlack(opts: { teamId?: string; teamName?: string } = {}) {
  const api = fakeSlackApi(opts);
  const { state } = api;
  return {
    ...api,
    /**
     * The request Slack would send when `user` clicks `actionId` on `message`, signed with
     * `signingSecret` (pass another secret or an old timestamp to test rejection).
     */
    click(
      message: FakeSlackMessage,
      actionId: "approve" | "deny",
      o: { signingSecret: string; user?: string; team?: string; timestamp?: number },
    ) {
      const button = message.blocks
        .find((b) => b.type === "actions")
        ?.elements.find((e: { action_id: string }) => e.action_id === actionId);
      const payload = {
        type: "block_actions",
        team: { id: o.team ?? state.teamId },
        user: { id: o.user ?? "U1", team_id: o.team ?? state.teamId },
        channel: { id: message.channel },
        container: { type: "message", message_ts: message.ts, channel_id: message.channel },
        response_url: `https://hooks.slack.com/actions/${state.teamId}/1/abc`,
        actions: [{ action_id: actionId, block_id: "decision", value: button?.value }],
      };
      const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
      const ts = o.timestamp ?? Math.floor(Date.now() / 1000);
      return {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-slack-request-timestamp": String(ts),
          "x-slack-signature": signSlackRequest(o.signingSecret, body, ts),
        },
        body,
      };
    },
  };
}
