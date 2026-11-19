# Bunny factory

A software factory for Bunny: agents that turn tickets, PRs and schedules into merged code.

## Vocabulary

Read [docs/glossary.md](docs/glossary.md) before writing code, docs, tickets or PRs. Use its terms (task, trigger, run, runner, ticket tracker, git host, orchestrator, …) and avoid the words it lists under _Avoid_.

## Task prompts and skills

Each task's prompt, `orchestrator/sandbox/tasks/<task>/prompt.md`, is its run's one entry point: it lists every skill the run uses, in order. [orchestrator/sandbox/README.md](orchestrator/sandbox/README.md) has the tree for each task.

- Prompts call a skill with the Skill tool, except a skill marked `disable-model-invocation: true`, which the Skill tool won't load. The prompt tells the agent to read that one by path (`~/.claude/skills/<skill>/SKILL.md`) and says why. Today that's only `implement`.
- Skills not prefixed `oscar-factory-` are read-only copies from upstream (Matt Pocock's, Dex Horthy's). Never edit them, not even their frontmatter. To change how one behaves in a run, say so in the prompt, at the step that uses it.

## Docs

- [docs/services.md](docs/services.md): which product fills each service slot, and how a run flows through them.
- [docs/daytona-stack-best-practices.md](docs/daytona-stack-best-practices.md): research notes on running a full web-app dev stack in Daytona sandboxes for coding agents.
