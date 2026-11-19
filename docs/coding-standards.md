# Coding standards

How code in this repo is written. Vocabulary is in [glossary.md](glossary.md); how prompts and skills fit together is in the root `CLAUDE.md`. Where a rule here is checked by a test, the test is named.

## Where code lives

The orchestrator has three parts, and each file belongs to exactly one:

```
orchestrator/
├── tasks/<task>/   everything one task owns: its prompt and extract, its config and run code, its pure logic and tests
├── tasks/index.ts  the registry: every task, by name
├── runner-files/   what every run uploads to the runner whatever its task: skills/ and settings.json
└── src/            the engine: what every run shares, and knows no task by name
```

1. **Everything one task owns lives in `tasks/<task>/`.** Its prompt, its extract prompt, its entry (skills, browser, branch, time limit), what it does before and after the run, the structured pass it asks for, the files it reads back, what it hands off to, its pure logic, and that logic's tests. To read a task, read one folder.
2. **`src/` never imports from a task folder.** Only `tasks/index.ts` may, and it's the only thing `src/` imports from `tasks/`. If the engine needs something from a task, add it to the `Task` type in `src/task.ts` and have every task supply it. Don't branch on a task's name, and don't add a field to a shared type (`RunEnd`, `Outcome`, `Prepared`, `buildPrompt`'s inputs) that only one task fills.
3. **A task never imports another task's `index.ts`, or the registry.** A task may read what another task posted (implement reads explore's findings comment), and then it imports that task's pure module (`tasks/explore/findings.ts`), never its run code.
4. **Adding a task means adding a folder and a line in `tasks/index.ts`**, plus its Linear label and its section in `tasks/README.md`. If it needs an engine change too, make that a separate commit that adds a hook every task could use, and say so in the commit message.

`test/boundaries.test.ts` checks rules 2 and 3.

## Shared code

5. **Write a helper once.** Formatting (quoting a comment, dating it), comment markers and tags, and how a structured pass reports an error are in one module in `src/`. Before writing a small helper in a task, check `src/comments.ts`, `src/logic.ts` and `src/task.ts`.
6. **Keep logic pure, and keep I/O apart from it.** A module that decides something (parses, renders, picks the next label) does no I/O, says so in its header comment, and has tests next to it. A task's `index.ts` and the engine's functions do the I/O and call into that logic.
7. **One schema per structured output.** The zod schema is the one place its shape lives: the JSON Schema for `claude --json-schema` is generated from it, and the orchestrator validates against it again.
8. **Every file opens with a comment** saying what it's for and where its neighbours are, in the glossary's terms.

## Inngest replay

Inngest replays a run function from the top for every step, and feeds each finished step its memoized result. An in-flight run during a deploy replays the new code against the old history.

9. **Step ids, their order, and the shape of each step's return value are a contract with in-flight runs.** To change any of them, either deploy with no run in flight or give the changed step a new id. Adding a step before existing ones counts as a change.
10. **Read the wall clock and do I/O inside steps only.** Code between steps runs again on every replay.

## Factory comments

11. **Every comment the factory posts starts with `linearComment`'s marker.** A comment the factory reads back later carries a tag on its marker line (today only `explore findings`). Each tag is a constant in the module that posts it, and the module that reads it imports the constant. Tag only a comment that holds the real result: never a failure note, which would hide the last real result.

## Prompts

12. **Prompts call the agent's machine "the runner", never "the sandbox".** "Sandbox" is fine only in engine code about Daytona's object (`createSandbox`, `deleteSandbox`).

## Commits

13. **Check every claim a commit message makes.** "Moved unchanged", "in-flight runs replay" and "a new task is a folder" are checked against the diff before they're written, or left out.
