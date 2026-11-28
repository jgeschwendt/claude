// Syntax highlighting, server only: shiki never reaches the client bundle. A plan's `code`, `compare` and `tabs`
// contexts, in the overview or a question's body, with a `lang` gain the highlighted markup of each sample (`html`),
// which the page renders as the server did, so a hydrate matches. The colours are CSS custom properties, set in
// style.css.
import { bundledLanguages, codeToHtml, createCssVariablesTheme } from 'shiki';
import { type Item, LANGUAGES, type Plan, type Question } from './catalog.tsx';
import { drew, graft } from './machine.ts';

type Sample = { code: string; lang?: string | undefined };

const theme = createCssVariablesTheme();
for (const id of Object.keys(bundledLanguages)) {
  LANGUAGES.add(id);
}

/**
the samples each kind of context carries
*/
const samplesOf = ([kind, own]: Item): Sample[] => {
  if (kind === 'code') {
    return [{ code: own.code, lang: own.lang }];
  }
  if (kind === 'compare') {
    return own.pair.map((code) => ({ code, lang: own.lang }));
  }
  return kind === 'tabs'
    ? own.tabs.map((tab) => {
        const [, code] = tab;
        return { code, lang: tab.at(2) };
      })
    : [];
};

/**
`item` with the highlighted markup of its samples when one names a language, and its machine drawn
*/
const mark = async <T extends Item>(item: T): Promise<T> => {
  const samples = samplesOf(item);
  // a sample without a language stays plain: an empty string, so `html` lines up with the samples
  const html = samples.some(({ lang }) => lang !== undefined)
    ? await Promise.all(
        samples.map(async ({ code, lang }) =>
          lang === undefined ? '' : codeToHtml(code, { lang, theme }),
        ),
      )
    : undefined;
  return drew(html === undefined ? item : graft(item, { html }));
};

/**
`plan` with every sample of a named language highlighted and every machine drawn; what is saved stays the author's
own
*/
const lit = async ([title, overview, questions]: Plan): Promise<Plan> => [
  title,
  await Promise.all(overview.map(async (item) => mark(item))),
  Object.fromEntries(
    await Promise.all(
      Object.entries(questions).map(async ([id, [name, body]]): Promise<[string, Question]> => [
        id,
        [name, await Promise.all(body.map(async (item) => mark(item)))],
      ]),
    ),
  ),
];

export { lit };
