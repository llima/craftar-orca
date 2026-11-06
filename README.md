# craftar for Orca

> **Approving this plugin grants it full Node on your machine** — it is a `trusted-worker` plugin, so its worker runs with your
> user account's access — plus the Orca capabilities it lists (`orca plugin inspect` shows them). `drift promote`, `git` and `gh` are
> gated only by that approval and a click each; a sync goes through craftar's own consent (`craftar mcp allow-writes`, typed by you in
> a terminal). The plugin sends nothing anywhere: no telemetry; the only network traffic is craftar's own fetch and the `git push` /
> `gh pr create` you click. For a remote Forge over ssh the worker gets no `SSH_AUTH_SOCK`: use https with a credential helper.

An [Orca](https://github.com/stablyai/orca) plugin that shows, for the workspace you have open, which craftar Forge it follows, its
linked projects and the files coming and going between them — using the `craftar` you installed. It adds nothing to craftar.

**Status: S1, the read path.** The plugin reads only; it writes nothing, opens no terminal and shows no notification yet.

- **On enable** a self-check runs: the binary found and absolute, its version at least **0.33.0** (taken from `craftar doctor
  --json`, asked about the focused craftar workspace or, with none focused, another one on this machine — with none at all nothing
  is started), doctor's `error` lines for the focused workspace (listed, never fixed), and whether the registry is on. It runs again
  when `craftarPath` or `craftarHome` changes. When anything fails it is shown at the top of the panel and the status bar reads
  `craftar: error`.
- **The focused workspace** is the Orca workspace on this machine whose folder holds `craftar.yaml` and whose name and branch match
  the one you have open. When two match, the panel asks which; your answer is kept. A workspace on another host (SSH, WSL) is listed
  and never read.
- **Reads** are `craftar status`, `drift show`, `repos` and `workspaces`, each with `--json`. A focus change reads offline; the
  periodic check (every `intervalMinutes`) reads each craftar workspace on this machine, one after another, and is the only read that
  fetches a remote Forge — and only with `fetch` on.
- **The status bar** reads `craftar: in sync`, `Forge moved · N`, `edited · N` (or both), `craftar: sync refused` (a declared
  parameter with no value), `craftar: check failed` (`craftar status` exits 1 for another reason — its lines say which) or
  `craftar: error`.
- **The panel** draws the Forge and the workspace with the files on each arrow, linked projects (the profile's repositories and the
  other registered workspaces of the same Forge), every warning craftar gives in its words, a refused sync in craftar's words, and a
  failed check with craftar's lines.
  Clicking a file shows its diff from a `craftar mcp` child started without `--fetch` and never with `--allow-writes`. "Update" and
  "Send to Forge" are drawn disabled until the next slices.

The palette command `craftar: run the probe` (S0) stays: it says which `craftar` it found and which environment variables the worker
has (present or absent, never a value), and opens a terminal named "craftar probe" running `echo craftar-probe`, whose last lines —
your prompt, so possibly your host name, user name and directory — it shows to you and never logs or sends.

### Pending the S0 probe

Three things the plugin relies on were not yet measured in a real Orca when S1 was written (spec 60 §12); until the probe reports
them, S1 is **coded, not run in Orca**:

- that the worker can start `craftar` from inside Orca (every read depends on it);
- that the status bar item keeps the worker alive for hours (the periodic check depends on it);
- that `orca` is on the worker's `PATH` (a later slice depends on it).

## Settings

- **craftar binary** (`craftarPath`) — the absolute path to `craftar`. Empty: the plugin looks for it on the absolute entries of `PATH`
  only, never through `npx`. Orca started from a dock or a menu often has a short `PATH`, so set it there. When the binary sits under a
  version manager's shim directory (asdf, volta, mise), a project's files can choose what runs; the self-check says so.
- **CRAFTAR_HOME** (`craftarHome`) — passed to craftar, so it reads the registry and Forge cache your terminal uses.
- **Check the Forge every** (`intervalMinutes`, default 15, minimum 5) and **Fetch a remote Forge** (`fetch`, default on) — the periodic check only.

## Development

```bash
orca plugin test .        # node:test, with Orca's own orca/testing
orca plugin validate .
orca plugin check .
orca plugin inspect .
```

Examples, screenshots and fixtures use a synthetic `acme` workspace only.

## License

MIT — see `LICENSE`.
