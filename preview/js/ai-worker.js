import { search } from './ai.js';

self.onmessage = e => {
  const { id, board, side, opts } = e.data;
  const res = search(new Int8Array(board), side, opts);
  self.postMessage({ id, ...res });
};
