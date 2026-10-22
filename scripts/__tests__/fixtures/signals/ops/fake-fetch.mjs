// @ai
// Test preload (node --import <this file>): replaces globalThis.fetch with
// canned answers, so a script runs end to end with no network.
//   SIGNALS_FAKE_FETCH      a JSON file: [{match, status?, body}]; the first
//                           route whose `match` is a substring of the URL answers
//   SIGNALS_FAKE_FETCH_LOG  a file; each request is appended as "<METHOD> <url>"
// A URL with no route gets HTTP 599, so a test sees any unexpected request.
/* global globalThis, Response */
import {appendFileSync, readFileSync} from 'node:fs';

const routes = JSON.parse(readFileSync(process.env.SIGNALS_FAKE_FETCH, 'utf8'));

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (process.env.SIGNALS_FAKE_FETCH_LOG)
    appendFileSync(
      process.env.SIGNALS_FAKE_FETCH_LOG,
      `${init.method || 'GET'} ${u}\n`,
    );
  const r = routes.find(x => u.includes(x.match));
  const body = r ? r.body : {error: {message: `no fake route for ${u}`}};
  return new Response(JSON.stringify(body), {
    status: r ? r.status || 200 : 599,
    headers: {'Content-Type': 'application/json'},
  });
};
