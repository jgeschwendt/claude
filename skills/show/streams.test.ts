// No browser streams: Chromium shares six per host:port across every tab, so the page's bundle and sources open no
// EventSource and read no fetch body as a stream; live changes ride WebSockets.
import { expect, test } from 'bun:test';

const DIR = import.meta.dir;
const STREAMS = /new EventSource\b|\.body\.getReader\(|for await \([^)]*\.body\b|\.body\.pipeTo\(/u;

test('the page opens no browser stream', async () => {
  const { outputs } = await Bun.build({ entrypoints: [`${DIR}/client.tsx`], target: 'browser' });
  const texts = await Promise.all(
    [
      ...outputs,
      ...['catalog.tsx', 'client.tsx', 'page.tsx'].map((name) => Bun.file(`${DIR}/${name}`)),
    ].map((file) => file.text()),
  );
  expect(texts.filter((text) => STREAMS.test(text))).toEqual([]);
  expect(
    ['new EventSource("/x")', 'response.body.getReader()'].filter((text) => STREAMS.test(text)),
  ).toHaveLength(2);
});
