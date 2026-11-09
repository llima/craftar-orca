# craftar for Orca

> **Approving this plugin grants it full Node on your machine**: it is a `trusted-worker` plugin, so its worker runs with your
> user account's access, plus the Orca capabilities it lists (`orca-ide plugin inspect` shows them). `drift promote`, `drift discard`, `git` and `gh` are
> gated only by that approval and a click each; a sync goes through craftar's own consent (`craftar mcp allow-writes`, typed by you in
> a terminal). The plugin sends nothing anywhere: no telemetry; the only network traffic is craftar's own fetch and the `git push` /
> `gh pr create` you click. For a remote Forge over ssh the worker gets no `SSH_AUTH_SOCK`: use https with a credential helper.

An [Orca](https://github.com/stablyai/orca) plugin that shows, for the workspace you have open, which craftar Forge it follows, the
surfaces craftar writes there and the files coming and going between them, using the `craftar` you installed. It adds nothing to craftar.

**Status: S3b, a PR in the Forge.** The plugin reads, and writes only on your clicks: **Update** (S2), one sync through `craftar mcp
--allow-writes` and then exactly the files it wrote staged, never a commit; **Send to Forge** (S3a), `craftar drift promote` into the
Forge's working tree, after its dry run, never a commit; **a PR in the Forge** (S3b), three clicks, each a command in a terminal
you see, never a commit by the plugin itself; and **Discard** of a hand edit (spec 60 §8a), after a confirmation with its diff, nothing staged.

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
  read gave an error, the sync is refused or a check fails; the registry's lines about other workspaces stay out of its panel). A cached
  copy does not open it: its card says so, and its *Try again* runs the periodic check now, the one read that fetches. Once you open or
  close the bell, a redraw keeps it so for the same messages, and a press anywhere outside it, or Esc, closes it. Each message is marked
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
  shown in words. Measured with bash; PowerShell 7 (`&&`, `$( )`) is reasoned, not run. The Orca workspace's name goes into the PR
  title (editable) and body (not editable): in a shared Forge, edit the title if that name should not appear.
- **Send all** (the footer, with two or more files craftar can carry up; each row still sends its own): one click runs the dry run of
  every file, one after another, and shows one plan: per file its outcome, the Forge files craftar would write and its warnings, or
  craftar's refusal of that dry run (the file then stays "kept here", as a single Send keeps it). Each plan is a dry run against the Forge
  as it is now. **Write all N**, a second click, runs `craftar drift promote` for real over exactly the planned files, in order, and stops
  at the first refusal: craftar's words are shown, with the files not written. A refusal over a Forge file the write before left
  uncommitted (craftar's git gate) clears once that is committed, so the PR comes next: *Prepare the PR* covers every file written (a
  branch `craftar-<profile>-<n>-changes` and a title for several), and after **1 Branch and commit**, **Send the rest (N)** plans and writes
  the files left; *Add N files to the PR* takes you back to the PR screen, which names the branch, the title and the next paths, and
  **Commit N paths on <branch>** is the next click there (`git switch <branch>`, never `-c`, with only the paths that batch wrote; the push
  waits for it). A title still the plugin's default follows the count. Then push and the PR carry everything. The PR body lists each send's outcome, ref and paths, one line, cut with "and N more" past 1,500
  characters. Bring needs nothing of this: it already brings every pending file in one click.
- **Discard** (spec 60 §8a) puts back what craftar writes for one file you edited by hand by mistake. It is on a `drift` row of "Edited
  here" and an `orphan-drift` row of "Kept apart", never on `.claude/settings.craftar.example.json` (a value may have been typed there) or a
  collision. `craftar drift discard` is a whole sync, so it is offered only when nothing else is pending (otherwise it reads *Update first*,
  pointing at Update and stage). The first click opens a confirmation that names the file and shows craftar's diff of what will be written
  (craftar's note where it withholds the content; a withheld file the Forge also changed is not offered, since no diff can show its new text),
  and says the edit is lost for good (for an `orphan-drift`, that the file is deleted). The second click reads `status` again with a fetch: a
  failed fetch or a pending file cancels, writing nothing, and a Forge that moved (its commit, the row, or the diff) draws the confirmation
  again on the new text. Then it runs `craftar drift discard <path> --workspace <dir> --offline` as a child with an argument array, against the
  copy just fetched, never `--overwrite-drift`, never through `craftar mcp` or a terminal; the periodic check holds that Forge's fetches
  meanwhile. A refusal is shown as craftar words it (its stderr and stdout); afterwards the panel reads the workspace again and lists what
  else moved and craftar's warnings. Nothing is staged or committed. With *Fetch a remote Forge* off, Discard stays off for a remote Forge.
- **On save** (Orca's `editor.save.before`) the plugin marks a file craftar lists as "edited, not yet in the Forge" and asks for a read
  a second later. It never refuses or delays the save beyond reading the event's path, and never keeps, logs or sends the text; the
  next `drift show` decides. Orca names the editor's workspace with an id `workspace.list` does not hold (measured in Orca 1.4.250),
  so the hook takes the focused workspace instead; each save writes one line to the plugin log, yes/no words only: whether the
  workspace was listed, the file inside it, focused and recorded in the lock, never the path or the text.
- **The periodic check notifies** once when the files coming from the Forge grow, for a workspace Update can run on: "Forge <name> changed N files for <workspace>:
  update N files and add them to the commit? Open the craftar panel." Names and counts only (an Orca notification takes no click).
  Each check writes one line to the plugin log, counts and fixed words only: the workspaces read, and when there are any, the reads
  that failed and the workspaces a running Discard held; how many have files to bring, and of those how many Update cannot run on (a
  failed fetch, fetch off, a refused sync, an older craftar) and how many were already notified at that count; then the
  notifications sent and how many Orca says it delivered ("no notification sent" otherwise). With no craftar found the line reads
  "periodic check: craftar not found, nothing read". A workspace pinned to a ref that does not move never has files to bring when the
  Forge merges a change: craftar reads the ref `craftar.yaml` names and does not look for a newer tag. The Forge card says so. Under a
  tag of the local clone of the Forge named for Send (`git show-ref --verify --quiet refs/tags/<ref>` in that clone, offline) a line
  reads "tag <ref> does not move: a change merged in the Forge comes here once a newer tag is set as ref in craftar.yaml"; under a ref
  that is a full commit id, "a commit does not move: a change merged in the Forge comes here once a newer ref is set in craftar.yaml".
  Without a named clone a tag is not told from a branch, and no line is shown.
  With craftar **1.9.0** or later, `status --json` names a newer `vX.Y.Z` tag on the Forge than a `vX.Y.Z` ref (`forge.newerTag`), and
  the card says it in place of that line: "newer tag on the Forge: <tag> (ref is <ref>). Set ref in craftar.yaml to move.", with ", as
  of the last fetch <time>" on a cached copy, and an **Open craftar.yaml** button that opens the file in an Orca editor tab (the plugin
  writes nothing; you edit the ref, and the save is read as any other). The periodic check notifies once per new tag per workspace:
  "Forge <name> has a newer tag <tag> for <workspace> (it follows <ref>): set ref in craftar.yaml to move. Open the craftar panel."
  (storage keeps the last tag notified per workspace path). With an older craftar the key is absent and nothing of this shows.
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

**From a release** (measured on 2026-11-08 with Orca 1.4.254 and v0.1.0; the Orca 1.4.250 before it had no `plugin install`):

```bash
orca-ide plugin install llima/craftar-orca@v0.1.0
```

Without `@<tag>` Orca takes the newest `vX.Y.Z` tag (else the default branch); it pins the install to that commit, and runs git with
the Orca host's own credentials and never prompts; a repository it cannot read fails with `git_auth_failed` (`orca-ide plugin install
--help`, Orca 1.4.254).

The first run (measured with `--json`) writes nothing and exits 3 with `approval_required`: Orca lists what it grants (a `trusted-worker` and the seven
capabilities below, each in its own words), what the plugin adds (the craftar panel, its two commands, the `workspace.changed` event,
the `editor.save.before` hook, the status bar item), `Source: github.com/llima/craftar-orca (v0.1.0) at commit 0a1c9a0b7a92`,
`Publisher: llima`, the warning that the plugin is not from Orca and Orca has not checked the repository, and a fingerprint. Read it,
then run it again with `--approve <fingerprint>`: Orca prints `Installed llima.craftar 0.1.0` and the plugin runs under the key
`llima.craftar` (`orca-ide plugin list`). A development load keeps its own key, `local.craftar`: in the measured run `plugin list` showed
it, disabled by hand for the test (`orca-ide plugin disable local.craftar`), beside the running `llima.craftar`; whether both run at once
was not measured. The releases are at `https://github.com/llima/craftar-orca/releases`. A release is the maintainer's: after `ci` passes on a push to
`main`, `.github/workflows/release.yml` runs; when the `version` in `orca-plugin.json` is not yet tagged, it tags `v<version>` and makes
its Release on the commit `ci` tested, only once the maintainer approves the run in the `orca-release` environment, which must exist,
with the maintainer as required reviewer and `main` only, before a version bump reaches `main`; the run refuses to release while
it is missing or requires no reviewer (GitHub would otherwise create it with no protection, which is how v0.2.1 was tagged with no approval). A version already tagged releases nothing,
and a run whose commit was passed by a newer push before `ci` finished refuses, leaving the release to the newer tip's run (once `ci` passes there).

**From a clone** (to try a commit that is not released): load a copy of a commit, not the clone itself.

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

## Windows (S4): coded, not run on Windows

- **craftar:** set *craftar binary* to your `craftar.cmd` (see Settings). A workspace or Forge path holding one of the characters listed
  there, or ending in a backslash (a drive root), cannot be passed to it; the consent terminal then shows its steps in words; move it, or install craftar where a `.exe` is on an absolute `PATH` entry.
- **Terminals:** when the shell probe finds PowerShell, the consent terminal and the Forge PR steps quote their values for it (version 7,
  for `&&`). A cmd terminal gets no command: the panel shows the steps in words.
- **Measured:** coded, not run on Windows: nothing in this plugin has run on Windows yet. The cmd quoting is reasoned from cmd's rules and tested on this
  build's tests only. Known: through cmd, a time limit or a stop ends cmd, not the craftar it started, so a craftar that hangs is not
  cut short and goes on until it ends.

## Settings

- **craftar binary** (`craftarPath`): the absolute path to `craftar`. Empty: the plugin looks for it on the absolute entries of `PATH`
  only, never through `npx`. Orca started from a dock or a menu often has a short `PATH`, so set it there. When the binary sits under a
  version manager's shim directory (asdf, volta, mise), a project's files can choose what runs; the self-check says so. On Windows,
  npm installs `craftar.cmd`, which the `PATH` lookup does not start by itself: set this to its absolute path (for one,
  `%APPDATA%\npm\craftar.cmd`, written out). The plugin then starts it through `cmd /d /s /c`, every value in double quotes; a value cmd
  would read inside quotes (`"`, `%`, `!`, `^`, `&`, `|`, `<`, `>`, a control character) or one ending in a backslash is refused in
  words, nothing started.
- **CRAFTAR_HOME** (`craftarHome`): passed to craftar, so it reads the registry and Forge cache your terminal uses.
- **Check the Forge every** (`intervalMinutes`, default 2, minimum 2) and **Fetch a remote Forge** (`fetch`, default on): the periodic check only.

## Development

```bash
orca-ide plugin test .        # node:test, with Orca's own orca/testing
orca-ide plugin validate .
orca-ide plugin check .
orca-ide plugin inspect .
```

The type check needs the two development dependencies in `package.json` (TypeScript and Node's typings, exact versions,
no scripts; Orca installs nothing from it) and Orca's typings, which `plugin types` writes into `.orca/types/`:

```bash
npm ci --ignore-scripts
orca-ide plugin types .
./node_modules/.bin/tsc -p .
```

CI (`.github/workflows/ci.yml`) runs `validate`, `check` and `test` on every push to any branch and every PR to `main`, on Linux with Node 22 and 24,
against an Orca release pinned by version and sha256 (its `.deb` extracted, never installed).

Examples, screenshots and fixtures use a synthetic `acme` workspace only.
The catalog images (`assets/cover.png`, `assets/screenshots/`) show the plugin's own panel, drawn by its renderer (`src/panel-view.ts`)
and stylesheet (`src/panel.ts`) on synthetic `acme` data, with Orca's dark theme values, in a browser outside Orca (the Orca this is
built in lists client workspaces, so no `plugin shot` is taken): a throwaway test calls `render` with `buildModel` over the fixtures in
`test-support/fixtures/` (an `acme-portal` workspace on `git.acme.example`) and writes each panel state's HTML with the panel's `STYLE`.
Around those panels, a hand-written page adds the rest, in the same headless pass (`google-chrome --headless --screenshot`): on the
cover, the icon, "craftar", one sentence, five pills, the two panels (the front one straight, the back one tilted 3 degrees, partly
behind it and cut by the image's bottom edge, no shadow) and a warm glow, on a dark background that runs edge to edge with no frame
of its own (Orca draws its own rounded frame around the cover), taken at device scale 2 (`--force-device-scale-factor=2`, so
3200x2000) so the tilted edges and the text stay sharp; on each screenshot (1280x800), a title and a sentence beside one panel. That
page's HTML is not kept in the repository. Redraw them when the panel changes.

## License

MIT, see `LICENSE`.
