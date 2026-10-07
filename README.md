# Claude Code Mods: Run Your Workday

### Three Claude Code mods by [@tenfoldmarc](https://www.instagram.com/tenfoldmarc)

Claude Code now has mods. Small add-ons that change how Claude itself looks and behaves. These three turn it from an assistant into something closer to a manager that works for you.

| Mod | What it does |
| --- | --- |
| **Daily Command Center** | Every morning from 9am, Claude asks for the three tasks you need to do today and stays locked until you type them. Then it pins them in a side pane next to your revenue and key numbers. |
| **Focus Lock** | Pick one task, start a timed sprint, and Claude holds any prompt that is not about that task until the timer ends. |
| **Done Chime** | Plays a sound and shows a toast when Claude finishes a long job, so you can walk away instead of watching the screen. |

## Install

**Step 1.** Update Claude Code. Mods need a recent version. These were built and tested on 2.1.289. Older versions reject them.

**Step 2.** Open Claude Code and paste this:

```
Install these mods for me: https://github.com/tenfoldmarc/claude-code-mods
```

**Step 3.** Start a new session. That's it.

<details>
<summary>Prefer to do it yourself in a terminal?</summary>

```bash
claude plugin marketplace add tenfoldmarc/claude-code-mods
```

```bash
claude plugin install daily-command-center@tenfold-mods
```

```bash
claude plugin install focus-lock@tenfold-mods
```

```bash
claude plugin install done-chime@tenfold-mods
```

Install only the ones you want. Then start a new session, or run `/reload-plugins` in an open one.

</details>

## How to use them

### Daily Command Center

- From 9am, a band above the prompt asks for your three tasks. Type one per message, or all three at once on separate lines.
- A long message or a question is not treated as a task. It goes to Claude as usual, with a reminder that your tasks are still due.
- Once all three are in, the **Today** pane opens with your tasks and numbers. Press `1`, `2` or `3` in the pane to check one off.

| Command | What it does |
| --- | --- |
| `/today` | Open the Today pane |
| `/today done 2` | Check off task 2 |
| `/today reset` | Clear today's tasks and get asked again |
| `/today skip` | No tasks today |
| `/today refresh` | Refresh the numbers now |
| `/metric Followers 12,400` | Pin any number to the pane |
| `/metric Followers` | Remove that number |

**Your numbers.** Three ways to get them in, all optional:

1. **Pin by hand** with `/metric`. Zero setup.
2. **Stripe revenue.** Run `/plugin configure daily-command-center@tenfold-mods` and paste a Stripe key. It shows revenue today and month to date. Use a **restricted, read-only key** with read access to Balance only, never your full secret key. Create one in Stripe under Developers, API keys, Create restricted key. Claude Code keeps it in your system's secure storage.
3. **Your own script.** Set the "Metrics command" option to any command that prints one `Label: value` line per number. Email subscribers, followers, anything you can fetch.

### Focus Lock

| Command | What it does |
| --- | --- |
| `/sprint 50 write the sales page` | Start a 50 minute sprint on that task |
| `/sprint write the sales page` | Same, with your default length |
| `/sprint` | See the time left |
| `/sprint stop` | End the sprint early |

- A countdown sits in the status line while the sprint runs.
- A small, fast model checks each prompt against your task. Follow-ups, corrections and anything unclear count as on task. Only a clear switch to different work gets held.
- Start a prompt with `!!` to push it through anyway.
- When the timer ends, a sound plays and the held prompts show up above the prompt with **Send** and **Drop** buttons.

### Done Chime

Nothing to do. Any job that runs 20 seconds or longer ends with a chime and a toast showing how long it took. Errors get a different sound.

## Settings

Run `/plugin configure <mod>@tenfold-mods` to change these.

| Mod | Setting | Default |
| --- | --- | --- |
| Daily Command Center | Start hour | 9 |
| Daily Command Center | Stripe key | none |
| Daily Command Center | Metrics command | none |
| Daily Command Center | Refresh minutes | 5 |
| Focus Lock | Sprint length (minutes) | 50 |
| Focus Lock | Judge model | haiku |
| Done Chime | Minimum seconds | 20 |
| All three | Volume (0 to 4) | 1 |

## Good to know

- **Sounds play on Mac only.** On Windows and Linux everything else works and the toasts still show.
- **Mods are early access in Claude Code.** A Claude Code update can change how they behave. If one breaks, update the mods (below) or remove it with `claude plugin uninstall <mod>@tenfold-mods`.
- **Focus Lock makes one small model call per prompt** during a sprint. If that call fails, the prompt goes through. It never blocks you because of an outage.
- **Nothing leaves your machine** except the calls you turn on: Stripe (if you add a key) and whatever your own metrics command does.
- The mods only act on prompts you type. Scheduled tasks, background agents and `claude -p` scripts are never held or captured.

## Update

Paste this into Claude Code:

```
Update the mods from https://github.com/tenfoldmarc/claude-code-mods
```

Or in a terminal:

```bash
claude plugin marketplace update tenfold-mods
```

```bash
claude plugin update daily-command-center@tenfold-mods
```

Repeat the second command for `focus-lock` and `done-chime`.

## Instructions for Claude

If a user asks you to install these mods, do this:

1. Run `claude --version`. If it is older than 2.1.289, tell the user to update Claude Code first and stop. If `claude` is not on the PATH, give the user the terminal commands from the Install section to run themselves.
2. Run `claude plugin marketplace add tenfoldmarc/claude-code-mods`.
3. Run `claude plugin install` for each of `daily-command-center@tenfold-mods`, `focus-lock@tenfold-mods` and `done-chime@tenfold-mods`, unless the user asked for only some of them.
4. Tell the user to start a new session (or run `/reload-plugins`), and that after 9am the Daily Command Center will ask for their three tasks.
5. Do not ask the user to paste a Stripe key into the chat. If they want revenue in the pane, point them to `/plugin configure daily-command-center@tenfold-mods` and a restricted, read-only key.

To update: `claude plugin marketplace update tenfold-mods`, then `claude plugin update <mod>@tenfold-mods` for each installed mod.

## License

MIT. The sounds are original and included under the same license.

---

Built by [@tenfoldmarc](https://www.instagram.com/tenfoldmarc). Follow for daily AI builds. Real systems, not theory.
