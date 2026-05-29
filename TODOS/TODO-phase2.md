## Phase 2
- [x] Context pipeline
- [ ] System prompt + ai agent sdk/llm wrapper setup (anthropic for now)
    - [x] build system prompt
    - [x] add anthropic API key
    - [x] Test to make sure it works
- [ ] Tool schema registration
- [ ] The state machine / agent loop / self healing loop
    - [ ] Autosave project before agent run (easy revert point)
    - [ ] Wrap entire agent's single msgs' calls into a single undo group (instead of per-command)

- [ ] **Eg. Preset Library?? <-- might be done in phase 2 system prompt (give the system prompt a good understanding)