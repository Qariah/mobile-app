// Reads the accessibility label of a recitation card, after a `copyTextFrom` on
// the card (`id: recitation-card`, components/cards/RecitationCard.tsx). The
// label has one of two English forms (`qariah:a11y.playRecitation` and
// `qariah:a11y.playRecitationRange` in i18n/locales/en/qariah.json):
//
//   "Play <surah> by <reciter>"
//   "Play <surah>, <range>, by <reciter>"    (a partial recitation)
//
// It writes `output.card`:
//   ok       true when the label has one of the two forms
//   surah    the surah name, regex-escaped (Maestro text is a full-match regex)
//   reciter  the reciter name, regex-escaped (some names have parentheses)
//   range    the range text, for example "ayahs 1–69", regex-escaped; '' when complete
//
// English only: the flows run on a fresh install with the device language English.
function escapeRegex(text) {
  return text.replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');
}

var label = String(maestro.copiedText || '');
var match = label.match(/^Play (.+?)(?:, (.+?),)? by (.+)$/);
var range = match && match[2] ? match[2] : '';

output.card = {
  ok: match !== null,
  label: label,
  surah: match ? escapeRegex(match[1]) : '',
  reciter: match ? escapeRegex(match[3]) : '',
  range: escapeRegex(range),
};
console.log('recitation card: ' + JSON.stringify(output.card));
