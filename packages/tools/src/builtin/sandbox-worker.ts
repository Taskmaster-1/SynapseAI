/** Worker entry for `runSandboxed`: runs one job and posts the result back. */
import { runInSandbox, type SandboxJob } from "./sandbox";

declare const self: Worker;

self.onmessage = async (event: MessageEvent<SandboxJob>) => {
  self.postMessage(await runInSandbox(event.data));
};
