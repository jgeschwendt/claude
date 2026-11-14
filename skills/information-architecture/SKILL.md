---
name: information-architecture
description: Load before deciding how anything is grouped, named or laid out for others to find things in — a directory or repo layout, a database or content schema, API resource shapes, docs or knowledge-base structure, navigation and menus, a taxonomy or tag set, an agent's memory or skill layout — and whenever a structure "feels wrong" or a thing needs a name. A playbook of structures with a problem → structure guide. Not for visual layout or CSS.
---

# Information architecture

$ARGUMENTS

`references/playbook.md` is the corpus: 18 sections, about 600 lines. Do not read it whole. Start at its decision guide, then read only the sections that guide names:

```sh
rg -n '^## §17' "${CLAUDE_SKILL_DIR}/references/playbook.md"   # problem → structure; Read from that line
rg -n '^## §' "${CLAUDE_SKILL_DIR}/references/playbook.md"     # every section, to jump by number
```

Name the structure you chose and the section it came from when you propose a layout, so the choice can be argued with.

These hold even when the playbook stays closed:

- One organizing principle per level. A list that mixes "by topic" with "by audience" is the commonest defect; a hybrid is fine only when its layers are visibly separate.
- Agree what the terms mean before arranging them.
- Take labels from the words users type, not from internal vocabulary.
- When the model is still uncertain, prefer metadata and facets over a tree: a hierarchy is the expensive commitment.
- Partition by lifecycle first: immutable from derived, config from cache from state.
- A layout that people, links and tooling have built on is costly to reverse. Decide a migration before starting it, and treat a new structure as a hypothesis until someone other than its author has found things in it.
- At project scale people navigate rather than search, so the tree is the interface; at catalog scale (thousands of items) metadata and search take over.
