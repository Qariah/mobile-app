// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16): the notification card after the first
// completed play: its conditions, "Allow" and "Not now" (iOS), "Choose
// notifications" and "OK" (Android).
import {
  IOS_PERMISSION_REQUEST,
  SOFT_PROMPT_SHOW_CONFIRM_MS,
  __resetSoftPromptForTests,
  answerSoftPrompt,
  confirmSoftPromptShown,
  maybeShowSoftPrompt,
  shouldShowSoftPrompt,
  startSoftPrompt,
  useSoftPromptStore,
  type SoftPromptDeps,
} from '../softPrompt';
import type {NotificationPermissionSnapshot} from '../permissionAction';

jest.mock('@sentry/react-native', () => ({
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
}));

const UNDETERMINED: NotificationPermissionSnapshot = {
  status: 'undetermined',
  granted: false,
  canAskAgain: true,
  ios: {status: 0},
};
const GRANTED: NotificationPermissionSnapshot = {
  status: 'granted',
  granted: true,
  canAskAgain: true,
  ios: {status: 2},
};
const DENIED: NotificationPermissionSnapshot = {
  status: 'denied',
  granted: false,
  canAskAgain: false,
  ios: {status: 1},
};

describe('shouldShowSoftPrompt', () => {
  const base = {
    platform: 'ios',
    holdout: false,
    softPromptAnswered: false,
    permission: UNDETERMINED,
  };

  it('shows on iOS for a notify user who was never asked and never answered', () => {
    expect(shouldShowSoftPrompt(base)).toBe(true);
  });

  it.each([
    ['on another platform', {platform: 'web'}],
    ['in the holdout', {holdout: true}],
    ['after an answer', {softPromptAnswered: true}],
    ['when the toggles cannot be read', {softPromptAnswered: null}],
    ['when the permission is granted', {permission: GRANTED}],
    ['when the permission is denied', {permission: DENIED}],
    ['when the permission cannot be read', {permission: null}],
  ])('does not show %s', (_label, override) => {
    expect(shouldShowSoftPrompt({...base, ...override})).toBe(false);
  });

  describe('Android (the first launch asked; the card only lists the types)', () => {
    const android = {...base, platform: 'android', permission: GRANTED};

    it('shows when the notifications are on', () => {
      expect(shouldShowSoftPrompt(android)).toBe(true);
    });

    it.each([
      ['when the notifications are off', {permission: DENIED}],
      [
        'before the first-launch dialog was answered',
        {permission: UNDETERMINED},
      ],
      ['in the holdout', {holdout: true}],
      ['after an answer', {softPromptAnswered: true}],
      ['when the permission cannot be read', {permission: null}],
    ])('does not show %s', (_label, override) => {
      expect(shouldShowSoftPrompt({...android, ...override})).toBe(false);
    });
  });
});

describe('the card flow', () => {
  let completed: (() => void) | null;
  let activeListener: (() => void) | null;

  function start(overrides: Partial<SoftPromptDeps> = {}) {
    const deps = {
      platform: () => 'ios',
      isHoldout: () => false,
      readAnswered: jest.fn(async () => false as boolean | null),
      getPermission: jest.fn(async () => UNDETERMINED),
      requestPermission: jest.fn(async () => GRANTED),
      setAnswered: jest.fn(),
      onGranted: jest.fn(async () => undefined),
      isAppActive: () => true,
      onAppActive: (listener: () => void) => {
        activeListener = listener;
        return () => {
          activeListener = null;
        };
      },
      subscribeCompleted: (listener: () => void) => {
        completed = listener;
        return () => {
          completed = null;
        };
      },
      isOtherSheetOpen: () => false,
      onPrompted: jest.fn(),
      onResult: jest.fn(),
      ...overrides,
    };
    startSoftPrompt(deps);
    return deps;
  }

  async function complete(): Promise<void> {
    completed?.();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }

  beforeEach(() => {
    __resetSoftPromptForTests();
    completed = null;
    activeListener = null;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('a completed play shows the card once; the prompted event goes out at onShow', async () => {
    const deps = start();
    expect(useSoftPromptStore.getState().visible).toBe(false);
    await complete();
    expect(useSoftPromptStore.getState().visible).toBe(true);
    // Not before the Modal is on screen (review L3).
    expect(deps.onPrompted).not.toHaveBeenCalled();
    confirmSoftPromptShown();
    expect(deps.onPrompted).toHaveBeenCalledTimes(1);
    confirmSoftPromptShown();
    expect(deps.onPrompted).toHaveBeenCalledTimes(1);
    useSoftPromptStore.setState({visible: false});
    await complete();
    expect(useSoftPromptStore.getState().visible).toBe(false);
    expect(deps.onPrompted).toHaveBeenCalledTimes(1);
  });

  it('L3: a card that iOS does not present (another Modal, an Alert) waits for the next play', async () => {
    jest.useFakeTimers();
    const deps = start();
    await complete();
    expect(useSoftPromptStore.getState().visible).toBe(true);
    // No onShow within the time limit.
    jest.advanceTimersByTime(SOFT_PROMPT_SHOW_CONFIRM_MS);
    expect(useSoftPromptStore.getState().visible).toBe(false);
    expect(deps.onPrompted).not.toHaveBeenCalled();
    // The next completed play tries again.
    await complete();
    expect(useSoftPromptStore.getState().visible).toBe(true);
    confirmSoftPromptShown();
    expect(deps.onPrompted).toHaveBeenCalledTimes(1);
  });

  it('L3: no card while an action sheet is open; the next play tries again', async () => {
    let sheetOpen = true;
    const deps = start({isOtherSheetOpen: () => sheetOpen});
    await complete();
    expect(useSoftPromptStore.getState().visible).toBe(false);
    sheetOpen = false;
    await complete();
    expect(useSoftPromptStore.getState().visible).toBe(true);
    expect(deps.readAnswered).toHaveBeenCalledTimes(2);
  });

  it('a sheet that opens while the card waits for the active app: the next play', async () => {
    let sheetOpen = false;
    start({isAppActive: () => false, isOtherSheetOpen: () => sheetOpen});
    await complete();
    sheetOpen = true;
    activeListener?.();
    expect(useSoftPromptStore.getState().visible).toBe(false);
    sheetOpen = false;
    await complete();
    activeListener?.();
    expect(useSoftPromptStore.getState().visible).toBe(true);
  });

  it('a completion in the background shows the card when the app is active again', async () => {
    start({isAppActive: () => false});
    await complete();
    expect(useSoftPromptStore.getState().visible).toBe(false);
    activeListener?.();
    expect(useSoftPromptStore.getState().visible).toBe(true);
  });

  it('"Allow": the system dialog with no badge; a grant syncs; the answer is kept', async () => {
    const deps = start();
    await complete();
    await expect(answerSoftPrompt('allow')).resolves.toEqual(GRANTED);
    expect(useSoftPromptStore.getState().visible).toBe(false);
    expect(deps.setAnswered).toHaveBeenCalled();
    expect(deps.requestPermission).toHaveBeenCalled();
    expect(deps.onGranted).toHaveBeenCalled();
    expect(deps.onResult).toHaveBeenCalledWith('allow', GRANTED);
    expect(IOS_PERMISSION_REQUEST).toEqual({
      ios: {allowAlert: true, allowSound: true, allowBadge: false},
    });
  });

  it('"Allow" then a refusal: no sync', async () => {
    const deps = start({requestPermission: jest.fn(async () => DENIED)});
    await complete();
    await answerSoftPrompt('allow');
    expect(deps.onGranted).not.toHaveBeenCalled();
    expect(deps.onResult).toHaveBeenCalledWith('allow', DENIED);
  });

  it('"Not now": no system dialog; the answer is kept', async () => {
    const deps = start();
    await complete();
    await answerSoftPrompt('not_now');
    expect(deps.requestPermission).not.toHaveBeenCalled();
    expect(deps.setAnswered).toHaveBeenCalled();
    expect(deps.onResult).toHaveBeenCalledWith('not_now', null);
  });

  it('an answered card, the holdout or an asked permission: nothing shows', async () => {
    for (const override of [
      {readAnswered: jest.fn(async () => true as boolean | null)},
      {readAnswered: jest.fn(async () => null as boolean | null)},
      {isHoldout: () => true},
      {getPermission: jest.fn(async () => GRANTED)},
    ]) {
      __resetSoftPromptForTests();
      const deps = start(override);
      await complete();
      expect(useSoftPromptStore.getState().visible).toBe(false);
      expect(deps.onPrompted).not.toHaveBeenCalled();
    }
  });

  it('stops checking after the system dialog was answered', async () => {
    const getPermission = jest.fn(async () => DENIED);
    start({getPermission});
    await complete();
    await complete();
    expect(getPermission).toHaveBeenCalledTimes(1);
  });

  it('does nothing on another platform', async () => {
    const subscribeCompleted = jest.fn(() => () => undefined);
    start({platform: () => 'web', subscribeCompleted});
    expect(subscribeCompleted).not.toHaveBeenCalled();
    await expect(maybeShowSoftPrompt()).resolves.toBe(false);
  });

  it('Android: a completed play shows the card when the notifications are on; "Choose notifications" asks for nothing', async () => {
    const deps = start({
      platform: () => 'android',
      getPermission: jest.fn(async () => GRANTED),
    });
    await complete();
    expect(useSoftPromptStore.getState().visible).toBe(true);
    confirmSoftPromptShown();
    expect(deps.onPrompted).toHaveBeenCalledTimes(1);
    await expect(answerSoftPrompt('choose')).resolves.toEqual(GRANTED);
    expect(useSoftPromptStore.getState().visible).toBe(false);
    expect(deps.requestPermission).not.toHaveBeenCalled();
    expect(deps.onGranted).not.toHaveBeenCalled();
    expect(deps.setAnswered).toHaveBeenCalled();
    expect(deps.onResult).toHaveBeenCalledWith('choose', GRANTED);
    // Answered: never again in this process.
    await complete();
    expect(useSoftPromptStore.getState().visible).toBe(false);
  });

  it('Android: "OK" closes the card and keeps the answer', async () => {
    const deps = start({
      platform: () => 'android',
      getPermission: jest.fn(async () => GRANTED),
    });
    await complete();
    await answerSoftPrompt('ok');
    expect(deps.requestPermission).not.toHaveBeenCalled();
    expect(deps.setAnswered).toHaveBeenCalled();
    expect(deps.onResult).toHaveBeenCalledWith('ok', GRANTED);
  });

  it('Android: notifications off, no card; a later play checks again (the user can turn them on)', async () => {
    let permission = DENIED;
    const getPermission = jest.fn(async () => permission);
    start({platform: () => 'android', getPermission});
    await complete();
    expect(useSoftPromptStore.getState().visible).toBe(false);
    permission = GRANTED;
    await complete();
    expect(getPermission).toHaveBeenCalledTimes(2);
    expect(useSoftPromptStore.getState().visible).toBe(true);
  });
});
