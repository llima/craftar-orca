# craftar for Orca

> **Approving this plugin grants it full Node on your machine** — it is a `trusted-worker` plugin, so its worker runs with your
> user account's access — plus the Orca capabilities it lists (`orca-ide plugin inspect` shows them). `drift promote`, `git` and `gh` are
> gated only by that approval and a click each; a sync goes through craftar's own consent (`craftar mcp allow-writes`, typed by you in
> a terminal). The plugin sends nothing anywhere: no telemetry; the only network traffic is craftar's own fetch and the `git push` /
> `gh pr create` you click. For a remote Forge over ssh the worker gets no `SSH_AUTH_SOCK`: use https with a credential helper.

An [Orca](https://github.com/stablyai/orca) plugin that shows, for the workspace you have open, which craftar Forge it follows, its
linked projects and the files coming and going between them — using the `craftar` you installed. It adds nothing to craftar.

**Status: S1, the read path.** The plugin reads only; it writes nothing. Only the probe (below) opens a terminal and shows a notification.

- **On enable** a self-check runs: the binary found and absolute, its version at least **0.33.0** (taken from `craftar doctor
  --json`, asked about the focused craftar workspace or, with none focused, another one on this machine — with none at all nothing
  is started), doctor's `error` lines for the focused workspace (listed, never fixed), and whether the registry is on. It runs again
  when `craftarPath` or `craftarHome` changes. When anything fails it is shown at the top of the panel and the status bar reads
  `craftar: error`.
- **The focused workspace** is the one Orca has active, asked of Orca's CLI (`orca-ide worktree ps --json`, run as a child from the
  `orca-ide` found on an absolute `PATH` entry; only paths are kept), when its folder on this machine holds `craftar.yaml` — an active
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
- **The panel** draws the Forge and the workspace with the files on each arrow, linked projects (the profile's repositories and the
  other registered workspaces of the same Forge), every warning craftar gives for this workspace in its words (the registry's lines
  about other workspaces stay out of its panel), a refused sync in craftar's words, and a failed check with craftar's lines.
  Clicking a file shows its diff from a `craftar mcp` child started without `--fetch` and never with `--allow-writes`. "Update" and
  "Send to Forge" are drawn disabled until the next slices.

**Clicking the craftar item in the status bar** shows or hides Orca's right side bar, where the craftar panel is (Orca 1.4.250 gives
a plugin no way to open its own panel; the palette command `craftar: show or hide the craftar panel` does the same).

The probe `craftar: run the probe` (S0) stays, in the palette (Orca's default Ctrl+Shift+J on Linux, typing `craftar`): it says which `craftar` it found and which environment variables the worker has (present or absent,
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

Not measured yet: that a click on the status bar item runs the probe in Orca, and whether the probe's terminal is a real terminal
and its lines can be read back — the next run of the probe, from the status bar, reports both.

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
