import type {Element, ExternalDriver, NextPluginCallback} from '@appium/types';
import {errors} from 'appium/driver.js';
import {BasePlugin} from 'appium/plugin.js';

import {transformSourceXml} from './source.js';
import type {TransformMetadata} from './types.js';
import {transformQuery} from './xpath.js';

export class UniversalXMLPlugin extends BasePlugin {
  // An opt-in virtual context; the underlying driver remains in NATIVE_APP.
  // A WeakMap avoids cross-driver and cross-session leakage without any global setting.
  private readonly xmlContext = new WeakMap<ExternalDriver, {
    sessionId: string | null;
    mode: 'native' | 'universal';
  }>();

  private getMode(driver: ExternalDriver): 'native' | 'universal' | undefined {
    const record = this.xmlContext.get(driver);
    return record && record.sessionId === (driver.sessionId ?? null) ? record.mode : undefined;
  }

  private setMode(driver: ExternalDriver, mode: 'native' | 'universal'): void {
    this.xmlContext.set(driver, {sessionId: driver.sessionId ?? null, mode});
  }

  async getContexts(next: NextPluginCallback, driver: ExternalDriver): Promise<string[]> {
    const contexts = (await next()) as string[];
    // Context enumeration advertises the synthetic view only when native is supported.
    return contexts.includes('NATIVE_APP') && !contexts.includes('universal-xml')
      ? [...contexts, 'universal-xml'] : contexts;
  }

  async getCurrentContext(next: NextPluginCallback, driver: ExternalDriver): Promise<string> {
    const actual = (await next()) as string;
    if (actual !== 'NATIVE_APP') {
      this.xmlContext.delete(driver);
      return actual;
    }
    return this.getMode(driver) === 'universal' ? 'universal-xml' : actual;
  }

  async setContext(next: NextPluginCallback, driver: ExternalDriver, name: string): Promise<void> {
    if (name === 'universal-xml') {
      // Never ask the actual driver to enter a fictitious context; WebViews stay real.
      if (!driver.getCurrentContext || (await driver.getCurrentContext()) !== 'NATIVE_APP') {
        throw new errors.NoSuchContextError();
      }
      this.setMode(driver, 'universal');
      return;
    }
    // Underlying driver validates all non-virtual names. Do not change state on failure.
    await next();
    if (name === 'NATIVE_APP') this.setMode(driver, 'native');
    else this.xmlContext.delete(driver);
  }

  async deleteSession(next: NextPluginCallback, driver: ExternalDriver): Promise<unknown> {
    try { return await next(); }
    finally { this.xmlContext.delete(driver); }
  }
  async getPageSource(
    next: NextPluginCallback | null,
    driver: ExternalDriver,
    sessId?: any,
    addIndexPath: boolean = false,
  ): Promise<string> {
    void sessId;
    const source = (next ? await next() : await driver.getPageSource()) as string;
    // Explicitly selected native context exposes unmodified page source, for OCR,
    // element clicks, and all ordinary platform-native automation.
    if (this.getMode(driver) === 'native' ||
        (driver.getCurrentContext && (await driver.getCurrentContext()) !== 'NATIVE_APP')) {
      return source;
    }
    const metadata: TransformMetadata = {};
    const platformName = getPlatformName(driver);
    if (platformName.toLowerCase() === 'android') {
      metadata.appPackage = (driver.opts as Record<string, unknown>)?.appPackage as string;
    }
    const {xml, unknowns} = await transformSourceXml(source, platformName.toLowerCase(), {
      metadata,
      addIndexPath,
    });
    if (unknowns.nodes.length) {
      this.log.warn(
        `The XML mapper found ${unknowns.nodes.length} node(s) / ` +
          `tag name(s) that it didn't know about. These should be ` +
          `reported to improve the quality of the plugin: ` +
          unknowns.nodes.join(', '),
      );
    }
    if (unknowns.attrs.length) {
      this.log.warn(
        `The XML mapper found ${unknowns.attrs.length} attributes ` +
          `that it didn't know about. These should be reported to ` +
          `improve the quality of the plugin: ` +
          unknowns.attrs.join(', '),
      );
    }
    return xml;
  }

  async findElement(
    next: NextPluginCallback,
    driver: ExternalDriver,
    strategy: string,
    selector: string,
  ): Promise<Element> {
    return (await this._find(false, next, driver, strategy, selector)) as Element;
  }

  async findElements(
    next: NextPluginCallback,
    driver: ExternalDriver,
    strategy: string,
    selector: string,
  ): Promise<Element[]> {
    return (await this._find(true, next, driver, strategy, selector)) as Element[];
  }

  private async _find(
    multiple: false,
    next: NextPluginCallback,
    driver: ExternalDriver,
    strategy: string,
    selector: string,
  ): Promise<Element>;
  private async _find(
    multiple: true,
    next: NextPluginCallback,
    driver: ExternalDriver,
    strategy: string,
    selector: string,
  ): Promise<Element[]>;
  private async _find(
    multiple: boolean,
    next: NextPluginCallback,
    driver: ExternalDriver,
    strategy: string,
    selector: string,
  ): Promise<Element | Element[]> {
    if (
      this.getMode(driver) === 'native' ||
      strategy.toLowerCase() !== 'xpath' ||
      !driver.getCurrentContext ||
      (await driver.getCurrentContext()) !== 'NATIVE_APP'
    ) {
      return (await next()) as Element | Element[];
    }
    const xml = await this.getPageSource(null, driver, null, true);
    const newSelector = transformQuery(selector, xml, multiple);

    // if the selector was not able to be transformed, that means no elements were found that
    // matched, so do the appropriate thing based on element vs elements
    if (newSelector === null) {
      this.log.warn(
        `Selector was not able to be translated to underlying XML. Either the requested ` +
          `element does not exist or there was an error in translation`,
      );
      if (multiple) {
        return [];
      }
      throw new errors.NoSuchElementError();
    }

    this.log.info(`Selector was translated to: ${newSelector}`);

    // otherwise just run the transformed query!
    const finder = multiple ? 'findElements' : 'findElement';
    return (await driver[finder](strategy, newSelector)) as Element | Element[];
  }
}

function getPlatformName(driver: ExternalDriver): string {
  return ((driver.caps as Record<string, unknown>)?.platformName as string) || '';
}
