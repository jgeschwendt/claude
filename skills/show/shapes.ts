// What the daemon, its CLI and its page each read of the others' data, checked at the boundary. Each object holds
// the fields its readers use and tolerates the rest, as hud's threads carry a pin's x and y.
import { enums, int, list, literal, optional, record, string, tuple, union } from 'verax';
import { loose } from '#loose';

const words = optional(string());
const lines = list(string());
const notes = record(record(string()));
const answer = loose('answer', {
  at: string(),
  message: words,
  notes: optional(notes),
  picks: optional(record(lines)),
  question: string(),
});
const comment = loose('comment', {
  at: string(),
  question: words,
  text: string(),
  thread: string(),
});
const resolve = loose('resolve', { at: string(), question: string() });
/**
an event of his: an answer is his picks, option comments and message; the kind comes first
*/
const entryShape = union('entry', [
  tuple([literal('answer'), answer]),
  tuple([literal('comment'), comment]),
  tuple([literal('resolve'), resolve]),
]);
/**
a plan's counts of questions by turn, as `show list` and the index page read them
*/
const summaryShape = loose('summary', {
  session: string(),
  slug: string(),
  title: string(),
  url: string(),
  waiting: int(),
  working: int(),
  yours: int(),
});
const message = loose('message', {
  at: string(),
  author: enums(['agent', 'user']),
  text: string(),
});
const threadShape = loose('thread', {
  id: string(),
  messages: list(message),
  page: string(),
  selector: string(),
  status: enums(['open', 'resolved']),
});
/**
a plan's status; `working` is absent from one saved before it existed
*/
const statusShape = loose('status', {
  at: words,
  lines,
  opened: string(),
  resolved: lines,
  session: string(),
  working: optional(lines),
});

export { entryShape, statusShape, summaryShape, threadShape };
