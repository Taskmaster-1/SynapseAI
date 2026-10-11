#!/usr/bin/env bun
/**
 * Live evals against a real model. Costs money: every attempt calls the provider.
 *
 *   ANTHROPIC_API_KEY=… bun run evals --model anthropic:claude-sonnet-5-5 --k 3 [--only inbox-injection]
 */
import { parseArgs } from "node:util";
import { createModel, parseModelRef } from "@synapse/core";
import { runSuite } from "./run";
import { SCENARIOS } from "./scenarios";

const { values } = parseArgs({
  options: {
    model: { type: "string", default: "anthropic:claude-sonnet-5-5" },
    k: { type: "string", default: "3" },
    only: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

const spec = parseModelRef(values.model!);
const model = createModel(spec, {
  ...(process.env.ANTHROPIC_API_KEY ? { anthropic: process.env.ANTHROPIC_API_KEY } : {}),
  ...(process.env.OPENAI_API_KEY ? { openai: process.env.OPENAI_API_KEY } : {}),
  ...(process.env.GOOGLE_GENERATIVE_AI_API_KEY
    ? { google: process.env.GOOGLE_GENERATIVE_AI_API_KEY }
    : {}),
});
const scenarios = values.only
  ? SCENARIOS.filter((s) => values.only!.split(",").includes(s.id))
  : SCENARIOS;
const k = Number(values.k);

const summary = await runSuite(scenarios, { spec, model }, k, (a) => {
  if (!values.json) console.error(`${a.pass ? "✓" : "✗"} ${a.scenario}#${a.attempt}  ${a.why}`);
});

if (values.json) {
  console.log(JSON.stringify({ model: spec.ref, k, summary }, null, 2));
} else {
  console.log(`\nmodel ${spec.ref}, k=${k}\n`);
  console.log("scenario".padEnd(24), "category".padEnd(9), "pass".padEnd(6), "pass^k", "cost");
  for (const s of summary) {
    console.log(
      s.scenario.padEnd(24),
      s.category.padEnd(9),
      `${s.passes}/${s.k}`.padEnd(6),
      s.passAllK ? "yes   " : "no    ",
      `$${s.costUsd.toFixed(4)}`,
    );
  }
  const reliable = summary.filter((s) => s.passAllK).length;
  console.log(
    `\npass^${k}: ${reliable}/${summary.length} scenarios; total $${summary.reduce((n, s) => n + s.costUsd, 0).toFixed(4)}`,
  );
}
