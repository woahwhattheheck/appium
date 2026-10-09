import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {diagnoseCaps} from '../../../lib/basedriver/capability-diagnostics';

describe('diagnoseCaps (driver author API)', () => {
  it('reports malformed input without throwing', () => {
    assert.deepStrictEqual(diagnoseCaps(null), {
      valid: false,
      errors: [{capability: 'capabilities', message: 'must be a JSON object'}],
      warnings: [],
    });
  });

  it('collects multiple constraint failures and unknown-capability warnings', () => {
    const report = diagnoseCaps(
      {deviceName: 25, enabled: 'nope', customFlag: 42},
      {deviceName: {isString: true}, enabled: {isBoolean: true}},
    );
    assert.equal(report.valid, false);
    assert.deepStrictEqual(
      report.errors.map(({capability}) => capability).sort(),
      ['deviceName', 'enabled'],
    );
    assert.deepStrictEqual(report.warnings, [
      {capability: 'customFlag', message: 'capability has no declared validation constraint'},
    ]);
  });

  it('accepts known standard, base and driver-defined capability names', () => {
    const report = diagnoseCaps(
      {platformName: 'iOS', 'appium:deviceName': 'iPhone', 'appium:automationName': 'XCUITest'},
      {deviceName: {isString: true}, automationName: {isString: true}},
    );
    assert.deepStrictEqual(report, {valid: true, errors: [], warnings: []});
  });

  it('supports presence constraints and explicit presence skip', () => {
    const constraints = {requiredCap: {presence: true}};
    assert.deepStrictEqual(diagnoseCaps({}, constraints).errors.map((item) => item.capability), ['requiredCap']);
    assert.deepStrictEqual(diagnoseCaps({}, constraints, {skipPresenceConstraint: true}), {
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  it('does not quietly overwrite conflicting prefixed capability names', () => {
    const report = diagnoseCaps({'appium:deviceName': 'one', deviceName: 'two'}, {deviceName: {isString: true}});
    assert.equal(report.valid, false);
    assert.match(report.errors[0].message, /must not be supplied/);
    assert.deepStrictEqual(report.warnings, []);
  });
});
