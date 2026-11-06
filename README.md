# craftar for Orca

> **Approving this plugin grants it full Node on your machine** — it is a `trusted-worker` plugin, so its worker runs with your
> user account's access — plus the Orca capabilities it lists (`orca plugin inspect` shows them). `drift promote`, `git` and `gh` are
> gated only by that approval and a click each; a sync goes through craftar's own consent (`craftar mcp allow-writes`, typed by you in
> a terminal). The plugin sends nothing anywhere: no telemetry; the only network traffic is craftar's own fetch and the `git push` /
> `gh pr create` you click. For a remote Forge over ssh the worker gets no `SSH_AUTH_SOCK`: use https with a credential helper.

An [Orca](https://github.com/stablyai/orca) plugin that shows, for the workspace you have open, which craftar Forge it follows, its
linked projects and the files coming and going between them — using the `craftar` you installed. It adds nothing to craftar.

**Status: S0, the scaffold.** Nothing is read from craftar yet. The status bar item keeps the plugin's worker running; the palette
command `craftar: run the probe` measures what the plugin needs from Orca on your machine: it runs `craftar --version`, says which
environment variables the worker has (present or absent, never a value), and opens a terminal named "craftar probe" running
`echo craftar-probe`, whose last lines — your prompt, so possibly your host name, user name and directory — it shows to you and never
logs or sends. The build runs in five slices.

## Settings

- **craftar binary** (`craftarPath`) — the absolute path to `craftar`. Empty: the plugin looks for it on the absolute entries of `PATH`
  only, never through `npx`. Orca started from a dock or a menu often has a short `PATH`, so set it there. When the binary sits under a
  version manager's shim directory (asdf, volta, mise), a project's files can choose what runs; the probe says so.
- **CRAFTAR_HOME** (`craftarHome`) — passed to craftar, so it reads the registry and Forge cache your terminal uses.
- **Check the Forge every** (`intervalMinutes`, default 15, minimum 5) and **Fetch a remote Forge** (`fetch`, default on) — used from S1.

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
