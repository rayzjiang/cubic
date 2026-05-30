## Phase 2
- [x] Context pipeline (live state)
- [x] System prompt + ai agent sdk/llm wrapper setup (anthropic for now)
    - [x] build system prompt
    - [x] add anthropic API key
    - [x] Test to make sure it works
    - [ ] verify that the messages sent by the ai agent are somewhat along the lines of what claude code probably does (answer question/summary ish, makes changes + narration, concise summary of what was done + ends with next steps/short question or something)
- [ ] Tool schema registration
- [ ] The state machine / agent loop / self healing loop
    - [ ] make sure the ai agent is set up to narrate what its doing as it works (like claude code); doesn't just edit your project without saying anything and spits out stuff at the end
    - [ ] Autosave project before agent run (easy revert point)
    - [ ] Wrap entire agent's single msgs' calls into a single undo group (instead of per-command)

#### Caching?? - for system ae live state
- rn getProjectInfo, listCompositions cached; active/highlighted stuff is never cached
- The one staleness gap: if the user manually (outside the agent) resizes a comp or creates a new
  one, the cached dimension table is stale until the next mutation turn invalidates it. Rare, and
  self-heals on any agent mutation. If you ever want it tighter, we could add a short TTL — but
  that's a separate concern from this feature, and I'd leave it as-is.

- [ ] **Eg. Preset Library?? <-- might be done in phase 2 system prompt (give the system prompt a good understanding)