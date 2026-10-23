// Tests of the test iPhone driver (TECH_DEBT #299): the Maestro selector rules on a
// WebDriverAgent screen tree, and the flow parser. No device is necessary.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  flatten,
  screenOf,
  findAll,
  findOne,
  isOnScreen,
  resolvePoint,
  fullMatch,
} from '../iphone/lib/hierarchy.mjs';
import {parseFlow, commandOf} from '../iphone/lib/flow-runner.mjs';
import {flowsForCase} from '../iphone/run.mjs';

const rect = (x, y, width, height) => ({x, y, width, height});

// A small tree in the WebDriverAgent JSON form.
const tree = {
  type: 'XCUIElementTypeApplication',
  label: 'Qariah',
  rect: rect(0, 0, 393, 852),
  isAccessible: '0',
  children: [
    {
      type: 'XCUIElementTypeWindow',
      rect: rect(0, 0, 393, 852),
      children: [
        {
          type: 'XCUIElementTypeLink',
          label: 'Reciters',
          rect: rect(30, 150, 100, 90),
          isAccessible: '1',
        },
        {
          type: 'XCUIElementTypeLink',
          label: 'Surahs',
          rect: rect(145, 150, 100, 90),
          isAccessible: '1',
        },
        {
          type: 'XCUIElementTypeButton',
          rawIdentifier: 'recitation-card',
          label: 'Play At-Takwir by Ramla Hasan',
          rect: rect(300, 560, 120, 200),
          isAccessible: '1',
        },
        {
          type: 'XCUIElementTypeButton',
          rawIdentifier: 'recitation-card',
          label: "Play 'Abasa by Ramla Hasan",
          rect: rect(160, 560, 120, 200),
          isAccessible: '1',
        },
        {
          type: 'XCUIElementTypeOther',
          label: 'Listen tab',
          rect: rect(0, 760, 120, 60),
          children: [
            {
              type: 'XCUIElementTypeStaticText',
              label: ', Listen',
              rect: rect(20, 770, 80, 30),
            },
          ],
        },
        {
          type: 'XCUIElementTypeSwitch',
          label: 'Friday Al-Kahf reminder',
          value: '1',
          rect: rect(10, 400, 370, 44),
        },
        {
          type: 'XCUIElementTypeSwitch',
          label: 'New features',
          value: '0',
          isEnabled: '0',
          rect: rect(10, 450, 370, 44),
        },
        {
          type: 'XCUIElementTypeButton',
          label: 'Below the fold',
          rect: rect(10, 1200, 100, 44),
        },
        {
          type: 'XCUIElementTypeButton',
          label: 'Hidden',
          isVisible: '0',
          rect: rect(10, 300, 100, 44),
        },
      ],
    },
  ],
};

const nodes = flatten(tree);
const screen = screenOf(nodes);

test('flatten keeps every element and reads the fields', () => {
  assert.equal(nodes.length, 12);
  assert.deepEqual(screen, rect(0, 0, 393, 852));
  const card = nodes.find(n => n.id === 'recitation-card');
  assert.equal(card.type, 'XCUIElementTypeButton');
  assert.equal(card.accessible, true);
});

test('text is a full-match, case-insensitive regular expression (as in Maestro)', () => {
  assert.equal(findOne(nodes, 'reciters')?.label, 'Reciters');
  assert.equal(
    findOne(nodes, 'Recit'),
    null,
    'a part of the text does not match',
  );
  assert.equal(findOne(nodes, 'Recit.*')?.label, 'Reciters');
  assert.equal(findOne(nodes, {text: '.*Listen'})?.label, ', Listen');
});

test('id matches the identifier, and index picks in screen order', () => {
  const cards = findAll(nodes, {id: 'recitation-card'});
  assert.equal(cards.length, 2);
  assert.match(cards[0].label, /Abasa/, 'the left card is first');
  assert.match(
    findOne(nodes, {id: 'recitation-card', index: 1}).label,
    /Takwir/,
  );
  assert.equal(
    findOne(nodes, {id: 'recitation'}),
    null,
    'id is a full match too',
  );
});

test('only elements on screen match', () => {
  assert.equal(findOne(nodes, 'Below the fold'), null);
  assert.equal(findOne(nodes, 'Hidden'), null);
  assert.equal(
    isOnScreen(
      nodes.find(n => n.label === 'Reciters'),
      screen,
    ),
    true,
  );
});

test('a text match keeps the innermost element', () => {
  const hits = findAll(nodes, '.*Listen.*');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].type, 'XCUIElementTypeStaticText');
});

test('enabled and checked filter the matches', () => {
  assert.equal(
    findOne(nodes, {text: 'Friday Al-Kahf reminder', checked: true})?.value,
    '1',
  );
  assert.equal(
    findOne(nodes, {text: 'Friday Al-Kahf reminder', checked: false}),
    null,
  );
  assert.equal(findOne(nodes, {text: 'New features', enabled: true}), null);
  assert.equal(
    findOne(nodes, {text: 'New features', enabled: false})?.label,
    'New features',
  );
});

test('a point resolves from percent or from points', () => {
  assert.deepEqual(resolvePoint('50%,32%', screen), {x: 196.5, y: 272.64});
  assert.deepEqual(resolvePoint('120, 300', screen), {x: 120, y: 300});
  assert.throws(() => resolvePoint('50%', screen));
});

test('fullMatch anchors an alternation as a whole', () => {
  const re = fullMatch('Skip|Skip( sign-in)? for now');
  assert.equal(re.test('Skip'), true);
  assert.equal(re.test('Skip sign-in for now'), true);
  assert.equal(re.test('Skip all'), false);
});

test('parseFlow reads the config and the commands', () => {
  const flow = parseFlow(
    'appId: com.qariah.app\ntags:\n  - smoke\n---\n- launchApp:\n    clearState: true\n- hideKeyboard\n- tapOn: "Reciters"\n',
  );
  assert.equal(flow.config.appId, 'com.qariah.app');
  assert.equal(flow.commands.length, 3);
  assert.deepEqual(commandOf(flow.commands[0]), [
    'launchApp',
    {clearState: true},
  ]);
  assert.deepEqual(commandOf(flow.commands[1]), ['hideKeyboard', null]);
  assert.deepEqual(commandOf(flow.commands[2]), ['tapOn', 'Reciters']);
});

test('flowsForCase reads the Maestro column of the case catalog', () => {
  const catalog = [
    '| QP-01 → UPG-01, UPG-06 | Install. | Listen shows. | P0 | both | `smoke/00-launch.yaml` | Stage 1 |',
    '| QP-09 → MSH-01 | Mushaf. | Text. | P0 | both | `smoke/03-mushaf-open.yaml`, `regression/mushaf/mushaf-open-reader.yaml` | Stage 1 |',
    '| QP-06 → BGA-01 | Lock. | Audio. | P0 | owner | — | Stage 1 |',
  ].join('\n');
  assert.match(
    flowsForCase('QP-01', catalog)[0],
    /\.maestro\/flows\/smoke\/00-launch\.yaml$/,
  );
  assert.equal(flowsForCase('QP-09', catalog).length, 2);
  assert.throws(() => flowsForCase('QP-06', catalog), /no Maestro flow/);
  assert.throws(
    () => flowsForCase('QP-99', catalog),
    /not in the case catalog/,
  );
});

test('splitTemplate keeps braces inside an expression', async () => {
  const {splitTemplate} = await import('../iphone/lib/flow-runner.mjs');
  assert.deepEqual(splitTemplate('${output.x = {ok: true}}'), [
    {expr: 'output.x = {ok: true}'},
  ]);
  assert.deepEqual(splitTemplate('a ${b} c'), [
    {text: 'a '},
    {expr: 'b'},
    {text: ' c'},
  ]);
  assert.deepEqual(splitTemplate('no template'), [{text: 'no template'}]);
});
