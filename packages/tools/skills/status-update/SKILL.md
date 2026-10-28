---
name: status-update
description: Write a concise status update for a project or week (done, next, risks, asks) from the user's notes, email and documents. Use when the user asks for a status update, weekly report, progress summary or stand-up notes.
license: MIT
---

# Status update

## Steps

1. Ask what the update is for and who reads it, if the user did not say: a team channel, a
   manager, a client. The audience sets the level of detail.
2. Gather facts from what the user gave you, then from their documents (`knowledge_search`)
   and recent email on the topic. Note where each fact came from.
3. Write it in the shape of `template.md` (load it with `load_skill`, file `template.md`).
4. Show the draft. Send or post it only when the user asks, to the place and people they name.

## Style

- Lead with the headline: on track, at risk, or off track, in one sentence.
- Outcomes over activity: "Checkout is live for 10% of users", not "Worked on checkout".
- Numbers and dates beat adjectives.
- Risks come with what is being done about them. Asks name a person and a date.
- Under 200 words unless the user asks for more.
