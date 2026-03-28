# Discord / Slack Community Post

I built an open source tool called `filedist` for a problem I kept seeing in AI coding workflows: teams need to reuse prompts, agent instructions, eval datasets, docs, and config files across many repos, but the usual options are copy-paste, submodules, or custom scripts.

`filedist` lets you publish folders from npm packages or plain git repos and extract them into any workspace.

Example:

```sh
npx filedist extract --packages https://github.com/flaviostutz/xdrs-core@1.3.0 --output ./xdrs
```

Repo:
https://github.com/flaviostutz/filedist

If your team shares prompt packs or agent kits this way, I would like to hear what is missing.