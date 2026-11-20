---
paths:
  - '**/*.{yaml,yml}'
---

# YAML

- **YAML files end in `.yaml`, never `.yml`**—workflows, actions, dotfile configs alike; rename on touch.
- **A string naming ANOTHER repo's file keeps that repo's spelling.** mise's packslip `workflow = "release.yml"` for jdx/hk is a signing identity, and `.yaml` there makes hk refuse to install. (since 2026-10-27)
