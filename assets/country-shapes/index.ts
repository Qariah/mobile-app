// Country silhouette shape registry.
// Sprint 17 S17.9 — initial set sourced from mapsicon (djaiss/mapsicon).
// Sprint 21 S21.U3 — closed catalog coverage gap by adding PS + XJ from
// Wikipedia Commons (CC BY-SA). PS = mapsicon omits Palestine, user picked
// British-Mandate boundary. XJ = synthetic code (not real ISO) for the
// catalog's "East Turkistan" entry, using the Xinjiang region of China.

import {AU} from './AU';
import {CA} from './CA';
import {CM} from './CM';
import {DZ} from './DZ';
import {EG} from './EG';
import {ES} from './ES';
import {FI} from './FI';
import {GM} from './GM';
import {GN} from './GN';
import {ID} from './ID';
import {JO} from './JO';
import {KE} from './KE';
import {MA} from './MA';
import {MR} from './MR';
import {MY} from './MY';
import {NG} from './NG';
import {PH} from './PH';
import {PK} from './PK';
import {PS} from './PS';
import {RU} from './RU';
import {SG} from './SG';
import {SO} from './SO';
import {TN} from './TN';
import {TZ} from './TZ';
import {US} from './US';
import {XJ} from './XJ';
import {YE} from './YE';

export interface CountryShapeData {
  readonly viewBox: string;
  readonly transform: string | null;
  readonly paths: readonly string[];
}

const SHAPES: Record<string, CountryShapeData> = {
  AU,
  CA,
  CM,
  DZ,
  EG,
  ES,
  FI,
  GM,
  GN,
  ID,
  JO,
  KE,
  MA,
  MR,
  MY,
  NG,
  PH,
  PK,
  PS,
  RU,
  SG,
  SO,
  TN,
  TZ,
  US,
  XJ,
  YE,
};

export function getCountryShape(code: string): CountryShapeData | undefined {
  return SHAPES[code.toUpperCase()];
}

export const SUPPORTED_COUNTRY_SHAPES: readonly string[] = Object.freeze([
  'AU',
  'CA',
  'CM',
  'DZ',
  'EG',
  'ES',
  'FI',
  'GM',
  'GN',
  'ID',
  'JO',
  'KE',
  'MA',
  'MR',
  'MY',
  'NG',
  'PH',
  'PK',
  'PS',
  'RU',
  'SG',
  'SO',
  'TN',
  'TZ',
  'US',
  'XJ',
  'YE',
]);
