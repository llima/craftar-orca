# craftar for Orca

> **Approving this plugin grants it full Node on your machine** — it is a `trusted-worker` plugin, so its worker runs with your
> user account's access — plus the Orca capabilities it lists (`orca-ide plugin inspect` shows them). `drift promote`, `git` and `gh` are
> gated only by that approval and a click each; a sync goes through craftar's own consent (`craftar mcp allow-writes`, typed by you in
> a terminal). The plugin sends nothing anywhere: no telemetry; the only network traffic is craftar's own fetch and the `git push` /
> `gh pr create` you click. For a remote Forge over ssh the worker gets no `SSH_AUTH_SOCK`: use https with a credential helper.

An [Orca](https://github.com/stablyai/orca) plugin that shows, for the workspace you have open, which craftar Forge it follows, its
linked projects and the files coming and going between them — using the `craftar` you installed. It adds nothing to craftar.

**Status: S2, the incoming path.** The plugin reads, and writes only when you click **Update** in its panel and confirm: one sync through
`craftar mcp --allow-writes`, then exactly the files it wrote staged — never a commit.

- **On enable** a self-check runs: the binary found and absolute, its version at least **0.33.0** (taken from `craftar doctor
  --json`, asked about the focused craftar workspace or, with none focused, another one on this machine — with none at all nothing
  is started), doctor's `error` lines for the focused workspace (listed, never fixed), and whether the registry is on. It runs again
  when `craftarPath` or `craftarHome` changes. When anything fails it is shown at the top of the panel and the status bar reads
  `craftar: error`.
- **The focused workspace** is the one Orca has active, asked of Orca's CLI (`orca-ide worktree ps --json`, run as a child from the
  `orca-ide` found on an absolute `PATH` entry; only paths are kept, in memory — never logged or stored), when its folder on this machine holds `craftar.yaml` — an active
  workspace without one is no focus. When Orca's CLI cannot say, the workspace holding the open workspace's terminals
  (`orca-ide terminal list --json`) decides, and then the name and branch of the one you have open: when several match (every `main`
  worktree is named `main`), the panel asks which, and your answer is kept. A workspace on another host (SSH, WSL) is listed and
  never read.
- **Reads** are `craftar status`, `drift show`, `repos` and `workspaces`, each with `--json`. A focus change reads offline; the
  periodic check (every `intervalMinutes`) reads each craftar workspace on this machine, one after another, and is the only read that
  fetches a remote Forge — and only with `fetch` on.
- **The status bar** reads `craftar: in sync`, `Forge moved · N`, `edited · N` (or both), `craftar: sync refused` (a declared
  parameter with no value), `craftar: check failed` (`craftar status` exits 1 for another reason — its lines say which) or
  `craftar: error`.
- **The panel** draws the Forge above the workspace, joined by two lanes — down (amber) lit when files are coming from the Forge,
  up (blue) lit when an edited file can go up — with a moving comet on a lit lane (none when the system asks for reduced motion);
  each owner craftar counts (its targets, and services), as craftar names it, with its file count; the files coming down and edited here; linked projects
  (the profile's repositories and the other registered workspaces of the same Forge); every warning craftar gives for this
  workspace in its words, under "craftar says" (open when the sync is refused, a check fails, the Forge could not be fetched or a read gave an error; the
  registry's lines about other workspaces stay out of its panel); a refused sync in craftar's words; and a failed check with
  craftar's lines. Clicking a file shows its diff from a `craftar mcp` child started without `--fetch` and never with
  `--allow-writes`. "Send to Forge" is drawn disabled, with a note, until a later slice.
- **The periodic check notifies** once when the files coming from the Forge grow, for a workspace Update can run on — "Forge <name> changed N files for <workspace> —
  update N files and add them to the commit? Open the craftar panel." — names and counts only (an Orca notification takes no click).
- **Update** is offered when files are pending, craftar neither refuses the sync nor fails its check, craftar is **0.35.0** or later,
  and — for a remote Forge — the last periodic check fetched it (a focus read is offline and changes nothing here; with **Fetch a
  remote Forge** off, Update stays off for a remote Forge); otherwise it says why. Its confirm lists every file —
  "Update N files and add them to your commit?" — and **Update and stage** sends exactly that list. Then, in the workspace's queue:
  - one `sync` through a fresh `craftar mcp --workspace <dir> --allow-writes --fetch`, stopped after it — never `craftar sync`, never
    `--overwrite-drift`: every file you edited by hand (drift, orphan-drift, collision) is kept and listed;
  - `git add -- <paths>` of the files it wrote, the removed files git tracks and `craftar.lock`, less what git ignores — never `-A`,
    never a commit, every path a literal name; then Orca's source-control view is toggled (Orca 1.4.250 has no action that only
    shows it, so an open view closes);
  - what it did is compared with the list you agreed to, and every difference is listed; a file that changed while craftar was writing
    asks you to update again. craftar's warnings are listed in its words.
- **The consent stays craftar's.** With none recorded (or one for an older Forge, ref or profile), Update writes nothing and the panel
  shows craftar's words and offers **Open a terminal to allow writes**: a terminal in the workspace running your craftar's
  `mcp allow-writes --workspace <dir>`, quoted for the shell a one-line probe found (`echo craftar-shell:$0`: bash, zsh, sh or
  PowerShell), where you answer its question yourself. Orca opens a plugin's terminal in the background, so the plugin brings it
  forward with Orca's CLI (`orca-ide terminal switch`, run as a child); a second click brings the same terminal forward again (a new
  one when it is gone), and when Orca's CLI cannot, the panel says the terminal is in the background. The plugin never types into a terminal; with cmd or a shell the probe does not
  recognise, it opens none and lists the steps in words.

**Clicking the craftar item in the status bar** shows or hides Orca's right side bar, where the craftar panel is (Orca 1.4.250 gives
a plugin no way to open its own panel; the palette command `craftar: show or hide the craftar panel` does the same).

The probe `craftar: run the probe` (S0) stays, in the palette (Orca's default Ctrl+Shift+J on Linux, typing `craftar`), and opens its
terminal in the workspace Orca has active (asked of `orca-ide worktree ps --json`, as the focus is): it says which `craftar` it found and which environment variables the worker has (present or absent,
never a value), and opens a terminal named "craftar probe" running `echo craftar-probe`. Its report appears in the **craftar panel**,
the terminal's last lines included — your prompt, so possibly your host name, user name and directory, shown there only. A
notification gives the outcome (craftar found and its version, the terminal's result) and points at the panel; the plugin's log gets
the same outcome lines, never craftar's path or a line of the terminal.

### Measured by the S0 probe

Measured in Orca 1.4.250 on Linux on 2026-11-06/07 (spec 60 §12):

- the worker starts `craftar` from inside Orca, found on an absolute `PATH` entry (every read depends on it);
- the status bar item keeps the worker alive: 938 heartbeats in 938 minutes, none missed (the periodic check depends on it);
- Orca's CLI is `orca-ide`; an `orca` on `PATH` can be another program (on GNOME, the screen reader), so the probe looks for
  `orca-ide` (a later slice depends on it).

Measured on 2026-11-07 too: the probe's terminal opens, backed by a pty, in the workspace in focus, and `terminal.read` gives its
lines back. Not measured yet: that Orca's CLI answers from inside the worker (the probe's `active workspace` line says so), and that
a click on the status bar item shows or hides the side bar.

## Settings

- **craftar binary** (`craftarPath`) — the absolute path to `craftar`. Empty: the plugin looks for it on the absolute entries of `PATH`
  only, never through `npx`. Orca started from a dock or a menu often has a short `PATH`, so set it there. When the binary sits under a
  version manager's shim directory (asdf, volta, mise), a project's files can choose what runs; the self-check says so.
- **CRAFTAR_HOME** (`craftarHome`) — passed to craftar, so it reads the registry and Forge cache your terminal uses.
- **Check the Forge every** (`intervalMinutes`, default 5, minimum 5) and **Fetch a remote Forge** (`fetch`, default on) — the periodic check only.

## Development

```bash
orca-ide plugin test .        # node:test, with Orca's own orca/testing
orca-ide plugin validate .
orca-ide plugin check .
orca-ide plugin inspect .
```

Examples, screenshots and fixtures use a synthetic `acme` workspace only.

## License

MIT — see `LICENSE`.
