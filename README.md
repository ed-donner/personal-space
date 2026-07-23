# Personal Space

A personal knowledge manager you run on your own computer — a private, single-user take on
Notion. Notes, plans and lists as free-form pages, plus databases you can view as tables,
boards and lists. One user, no login, everything stays on your machine.

## Running the app

Prerequisites: Node.js 20+ and npm. Nothing else — no accounts, no cloud, no internet needed.

    npm start

Then open **http://localhost:3002** in your browser. The first run installs dependencies,
builds the frontend and starts the server with a fully seeded workspace (nested pages, three
databases, realistic content). Your data lives in a local SQLite file at
`server/data/personal-space.db` — delete it to start over with a fresh seed.

### What's inside

- **Pages** in an expandable sidebar tree — nest to any depth, emoji icons, create / rename /
  delete (with confirmation, cascading to nested pages).
- **A block editor** — click and type; everything autosaves. Eleven block types (paragraph,
  headings 1–3, bulleted and numbered lists, to-dos, quote, divider, code, callout) via the
  `/` menu; drag blocks to reorder.
- **Databases** — rows with typed properties (text, number, select, multi-select, date,
  checkbox, URL), viewed as a **table**, a **board** (drag cards between columns) or a
  **list**, with per-view filters and sorts that persist. Every row opens as its own page.
- **Quick-find** — Ctrl/Cmd+K or the sidebar Search button; jumps to any page, database or row.
- **Light and dark mode** — the toggle in the top bar; your choice persists.

### Development

- `npm start` — one-command bootstrap (install, build, seed, serve).
- `npm run dev:server` — backend dev mode with reload.
- `npm -w server run test` / `npm -w web run test` — unit suites with coverage (both ≥ 80%
  statements).
- `cd e2e && npx playwright test` — end-to-end suite against the real app in Chromium.

## Building this project

- [REQUIREMENTS.md](./REQUIREMENTS.md) — what was built, phase by phase, with success criteria.
- [AGENTS.md](./AGENTS.md) — the build rules: team roles, defect workflow, file formats.
- [DEFECTS.md](./DEFECTS.md) — the defect ledger. [ADVERSARIAL_REVIEW.md](./ADVERSARIAL_REVIEW.md) —
  adversarial findings and their dispositions. `screenshots/` — visual evidence. `e2e/` — the
  end-to-end suite.

The product was built autonomously by a team of OpenCode agents (orchestrator, frontend-dev,
backend-dev, qa, adversary) running on open-source models.

## Running the build

Prerequisites: Docker, and VS Code with the Dev Containers extension.

1. Put an OpenRouter API key in `.env` at the repo root (gitignored):

       OPENROUTER_API_KEY=sk-or-...

   Use a dedicated key with a spend cap — the agents run unattended against paid models.

2. Open this folder in VS Code and reopen it in the container: click **Reopen in Container** on
   the notification VS Code shows when it detects `.devcontainer`, or open the Command Palette
   (Cmd+Shift+P) and run **Dev Containers: Reopen in Container**. The same menu sits behind the
   `><` indicator in the bottom-left corner of the window. First build takes a few minutes:
   setup installs OpenCode and agent-browser, downloads the browser, and adds the agent-browser
   skill for OpenCode. The key is injected when the container is created, so after changing
   `.env`, run **Dev Containers: Rebuild Container** to pick it up.

   If the skill install ever needs re-running by hand:

       npx skills add vercel-labs/agent-browser -a opencode -y

3. In the container terminal, start OpenCode and switch to the **orchestrator** agent (press
   Tab to cycle primary agents). Its model, Kimi K3, comes from the agent definition — check the
   status line shows it.

       opencode

4. Kick it off with:

   > Complete the entire project as specified and don't stop until all success criteria are met
   > and the product is running

While it runs: defects appear in `DEFECTS.md`, adversarial findings in `ADVERSARIAL_REVIEW.md`,
evidence in `screenshots/`, end-to-end tests in `e2e/`. When the app starts, VS Code forwards its
port — open it in your own browser to watch and use the product.
