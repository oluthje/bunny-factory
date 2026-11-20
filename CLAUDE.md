# Bunny factory

A software factory for Bunny: agents that turn tickets, PRs and schedules into merged code.

## Vocabulary

Read [docs/glossary.md](docs/glossary.md) before writing code, docs, tickets or PRs. Use its terms (task, trigger, run, runner, ticket tracker, git host, orchestrator, …) and avoid the words it lists under _Avoid_.

## Coding standards

Read [docs/coding-standards.md](docs/coding-standards.md) before writing orchestrator code. In short: everything one task owns lives in `orchestrator/tasks/<task>/`, `src/` knows no task by name, and step ids and step return shapes are a contract with in-flight runs.

## Task prompts and skills

Each task's prompt, `orchestrator/tasks/<task>/prompt.md`, is its run's one entry point: it lists every skill the run uses, in order. [orchestrator/tasks/README.md](orchestrator/tasks/README.md) has the tree for each task; [orchestrator/runner-files/README.md](orchestrator/runner-files/README.md) has what reaches the runner and the skills table.

- Prompts call a skill with the Skill tool, except a skill marked `disable-model-invocation: true`, which the Skill tool won't load. The prompt tells the agent to read that one by path (`~/.claude/skills/<skill>/SKILL.md`) and says why. Today that's only `implement`.
- Skills not prefixed `factory-` are read-only copies from upstream (Matt Pocock's, Dex Horthy's). Never edit them, not even their frontmatter. To change how one behaves in a run, say so in the prompt, at the step that uses it; when the change is long or shared by several tasks, wrap it in a `factory-` skill instead (see [runner-files/README.md](orchestrator/runner-files/README.md#wrapping-a-read-only-skill)).

## Docs

- [README.md](README.md): operating the factory on Fly: the `fac` CLI (`status`, `start`, `stop`), deploys, disk pruning and the cutover.
- [docs/services.md](docs/services.md): which product fills each service slot, and how a run flows through them.
- [docs/daytona-stack-best-practices.md](docs/daytona-stack-best-practices.md): research notes on running a full web-app dev stack in Daytona sandboxes for coding agents.
