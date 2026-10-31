import type { Effect } from "@synapse/core";

/**
 * The app directory: remote MCP servers anyone can connect in one click. Each one either
 * signs in with OAuth and registers our client on its own (dynamic client registration or a
 * client ID metadata document), or needs no sign-in at all. Servers that need an app set up
 * by hand first (an OAuth client id, a token) stay out of here; they still work as a custom
 * server. Every tool they offer goes through the same effects and approval rules as the rest.
 */

export type AppCategory =
  | "Projects"
  | "Docs & files"
  | "Meetings"
  | "Sales & support"
  | "Payments"
  | "Design & sites"
  | "Engineering"
  | "Data"
  | "Research";

export const APP_CATEGORIES: AppCategory[] = [
  "Projects",
  "Docs & files",
  "Meetings",
  "Sales & support",
  "Payments",
  "Design & sites",
  "Engineering",
  "Data",
  "Research",
];

export interface CatalogApp {
  /** Also the connection name, so tools show up as "<id>__<tool>". No underscores. */
  id: string;
  title: string;
  url: string;
  category: AppCategory;
  /** One line: what the agent can do there. */
  description: string;
  /** "none": public server, nothing to sign in to. */
  auth: "oauth" | "none";
  /** Things to ask once it's connected; shown in the directory and on the home page. */
  examples: string[];
  /**
   * Effects for tools the server doesn't mark read-only, set when it's connected. Named one
   * by one: a tool the server adds later still starts out asking first.
   */
  toolEffects?: Record<string, Effect>;
}

export const CATALOG: CatalogApp[] = [
  // ── Projects ─────────────────────────────────────────────────────────────
  {
    id: "atlassian",
    title: "Jira & Confluence",
    url: "https://mcp.atlassian.com/v1/mcp",
    category: "Projects",
    description: "Search and update Jira issues, read and write Confluence pages.",
    auth: "oauth",
    examples: ["What Jira issues are assigned to me?", "Find the Confluence page on onboarding"],
  },
  {
    id: "asana",
    title: "Asana",
    url: "https://mcp.asana.com/mcp",
    category: "Projects",
    description: "Tasks, projects and goals in your Asana workspace.",
    auth: "oauth",
    examples: ["What's due in Asana this week?", "Summarise the status of my Asana projects"],
  },
  {
    id: "monday",
    title: "monday.com",
    url: "https://mcp.monday.com/mcp",
    category: "Projects",
    description: "Boards, items and updates on monday.com.",
    auth: "oauth",
    examples: ["What's stuck on my monday.com boards?"],
  },
  {
    id: "clickup",
    title: "ClickUp",
    url: "https://mcp.clickup.com/mcp",
    category: "Projects",
    description: "Tasks, lists and docs in ClickUp.",
    auth: "oauth",
    examples: ["What ClickUp tasks are overdue?"],
  },
  {
    id: "todoist",
    title: "Todoist",
    url: "https://ai.todoist.net/mcp",
    category: "Projects",
    description: "Your to-do list: add, find and complete tasks.",
    auth: "oauth",
    examples: ["What's on my Todoist today?", "Add the follow-ups from my last meeting to Todoist"],
  },
  {
    id: "linear-mcp",
    title: "Linear (MCP)",
    url: "https://mcp.linear.app/mcp",
    category: "Projects",
    description: "Linear's own server. The built-in Linear connection covers most needs.",
    auth: "oauth",
    examples: ["What's on my plate in Linear this week?"],
  },

  // ── Docs & files ─────────────────────────────────────────────────────────
  {
    id: "notion",
    title: "Notion",
    url: "https://mcp.notion.com/mcp",
    category: "Docs & files",
    description: "Search, read and write Notion pages and databases.",
    auth: "oauth",
    examples: [
      "Find my latest meeting notes in Notion",
      "Turn this week's notes into a summary page",
    ],
  },
  {
    id: "miro",
    title: "Miro",
    url: "https://mcp.miro.com/",
    category: "Docs & files",
    description: "Read boards and add stickies, frames and diagrams.",
    auth: "oauth",
    examples: ["Summarise the ideas on my latest Miro board"],
  },

  // ── Meetings ─────────────────────────────────────────────────────────────
  {
    id: "granola",
    title: "Granola",
    url: "https://mcp.granola.ai/mcp",
    category: "Meetings",
    description: "Your meeting notes and transcripts.",
    auth: "oauth",
    examples: [
      "What did we decide in yesterday's meetings?",
      "List action items from my meetings this week",
    ],
  },
  {
    id: "fireflies",
    title: "Fireflies",
    url: "https://api.fireflies.ai/mcp",
    category: "Meetings",
    description: "Meeting transcripts, summaries and action items.",
    auth: "oauth",
    examples: ["Summarise my last call with a customer"],
  },
  {
    id: "krisp",
    title: "Krisp",
    url: "https://mcp.krisp.ai/mcp",
    category: "Meetings",
    description: "Meeting notes and transcripts from Krisp.",
    auth: "oauth",
    examples: ["What action items came out of today's meetings?"],
  },
  {
    id: "cal",
    title: "Cal.com",
    url: "https://mcp.cal.com/mcp",
    category: "Meetings",
    description: "Event types, availability and bookings.",
    auth: "oauth",
    examples: ["What bookings do I have next week on Cal.com?"],
  },

  // ── Sales & support ──────────────────────────────────────────────────────
  {
    id: "intercom",
    title: "Intercom",
    url: "https://mcp.intercom.com/mcp",
    category: "Sales & support",
    description: "Customer conversations and contacts.",
    auth: "oauth",
    examples: ["What are customers asking about most this week?"],
  },
  {
    id: "attio",
    title: "Attio",
    url: "https://mcp.attio.com/mcp",
    category: "Sales & support",
    description: "Your CRM: people, companies, deals and notes.",
    auth: "oauth",
    examples: ["Which deals in Attio haven't moved in two weeks?"],
  },
  {
    id: "close",
    title: "Close",
    url: "https://mcp.close.com/mcp",
    category: "Sales & support",
    description: "Leads, opportunities and activity in Close.",
    auth: "oauth",
    examples: ["Which leads in Close need a follow-up?"],
  },

  // ── Payments ─────────────────────────────────────────────────────────────
  {
    id: "stripe",
    title: "Stripe",
    url: "https://mcp.stripe.com",
    category: "Payments",
    description: "Customers, payments, invoices and subscriptions.",
    auth: "oauth",
    examples: ["How much revenue came in this week?", "List failed payments from the last 7 days"],
  },
  {
    id: "paypal",
    title: "PayPal",
    url: "https://mcp.paypal.com/mcp",
    category: "Payments",
    description: "Invoices, orders and transactions.",
    auth: "oauth",
    examples: ["Which PayPal invoices are still unpaid?"],
  },
  {
    id: "square",
    title: "Square",
    url: "https://mcp.squareup.com/mcp",
    category: "Payments",
    description: "Payments, orders, catalog and customers.",
    auth: "oauth",
    examples: ["What were my Square sales yesterday?"],
  },
  {
    id: "ramp",
    title: "Ramp",
    url: "https://mcp.ramp.com/mcp",
    category: "Payments",
    description: "Company spend, cards and reimbursements.",
    auth: "oauth",
    examples: ["Where did our spend go this month?"],
  },
  {
    id: "mercury",
    title: "Mercury",
    url: "https://mcp.mercury.com/mcp",
    category: "Payments",
    description: "Bank accounts and transactions.",
    auth: "oauth",
    examples: ["Summarise this month's transactions in Mercury"],
  },

  // ── Design & sites ───────────────────────────────────────────────────────
  {
    id: "canva",
    title: "Canva",
    url: "https://mcp.canva.com/mcp",
    category: "Design & sites",
    description: "Find, create and export Canva designs.",
    auth: "oauth",
    examples: ["Find my latest presentation in Canva"],
  },
  {
    id: "webflow",
    title: "Webflow",
    url: "https://mcp.webflow.com/mcp",
    category: "Design & sites",
    description: "Sites, pages and CMS collections.",
    auth: "oauth",
    examples: ["List the blog posts on my Webflow site"],
  },
  {
    id: "wix",
    title: "Wix",
    url: "https://mcp.wix.com/mcp",
    category: "Design & sites",
    description: "Your Wix sites, stores and bookings.",
    auth: "oauth",
    examples: ["What orders came in on my Wix store this week?"],
  },
  {
    id: "jotform",
    title: "Jotform",
    url: "https://mcp.jotform.com/",
    category: "Design & sites",
    description: "Forms and their submissions.",
    auth: "oauth",
    examples: ["Summarise this week's form submissions"],
  },

  // ── Engineering ──────────────────────────────────────────────────────────
  {
    id: "sentry",
    title: "Sentry",
    url: "https://mcp.sentry.dev/mcp",
    category: "Engineering",
    description: "Errors, issues and releases.",
    auth: "oauth",
    examples: ["What new errors showed up this week?"],
  },
  {
    id: "netlify",
    title: "Netlify",
    url: "https://mcp.netlify.com/mcp",
    category: "Engineering",
    description: "Sites, deploys and forms.",
    auth: "oauth",
    examples: ["Did my latest Netlify deploy succeed?"],
  },
  {
    id: "cloudflare",
    title: "Cloudflare",
    url: "https://mcp.cloudflare.com/mcp",
    category: "Engineering",
    description: "Your Cloudflare account: Workers, DNS, storage and more.",
    auth: "oauth",
    examples: ["List my Cloudflare Workers and when they last deployed"],
  },
  {
    id: "supabase",
    title: "Supabase",
    url: "https://mcp.supabase.com/mcp",
    category: "Engineering",
    description: "Projects, tables, queries and logs.",
    auth: "oauth",
    examples: ["How many users signed up this week?"],
  },
  {
    id: "neon",
    title: "Neon",
    url: "https://mcp.neon.tech/mcp",
    category: "Engineering",
    description: "Postgres projects, branches and queries.",
    auth: "oauth",
    examples: ["What tables are in my Neon database?"],
  },
  {
    id: "gitlab",
    title: "GitLab",
    url: "https://gitlab.com/api/v4/mcp",
    category: "Engineering",
    description: "Projects, issues and merge requests on gitlab.com.",
    auth: "oauth",
    examples: ["What merge requests are waiting on me?"],
  },
  {
    id: "semgrep",
    title: "Semgrep",
    url: "https://mcp.semgrep.ai/mcp",
    category: "Engineering",
    description: "Scan code for security issues.",
    auth: "oauth",
    examples: ["Scan this snippet for security issues"],
  },
  {
    id: "context7",
    title: "Context7",
    url: "https://mcp.context7.com/mcp",
    category: "Engineering",
    description: "Up-to-date docs for thousands of libraries. No sign-in.",
    auth: "none",
    examples: ["How do I set up middleware in the latest Hono?"],
  },
  {
    id: "deepwiki",
    title: "DeepWiki",
    url: "https://mcp.deepwiki.com/mcp",
    category: "Engineering",
    description: "Ask questions about any public GitHub repository. No sign-in.",
    auth: "none",
    examples: ["How does routing work in vercel/next.js?"],
    toolEffects: {
      read_wiki_structure: "read",
      read_wiki_contents: "read",
      ask_question: "read",
      ask_wiki_question: "read",
    },
  },
  {
    id: "microsoft-learn",
    title: "Microsoft Learn",
    url: "https://learn.microsoft.com/api/mcp",
    category: "Engineering",
    description: "Official Microsoft and Azure docs. No sign-in.",
    auth: "none",
    examples: ["How do I rotate an Azure storage key?"],
  },

  // ── Data ─────────────────────────────────────────────────────────────────
  {
    id: "airtable",
    title: "Airtable",
    url: "https://mcp.airtable.com/mcp",
    category: "Data",
    description: "Bases, tables and records.",
    auth: "oauth",
    examples: ["Summarise the records added to my Airtable this week"],
  },
  {
    id: "posthog",
    title: "PostHog",
    url: "https://mcp.posthog.com/mcp",
    category: "Data",
    description: "Product analytics, feature flags and insights.",
    auth: "oauth",
    examples: ["How did signups trend this week?"],
  },
  {
    id: "amplitude",
    title: "Amplitude",
    url: "https://mcp.amplitude.com/mcp",
    category: "Data",
    description: "Charts, dashboards and user behaviour.",
    auth: "oauth",
    examples: ["Which features were used most last week?"],
  },

  // ── Research ─────────────────────────────────────────────────────────────
  {
    id: "exa",
    title: "Exa",
    url: "https://mcp.exa.ai/mcp",
    category: "Research",
    description: "Web search built for agents. No sign-in.",
    auth: "none",
    examples: ["Find recent articles about our competitors"],
  },
  {
    id: "tavily",
    title: "Tavily",
    url: "https://mcp.tavily.com/mcp",
    category: "Research",
    description: "Web search and page extraction.",
    auth: "oauth",
    examples: ["Research the pricing of the top three CRMs"],
  },
  {
    id: "apify",
    title: "Apify",
    url: "https://mcp.apify.com",
    category: "Research",
    description: "Ready-made scrapers for thousands of sites.",
    auth: "oauth",
    examples: ["Get the latest reviews of our product"],
  },
  {
    id: "huggingface",
    title: "Hugging Face",
    url: "https://huggingface.co/mcp",
    category: "Research",
    description: "Search models, datasets, papers and Spaces. No sign-in.",
    auth: "none",
    examples: ["Find a small open model for summarising text"],
  },
];

/** Same server despite cosmetic differences: case of the host, a trailing slash. */
export function sameServer(a: string, b: string): boolean {
  const norm = (u: string) => {
    try {
      const url = new URL(u);
      return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, "")}${url.search}`;
    } catch {
      return u;
    }
  };
  return norm(a) === norm(b);
}

export function catalogAppFor(url: string): CatalogApp | undefined {
  return CATALOG.find((a) => sameServer(a.url, url));
}
