# craftar for Orca

> **Approving this plugin grants it full Node on your machine**: it is a `trusted-worker` plugin, so its worker runs with your
> user account's access, plus the Orca capabilities it lists (`orca-ide plugin inspect` shows them). `drift promote`, `git` and `gh` are
> gated only by that approval and a click each; a sync goes through craftar's own consent (`craftar mcp allow-writes`, typed by you in
> a terminal). The plugin sends nothing anywhere: no telemetry; the only network traffic is craftar's own fetch and the `git push` /
> `gh pr create` you click. For a remote Forge over ssh the worker gets no `SSH_AUTH_SOCK`: use https with a credential helper.

An [Orca](https://github.com/stablyai/orca) plugin that shows, for the workspace you have open, which craftar Forge it follows, the
surfaces craftar writes there and the files coming and going between them, using the `craftar` you installed. It adds nothing to craftar.

**Status: S3b, a PR in the Forge.** The plugin reads, and writes only on your clicks: **Update** (S2), one sync through `craftar mcp
--allow-writes` and then exactly the files it wrote staged, never a commit; **Send to Forge** (S3a), `craftar drift promote` into the
Forge's working tree, after its dry run, never a commit; and **a PR in the Forge** (S3b), three clicks, each a command in a terminal
you see, never a commit by the plugin itself.

- **On enable** a self-check runs: the binary found and absolute, its version at least **0.33.0** (taken from `craftar doctor
  --json`, asked about the focused craftar workspace or, with none focused, another one on this machine; with none at all nothing
  is started), doctor's `error` lines for the focused workspace (listed, never fixed), and whether the registry is on. It runs again
  when `craftarPath` or `craftarHome` changes. When anything fails it is shown at the top of the panel and the status bar reads
  `craftar: error`.
- **The focused workspace** is the one Orca has active, asked of Orca's CLI (`orca-ide worktree ps --json`, run as a child from the
  `orca-ide` found on an absolute `PATH` entry; only paths are kept, in memory, never logged or stored), when its folder on this machine holds `craftar.yaml`; an active
  workspace without one is no focus. When Orca's CLI cannot say, the workspace holding the open workspace's terminals
  (`orca-ide terminal list --json`) decides, and then the name and branch of the one you have open: when several match (every `main`
  worktree is named `main`), the panel asks which, and your answer is kept. A workspace on another host (SSH, WSL) is listed and
  never read.
- **Reads** are `craftar status`, `drift show`, `repos` and `workspaces`, each with `--json`. A focus change shows the new workspace
  at once from its last read, then reads it offline: `status` and `drift show` only, once an earlier read gave `repos` and the
  registry (`workspaces`, which plans every registered workspace); the registry's own lines about this workspace are then left out,
  since `status` and `drift show` just said them. A read that failed is asked again on the next focus. The self-check (`doctor`) runs
  again on each focus change and on Check again, after the read, so the switch never waits for it. The periodic check (every
  `intervalMinutes`) reads each craftar workspace on this machine in full, one after another, and is the only read that fetches a
  remote Forge, and only with `fetch` on.
- **The status bar** reads `craftar: in sync`, `Forge moved · N`, `edited · N` (or both), `craftar: sync refused` (a declared
  parameter with no value), `craftar: check failed` (`craftar status` exits 1 for another reason; its lines say which) or
  `craftar: error`.
- **The panel** (the layout approved on 2026-11-08) follows Orca's theme (it paints no background of its own and takes Orca's
  colours) and reads top to bottom: the sync diagram, as craftar.dev draws it: the Forge (where it is read from), `craftar sync`
  saying what comes down and what can go up, one card per surface craftar writes (each owner as craftar names it, its targets and
  services, with its state: up to date, outdated, drift or kept apart) and the workspace below with its profile; then the files coming
  from the Forge and the files edited here; and the actions in a fixed toolbar at the bottom, Bring (from the Forge) and Send (to the
  Forge). Every warning craftar gives for this workspace sits behind the bell beside Check again, in its words (opened at once when a
  read gave an error, the sync is refused, a check fails or the Forge could not be fetched; the registry's lines about other workspaces stay out of its panel). Each message is marked
  *error*, *to look at* or *info* (`--offline`'s note, or the age of a cached copy, which the plugin adds as its own line); where the plugin
  knows a fix it adds one under craftar's words, never in their place; for a target that skips an ingredient type it says what else the
  workspace writes for, never that another target writes the ingredient. The bell also holds a refused sync's lines, the self-check's
  failures and a failed update's words, so closing their cards drops nothing. The badge counts what is not information. *Clear* hides the messages until
  craftar says something different: only a digest of them is stored, per workspace, never their text. A refused sync and a failed check are
  shown in craftar's words. Every error card has a × that hides that card, with those words, until craftar says something else or the plugin
  restarts (kept in memory, never stored); closing it changes nothing craftar refused (a refused file stays "kept here", its words on its row and
  behind the bell). *Validate*, the shield beside the bell, runs the self-check again and the probe below on demand, with no notification (each click opens
  a new "craftar probe" terminal), and shows both in a card at the top of the panel. With no craftar workspace in focus the panel shows the logo, animated (still when the system asks for
  reduced motion). Clicking a file opens it in an editor tab of Orca (`editor.open`; a file the Forge brings that is not here yet shows its diff
  instead), and the small diff button on its row shows craftar's diff from a `craftar mcp` child started without `--fetch` and never with
  `--allow-writes`.
- **Send to Forge** (spec 60 §8) is offered for a file you edited by hand that craftar can carry up (`drift show --json`'s
  `promotable`); a file it will not carry shows craftar's reason. The first click runs `craftar drift promote <file> --workspace <dir>
  --dry-run --json` and shows its plan as text: the outcome, the Forge files it would write, the values it would set, the other
  workspaces that will see it, craftar's warnings; **Write to the Forge**, a second click, runs it for real. craftar proves the change,
  writes the Forge's working tree behind git's gate and never commits; a refusal is shown in its words: after a refused dry run the panel returns to the workspace and the file stays "kept here", with craftar's words and no Send, until you save it again or click Check again (a different craftar version clears it too). A Forge given as a git URL
  needs a local clone of it: the panel asks for its folder once per workspace, in its footer toolbar above the Send button, and keeps only that path (`--forge <dir>`); a Forge on
  this machine needs nothing. One notification per file you newly edit by hand that craftar can carry: "<file> belongs to Forge <x>:
  send the change to the Forge? Open the craftar panel."
- **A PR in the Forge** (S3b), after *Write to the Forge*: *Prepare the PR* opens a terminal "craftar forge PR: prepare" that runs
  `git var GIT_AUTHOR_IDENT` and reads the Forge's branch (it writes nothing), and the preview shows that identity (the one git uses
  in this workspace's terminals), the branch to create (built from `[a-z0-9-]`, editable), the commit subject and PR title (one line,
  editable), exactly the paths craftar wrote, and the PR body the plugin writes from craftar's result (refs and paths only). Then three
  clicks, each a new terminal with one command reaching the Forge with `git -C <its folder>`, every value quoted for the shell the probe
  found: **1 Branch and commit** (`git switch -c <branch>`, `git add -- <paths>`, `git commit -m <title> -- <paths>`, so nothing else
  staged goes in), **2 Push** (`git push -u origin <branch>`), **3 Open the PR** (`gh pr create`). Each command ends by printing a marker:
  the plugin reads the terminal's last lines until it sees it (up to 5 minutes, since a push can wait on a credential prompt you answer
  there; then *Check the terminal*), and keeps only the identity, the branch and the PR URL, attached to this Orca workspace with
  `orca-ide reference add`. A failed step can be tried again; *Back* keeps the steps waiting on the workspace (*Continue*, *Drop the steps
  left*; what is already done in the Forge stays). With cmd or a shell the probe does not recognise, no terminal is opened and the steps are
  shown in words. PowerShell needs version 7 for `&&`.
- **On save** (Orca's `editor.save.before`) the plugin marks a file craftar lists as "edited, not yet in the Forge" and asks for a read
  a second later. It never refuses or delays the save beyond reading the event's path, and never keeps, logs or sends the text; the
  next `drift show` decides. Orca names the editor's workspace with an id `workspace.list` does not hold (measured in Orca 1.4.250),
  so the hook takes the focused workspace instead; each save writes one line to the plugin log, yes/no words only: whether the
  workspace was listed, the file inside it, focused and recorded in the lock, never the path or the text.
- **The periodic check notifies** once when the files coming from the Forge grow, for a workspace Update can run on: "Forge <name> changed N files for <workspace>:
  update N files and add them to the commit? Open the craftar panel." Names and counts only (an Orca notification takes no click).
- **Bring** (the toolbar's *Bring N from the Forge*, the update) is offered when files are pending, craftar neither refuses the sync nor fails its check, craftar is **0.35.0** or later,
  and, for a remote Forge, the last periodic check fetched it (a focus read is offline and changes nothing here; with **Fetch a
  remote Forge** off, Update stays off for a remote Forge); otherwise it says why. Its confirm lists every file
  ("Update N files and add them to your commit?"), and **Update and stage** sends exactly that list. Then, in the workspace's queue:
  - one `sync` through a fresh `craftar mcp --workspace <dir> --allow-writes --fetch`, stopped after it; never `craftar sync`, never
    `--overwrite-drift`: every file you edited by hand (drift, orphan-drift, collision) is kept and listed;
  - `git add -- <paths>` of the files it wrote, the removed files git tracks and `craftar.lock`, less what git ignores; never `-A`,
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

**Clicking the craftar item in the status bar** shows or hides Orca's right side bar, where the craftar panel is. It cannot also
select the craftar tab: Orca 1.4.250 gives a plugin no way to open or select its own panel (a status bar item runs a command, and
`commands.run` only toggles the side bars), so it stays this way until Orca offers that action. The palette command `craftar: show
or hide the craftar panel` does the same.

The probe runs from *Validate* in the panel, or from `craftar: run the probe` (S0) in the palette (Orca's default Ctrl+Shift+J on Linux, typing `craftar`), and opens its
terminal in the workspace Orca has active (asked of `orca-ide worktree ps --json`, as the focus is): it says which `craftar` it found and which environment variables the worker has (present or absent,
never a value), and opens a terminal named "craftar probe" running `echo craftar-probe`. Its report appears in the **craftar panel**,
the terminal's last lines included (your prompt, so possibly your host name, user name and directory, shown there only). From the palette, a
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

## Install

**You need** Orca **1.4.248** or later and your own `craftar`, installed apart (`npm install -g craftar`): **0.33.0** or later for the
panel to read, **0.35.0** or later for **Update** (*Bring N from the Forge*; it uses the writing tools of `craftar mcp`). The plugin never installs or updates
craftar, and never starts it through `npx`.

**From a release (not measured yet).** Orca installs a plugin from its repository's `v<version>` tags, under the key
`<owner>.<id>`, here `llima.craftar`, from `https://github.com/llima/craftar-orca` (Orca's plugin documentation, spec 60 §2.1). No tag
has been published yet, so the exact steps in Orca have not been run; this section will name them once they have. Until then, use a
clone (below). Tagging is the maintainer's; the tags will be listed at `https://github.com/llima/craftar-orca/tags`.

**From a clone** (what the maintainer does today): load a copy of a commit, not the clone itself.

```bash
git clone https://github.com/llima/craftar-orca.git
mkdir craftar-orca-build && git -C craftar-orca archive HEAD | tar -x -C craftar-orca-build
orca-ide plugin dev load ./craftar-orca-build
```

A development folder runs later edits to its code without asking again (Orca 1.4.250, `orca-ide plugin dev load --help`): a `git pull`
in a loaded clone would run new code you never approved. Load each update from a new folder the same way, and unload the old one
(`orca-ide plugin dev unload local.craftar`).

**What you approve.** Orca loads nothing that runs code until you approve it: the first load fails with `approval_required`, listing
what it grants and a fingerprint; read it, then load again with `--approve <fingerprint>` (or approve it on Orca's plugin page). You
grant a `trusted-worker` (its worker runs with your user account's access; see the box at the top) and exactly these capabilities:
`workspace:read`, `workspace:write`, `terminal:send`, `terminal:read`, `notifications:show`, `storage:own`, `settings:own`
(`orca-ide plugin inspect <dir>` shows them). New access asks again; for a development folder, a code edit does not (above).

**After it loads**, set *craftar binary* in the plugin's settings when Orca was started from a dock or a menu (a short `PATH`), and
open the right side bar and select the craftar tab (the status bar item *craftar* shows or hides the side bar).

## Settings

- **craftar binary** (`craftarPath`): the absolute path to `craftar`. Empty: the plugin looks for it on the absolute entries of `PATH`
  only, never through `npx`. Orca started from a dock or a menu often has a short `PATH`, so set it there. When the binary sits under a
  version manager's shim directory (asdf, volta, mise), a project's files can choose what runs; the self-check says so.
- **CRAFTAR_HOME** (`craftarHome`): passed to craftar, so it reads the registry and Forge cache your terminal uses.
- **Check the Forge every** (`intervalMinutes`, default 2, minimum 2) and **Fetch a remote Forge** (`fetch`, default on): the periodic check only.

## Development

```bash
orca-ide plugin test .        # node:test, with Orca's own orca/testing
orca-ide plugin validate .
orca-ide plugin check .
orca-ide plugin inspect .
```

Examples, screenshots and fixtures use a synthetic `acme` workspace only.

## License

MIT, see `LICENSE`.
