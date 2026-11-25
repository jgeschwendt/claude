// Syntax highlighting, server only: shiki never reaches the client bundle. A form's `code` and `teach` entries
// with a `lang` gain the highlighted markup of each sample (`html`), which the page renders as the server did,
// so a hydrate matches. The colours are CSS custom properties, set in style.css.
import { bundledLanguages, codeToHtml, createCssVariablesTheme } from 'shiki';
import { type Block, type Card, type Form, LANGUAGES } from './catalog.tsx';

const theme = createCssVariablesTheme();
for (const id of Object.keys(bundledLanguages)) {
  LANGUAGES.add(id);
}

/**
`entry` with the highlighted markup of its samples when it names a language
*/
const mark = async <T extends Block | Card>(entry: T): Promise<T> => {
  const { code, lang, pair } = entry as { code?: string; lang?: string; pair?: string[] };
  return lang
    ? {
        ...entry,
        html: await Promise.all(
          [code ?? pair].flat().map((sample) => codeToHtml(String(sample), { lang, theme })),
        ),
      }
    : entry;
};

/**
`form` with every sample of a named language highlighted; what is saved stays the author's own
*/
const lit = async (form: Form): Promise<Form> => ({
  ...form,
  cards: await Promise.all(form.cards.map((card) => mark(card))),
  ...(form.overview && { overview: await Promise.all(form.overview.map((block) => mark(block))) }),
});

export { lit };
