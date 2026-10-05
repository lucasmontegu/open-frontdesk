# Notes

- `policies` option receives the `ToolCallContext` (so the caller can resolve rules per org/bot version).
- The gateway enforces a built-in hard guard (rule id `builtin_do_not_call`) for `contact`-effect tools when the contact is `doNotCall`, before any CEL rule runs.
- CEL variables are untyped (dyn). `contact` is `null` when no contact is known, so pack rules guard with `contact != null && ...`; an unguarded access errors and refuses (fail closed).
- Cross-check that all `@ofd/packs` policies compile via `validateRule` must live in a package depending on both (evals/cli), see packages/packs/NEEDS.md.
