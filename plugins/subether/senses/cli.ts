#!/usr/bin/env bun
// the survey against the manifest, `--write` to rewrite it: survey.ts
import { main } from './survey';

process.exitCode = await main(Bun.argv.slice(2));
