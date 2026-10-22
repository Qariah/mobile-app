// @ai Qariah (ANR hotfix v2) — wiring for the boot-splash experiment.
//
// This module creates the ONE experiment instance for the process. It connects
// the pure controller (./bootSplashExperiment) to the native module and to the
// build flag. The import must not throw: every native wrapper and the
// controller catch their own errors.
// Plan: planning/anr-hotfix-v2-plan.md, section 2.

import {Platform} from 'react-native';
import {
  getBootRisk,
  getBootSplashMode,
  getPreviousProcessInfo,
  setBootRisk,
  setNonBlockingSplashForNextLaunch,
  setNonBlockingSplashOffKeepGuard,
} from '@/modules/qariah-boot-splash';
import {isFeatureEnabled} from '@/config/featureFlags';
import {analyticsService} from '@/services/analytics/AnalyticsService';
import {
  createBootSplashExperiment,
  type BootRiskReason,
  type ColdStartBootProps,
} from './bootSplashExperiment';

export {NONBLOCKING_SPLASH_FLAG_V2} from './bootSplashExperiment';
export type {BootRiskReason, ColdStartBootProps} from './bootSplashExperiment';

/** The experiment instance for this process. */
export const bootSplashExperiment = createBootSplashExperiment({
  native: {
    setNonBlockingSplashForNextLaunch,
    setNonBlockingSplashOffKeepGuard,
    getBootSplashMode,
    setBootRisk,
    getBootRisk,
    getPreviousProcessInfo,
  },
  isAndroid: Platform.OS === 'android',
  buildFlagEnabled: isFeatureEnabled('nonBlockingSplash'),
});

/** The cold_start_began props when the previous process is not known. */
export const UNKNOWN_COLD_START_BOOT_PROPS: ColdStartBootProps = {
  prev_exit_reason: 'unknown',
  prev_process_boot_splash_mode: 'unknown',
  prev_reached_reveal: false,
  prev_process_known: false,
};

/**
 * Enrol this device as a boot risk. Send `boot_risk_enrolled` only when the
 * device was not enrolled before. Inactive (iOS) does nothing. Never throws.
 */
export function enrolBootRisk(reason: BootRiskReason): void {
  try {
    if (bootSplashExperiment.enrol(reason)) {
      analyticsService.trackBootRiskEnrolled({
        reason,
        boot_splash_mode: getBootSplashMode(),
      });
    }
  } catch {
    /* never throw into the boot path */
  }
}

/**
 * The boot-splash mode of this process for event props, or undefined where
 * the native module is absent (iOS). Never throws.
 */
export function bootSplashModeProp(): string | undefined {
  try {
    const mode = getBootSplashMode();
    return mode === 'unavailable' ? undefined : mode;
  } catch {
    return undefined;
  }
}
