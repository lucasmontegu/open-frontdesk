# @ofd/dashboard

Operator dashboard: Vite + React + TanStack Router/Query, styled with
[shadcn/ui](https://ui.shadcn.com) and [AI Elements](https://elements.ai-sdk.dev).

## UI kit

- `src/components/ui/` holds shadcn/ui components (new-york style, Tailwind v4, `radix-ui`).
- `src/components/ai-elements/` holds AI Elements: the mission composer (`prompt-input`,
  `suggestion`), mission plans (`plan`, `queue`, `shimmer`) and conversation replays
  (`conversation`, `message`, `tool`).
- Both are vendored source, as shadcn intends: edit them freely. Local changes are marked
  with a comment (the tool card renders JSON in a `<pre>` instead of shiki, and message
  markdown skips the mermaid/math/cjk plugins to keep the bundle small).
- Add more with the CLI, which reads `components.json`:

  ```sh
  pnpm dlx shadcn@latest add dialog
  pnpm dlx shadcn@latest add @ai-elements/reasoning
  ```

- Theme tokens live in `src/index.css` (`--brand`, `--canvas`, `--hero`, success/warning
  tones, plus the standard shadcn ones). Light, dark and system themes are switchable from
  the account menu.

## i18n and routes

Routes and file names are English (`/bots`, `/missions`, `/contacts`, `/sign-in`...).
UI strings live in `src/i18n/` with `es-AR` as the default and `en-US` as the second
locale; `en-US.ts` is typed against `es-AR.ts`, so a missing key fails the build. The
locale comes from the account menu, then the browser language.
