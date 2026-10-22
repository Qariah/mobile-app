// @ai
//
// scripts/signals/sections/index.mjs
// ----------------------------------
// Every section of the signals snapshot, in file order. The order is the order
// of the keys in the file. A section that names `after` runs once those
// sections are done (snapshot.mjs). The interface is in
// planning/signals-phase1-design.md, "The section interface".

import * as card from './card.mjs';
import * as active from './active.mjs';
import * as use from './use.mjs';
import * as weekly from './weekly.mjs';
import * as retention from './retention.mjs';
import * as funnel from './funnel.mjs';
import * as content from './content.mjs';
import * as restore from './restore.mjs';
import * as engagement from './engagement.mjs';
import * as health from './health.mjs';
import * as failures from './failures.mjs';
import * as stores from './stores.mjs';
import * as v1Backend from './v1-backend.mjs';
import * as platforms from './platforms.mjs';
import * as focus from './focus.mjs';
import * as listens from './listens.mjs';

export const SECTIONS = [
  card,
  active,
  use,
  weekly,
  retention,
  funnel,
  content,
  restore,
  engagement,
  health,
  failures,
  stores,
  v1Backend,
  platforms,
  focus,
  listens,
];
