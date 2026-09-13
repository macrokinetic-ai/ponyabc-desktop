import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type SupportedLocale } from '@shared/locales';

import enCommon from './locales/en/common.json';
import enHome from './locales/en/home.json';
import enRecordings from './locales/en/recordings.json';
import enBook from './locales/en/book.json';
import enFirmware from './locales/en/firmware.json';
import enSettings from './locales/en/settings.json';

import zhHantCommon from './locales/zh-Hant/common.json';
import zhHantHome from './locales/zh-Hant/home.json';
import zhHantRecordings from './locales/zh-Hant/recordings.json';
import zhHantBook from './locales/zh-Hant/book.json';
import zhHantFirmware from './locales/zh-Hant/firmware.json';
import zhHantSettings from './locales/zh-Hant/settings.json';

import zhHansCommon from './locales/zh-Hans/common.json';
import zhHansHome from './locales/zh-Hans/home.json';
import zhHansRecordings from './locales/zh-Hans/recordings.json';
import zhHansBook from './locales/zh-Hans/book.json';
import zhHansFirmware from './locales/zh-Hans/firmware.json';
import zhHansSettings from './locales/zh-Hans/settings.json';

import esCommon from './locales/es/common.json';
import esHome from './locales/es/home.json';
import esRecordings from './locales/es/recordings.json';
import esBook from './locales/es/book.json';
import esFirmware from './locales/es/firmware.json';
import esSettings from './locales/es/settings.json';

import frCommon from './locales/fr/common.json';
import frHome from './locales/fr/home.json';
import frRecordings from './locales/fr/recordings.json';
import frBook from './locales/fr/book.json';
import frFirmware from './locales/fr/firmware.json';
import frSettings from './locales/fr/settings.json';

import deCommon from './locales/de/common.json';
import deHome from './locales/de/home.json';
import deRecordings from './locales/de/recordings.json';
import deBook from './locales/de/book.json';
import deFirmware from './locales/de/firmware.json';
import deSettings from './locales/de/settings.json';

import itCommon from './locales/it/common.json';
import itHome from './locales/it/home.json';
import itRecordings from './locales/it/recordings.json';
import itBook from './locales/it/book.json';
import itFirmware from './locales/it/firmware.json';
import itSettings from './locales/it/settings.json';

import ptCommon from './locales/pt/common.json';
import ptHome from './locales/pt/home.json';
import ptRecordings from './locales/pt/recordings.json';
import ptBook from './locales/pt/book.json';
import ptFirmware from './locales/pt/firmware.json';
import ptSettings from './locales/pt/settings.json';

const resources: Record<SupportedLocale, Record<string, object>> = {
  en: { common: enCommon, home: enHome, recordings: enRecordings, book: enBook, firmware: enFirmware, settings: enSettings },
  'zh-Hant': {
    common: zhHantCommon,
    home: zhHantHome,
    recordings: zhHantRecordings,
    book: zhHantBook,
    firmware: zhHantFirmware,
    settings: zhHantSettings,
  },
  'zh-Hans': {
    common: zhHansCommon,
    home: zhHansHome,
    recordings: zhHansRecordings,
    book: zhHansBook,
    firmware: zhHansFirmware,
    settings: zhHansSettings,
  },
  es: { common: esCommon, home: esHome, recordings: esRecordings, book: esBook, firmware: esFirmware, settings: esSettings },
  fr: { common: frCommon, home: frHome, recordings: frRecordings, book: frBook, firmware: frFirmware, settings: frSettings },
  de: { common: deCommon, home: deHome, recordings: deRecordings, book: deBook, firmware: deFirmware, settings: deSettings },
  it: { common: itCommon, home: itHome, recordings: itRecordings, book: itBook, firmware: itFirmware, settings: itSettings },
  pt: { common: ptCommon, home: ptHome, recordings: ptRecordings, book: ptBook, firmware: ptFirmware, settings: ptSettings },
};

export async function initI18n(initialLocale: SupportedLocale): Promise<void> {
  await i18n.use(initReactI18next).init({
    resources,
    lng: initialLocale,
    fallbackLng: DEFAULT_LOCALE,
    defaultNS: 'common',
    ns: ['common', 'home', 'recordings', 'book', 'firmware', 'settings'],
    interpolation: { escapeValue: false },
    supportedLngs: [...SUPPORTED_LOCALES],
  });
}

export default i18n;
