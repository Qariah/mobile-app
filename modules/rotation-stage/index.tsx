// @ai — rotation-stage public API.
//
// iOS: a native container that covers its content during a rotation with a
// snapshot of the old frame, moves the snapshot with the UIKit rotation morph,
// and lifts the cover when JS reports that the new layout is ready (see
// ios/RotationStageModule.swift). Android and web: a plain View; the Android
// window manager runs its own rotation animation from a screenshot.
import React, {forwardRef, useImperativeHandle, useRef} from 'react';
import {Platform, View, type ColorValue, type ViewProps} from 'react-native';
import {requireNativeView, requireOptionalNativeModule} from 'expo';

/**
 * Where the page text sits in the old layout (`from*`) and in the new layout
 * (`to*`), in the coordinates of the stage. The stage animates the snapshot
 * of the old frame so that `from` lands on `to`, and its content from `from`
 * to its own place, so that both match when the cover lifts.
 */
export type RotationStageMapping = {
  /** Increases with each turn, so that the native view never applies an old mapping. */
  token: number;
  /** The orientation that the turn goes to. */
  orientation: 'portrait' | 'landscape';
  fromX: number;
  fromY: number;
  fromWidth: number;
  toX: number;
  toY: number;
  toWidth: number;
};

export type RotationStageProps = ViewProps & {
  mapping?: RotationStageMapping | null;
  /** The colour behind the old frame while it moves. */
  backdropColor?: ColorValue;
  /**
   * The `testID` of the view that the content shows, painted (the reader's
   * page). When a turn leaves portrait and that view is at rest and opaque
   * inside the stage, the stage keeps a snapshot of the portrait content. A
   * turn back to portrait with the same `testID` shows it under the turn's
   * snapshot until the new layout is ready, unless `pageDrew` came first.
   * Null: no snapshot is kept.
   */
  pictureTestID?: string | null;
};

export type RotationStageReady = {
  /** The view that must sit inside the stage first (the page to show). */
  testID: string | null;
  /**
   * Keep the cover until the UIKit animation ends: the new layout shows only
   * part of what the snapshot shows (a phone-landscape page in its scroller,
   * or one portrait page after an iPad spread).
   */
  waitForMorph: boolean;
};

export type RotationStageHandle = {
  /**
   * The new layout of the turn `token` (towards `orientation`) has painted
   * the page to show. When `testID` is given, the stage also waits until the
   * view with that `testID` sits inside it (the list is at that page). It
   * then lifts its cover two display frames later.
   */
  markReady: (
    token: number,
    orientation: 'portrait' | 'landscape',
    options: RotationStageReady,
  ) => void;
  /**
   * The shown view drew again: the stage drops its portrait snapshot, which
   * may no longer show what the view shows. `newFrame`: the draw came with a
   * new size or safe area; during a turn that is the turn itself, and the
   * stage keeps the snapshot.
   */
  pageDrew: (newFrame: boolean) => void;
};

type NativeHandle = {
  markReady: (
    token: number,
    orientation: string,
    options: RotationStageReady,
  ) => Promise<void>;
  pageDrew: (newFrame: boolean) => Promise<void>;
};

let NativeStage: React.ComponentType<
  RotationStageProps & {ref?: React.Ref<NativeHandle>}
> | null = null;
if (Platform.OS === 'ios') {
  try {
    if (requireOptionalNativeModule('RotationStage')) {
      NativeStage = requireNativeView('RotationStage');
    }
  } catch {
    NativeStage = null;
  }
}

/** True when the native stage is linked (iOS builds). */
export const isRotationStageAvailable = NativeStage !== null;

export const RotationStage = forwardRef<
  RotationStageHandle,
  RotationStageProps
>(function RotationStage(
  {mapping, backdropColor, pictureTestID, ...rest},
  ref,
) {
  const nativeRef = useRef<NativeHandle>(null);
  useImperativeHandle(
    ref,
    () => ({
      markReady: (token, orientation, options) => {
        nativeRef.current?.markReady(token, orientation, options)?.catch(() => {
          // The view left the screen; there is nothing to uncover.
        });
      },
      pageDrew: newFrame => {
        nativeRef.current?.pageDrew(newFrame)?.catch(() => {
          // The view left the screen; it keeps no snapshot then.
        });
      },
    }),
    [],
  );
  if (NativeStage) {
    return (
      <NativeStage
        ref={nativeRef}
        mapping={mapping ?? null}
        backdropColor={backdropColor}
        pictureTestID={pictureTestID ?? null}
        {...rest}
      />
    );
  }
  return <View {...rest} />;
});
