// @ai-generated
// Qariah (Sprint 50, TECH_DEBT #261): expo-router calls `redirectSystemPath`
// for each link from the system. It closes an open sheet before the link
// navigates (services/closeSheetsBeforeLink.ts). Upstream has no
// +native-intent file. If upstream adds one, merge the two.
export {redirectSystemPath} from '@/services/closeSheetsBeforeLink';
