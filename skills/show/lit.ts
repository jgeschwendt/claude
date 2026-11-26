// Syntax highlighting, server only: shiki never reaches the client bundle. A plan's `code`, `compare` and `tabs`
// contexts, in the overview or a question's body, with a `lang` gain the highlighted markup of each sample (`html`),
// which the page renders as the server did, so a hydrate matches. The colours are CSS custom properties, set in
// style.css.
import { bundledLanguages, codeToHtml, createCssVariablesTheme } from 'shiki';
import { type Item, LANGUAGES, type Plan, type Question } from './catalog.tsx';
import { drew } from './machine.ts';

type Sample = { code: string; lang?: string | undefined };

const theme = createCssVariablesTheme();
for (const id of Object.keys(bundledLanguages)) {
  LANGUAGES.add(id);
}

/**
the samples each kind of context carries
*/
const SAMPLES: Record<string, (own: never) => Sample[]> = {
  code: ({ code, lang }: { code: string; lang?: string }) => [{ code, lang }],
  compare: ({ lang, pair }: { lang?: string; pair: string[] }) =>
    pair.map((code) => ({ code, lang })),
  tabs: ({ tabs }: { tabs: [string, string, string?][] }) =>
    tabs.map(([, code, lang]) => ({ code, lang })),
};

/**
`item` with the highlighted markup of its samples when one names a language, and its machine drawn
*/
const mark = async <T extends Item>([kind, own]: T): Promise<T> => {
  const samples = SAMPLES[kind]?.(own as never) ?? [];
  // a sample without a language stays plain: an empty string, so `html` lines up with the samples
  const html = samples.some((sample) => sample.lang)
    ? await Promise.all(
        samples.map(({ code, lang }) => (lang ? codeToHtml(code, { lang, theme }) : '')),
      )
    : undefined;
  return drew([kind, { ...own, ...(html && { html }) }] as unknown as T);
};

/**
`plan` with every sample of a named language highlighted and every machine drawn; what is saved stays the author's
own
*/
const lit = async ([title, overview, questions]: Plan): Promise<Plan> => [
  title,
  await Promise.all(overview.map((item) => mark(item))),
  Object.fromEntries(
    await Promise.all(
      Object.entries(questions).map(
        async ([id, [name, body]]) =>
          [id, [name, await Promise.all(body.map((item) => mark(item)))]] as [string, Question],
      ),
    ),
  ),
];

export { lit };
