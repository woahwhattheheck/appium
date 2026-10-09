import {util} from '@appium/support';
import {BASE_DESIRED_CAP_CONSTRAINTS} from '@appium/types';
import type {Capabilities, Constraints} from '@appium/types';

import {omit} from '../utils';
import {APPIUM_VENDOR_PREFIX, isStandardCap} from './capabilities';
import type {ValidateCapsOpts} from './capabilities';
import {validator} from './validation';

/** One driver capability diagnostic, suitable for assertions without a session. */
export type CapabilityDiagnostic = {
  capability: string;
  message: string;
};

export type CapabilityDiagnosis = {
  /** Whether all declared constraints are satisfied (warnings do not fail validation). */
  valid: boolean;
  errors: CapabilityDiagnostic[];
  /** Unknown names which regular capability validation otherwise only logs about. */
  warnings: CapabilityDiagnostic[];
};

/**
 * Diagnose driver capability constraints without creating a session or throwing.
 *
 * Accepts a single-level capability object, including optional `appium:` prefixes.
 * W3C `alwaysMatch`/`firstMatch` envelopes should be resolved before calling.
 * The same presence and value validators as `validateCaps` are used. Unknown
 * names are warnings rather than errors, so driver authors can assert on them.
 *
 * @example
 * const report = diagnoseCaps({deviceName: 'Phone', mysteryCap: 1}, {deviceName: {isString: true}});
 * // report.valid === true; report.warnings[0].capability === 'mysteryCap'
 */
export function diagnoseCaps<C extends Constraints>(
  caps: Capabilities<C> | unknown,
  constraints: C = {} as C,
  opts: ValidateCapsOpts = {},
): CapabilityDiagnosis {
  if (!util.isPlainObject(caps)) {
    return {
      valid: false,
      errors: [{capability: 'capabilities', message: 'must be a JSON object'}],
      warnings: [],
    };
  }
  if (!util.isPlainObject(constraints)) {
    return {
      valid: false,
      errors: [{capability: 'constraints', message: 'must be a JSON object'}],
      warnings: [],
    };
  }

  const values: Record<string, unknown> = {};
  const errors: CapabilityDiagnostic[] = [];
  const warnings: CapabilityDiagnostic[] = [];
  const knownNames = new Set([
    ...Object.keys(BASE_DESIRED_CAP_CONSTRAINTS),
    ...Object.keys(constraints),
  ]);

  for (const [name, value] of Object.entries(caps)) {
    const normalized = name.startsWith(APPIUM_VENDOR_PREFIX)
      ? name.slice(APPIUM_VENDOR_PREFIX.length)
      : name;
    if (Object.hasOwn(values, normalized)) {
      errors.push({
        capability: normalized,
        message: 'must not be supplied with and without the appium: prefix',
      });
      continue;
    }
    values[normalized] = value;
    if (!knownNames.has(normalized) && !isStandardCap(normalized)) {
      warnings.push({
        capability: name,
        message: 'capability has no declared validation constraint',
      });
    }
  }

  const effectiveConstraints = Object.fromEntries(
    Object.entries(constraints).map(([key, constraint]) => {
      if (opts.skipPresenceConstraint) {
        return [key, omit(constraint as Record<string, unknown>, 'presence')];
      }
      if ((constraint as {presence?: unknown}).presence === true) {
        return [
          key,
          {
            ...omit(constraint as Record<string, unknown>, 'presence'),
            presence: {allowEmpty: false},
          },
        ];
      }
      return [key, constraint];
    }),
  ) as C;

  const presentValues = Object.fromEntries(
    Object.entries(values).filter(([, value]) => util.hasValue(value)),
  );
  const validationErrors = validator.validate(presentValues, effectiveConstraints);
  if (validationErrors) {
    for (const [capability, reasons] of Object.entries(validationErrors)) {
      for (const message of reasons) {
        errors.push({capability, message});
      }
    }
  }

  return {valid: errors.length === 0, errors, warnings};
}
