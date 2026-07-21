# Personal Space

A personal knowledge manager inspired by Notion — pages, blocks, databases with table / board /
list views — built autonomously by a team of OpenCode agents running on open-source models.

- [REQUIREMENTS.md](./REQUIREMENTS.md) — what gets built, phase by phase, with success criteria.
- [AGENTS.md](./AGENTS.md) — the build rules: team roles, defect workflow, file formats.
- `.opencode/agents/` — the five agent definitions (orchestrator, two devs, qa, adversary).

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
