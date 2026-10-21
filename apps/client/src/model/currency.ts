/**
 * The currency each country uses, keyed by ISO 3166 region code, for the
 * expense entry suggestion when a locale names a region explicitly.
 */
const regionCurrencies: Record<string, string> = Object.fromEntries(
  Object.entries({
    EUR: 'AD AT AX BE BL CY DE EE ES FI FR GF GP GR HR IE IT LT LU LV MC ME MF MQ MT NL PM PT RE SI SK SM TF VA XK YT',
    USD: 'AS BQ EC FM GU IO MH MP PR PW SV TC TL UM US VG VI',
    XOF: 'BF BJ CI GW ML NE SN TG',
    XAF: 'CF CG CM GA GQ TD',
    XCD: 'AG AI DM GD KN LC MS VC',
    AUD: 'AU CC CX HM KI NF NR TV',
    NZD: 'CK NU NZ PN TK',
    GBP: 'GB GG GS IM JE',
    DKK: 'DK FO GL',
    NOK: 'BV NO SJ',
    CHF: 'CH LI',
    ZAR: 'ZA',
    INR: 'IN',
    XPF: 'NC PF WF',
    ANG: 'CW SX',
    MAD: 'EH MA',
  }).flatMap(([currency, regions]) => regions.split(' ').map((region) => [region, currency])),
);

const singleRegion =
  'AE:AED AF:AFN AL:ALL AM:AMD AO:AOA AR:ARS AW:AWG AZ:AZN BA:BAM BB:BBD BD:BDT BG:BGN BH:BHD BI:BIF BM:BMD ' +
  'BN:BND BO:BOB BR:BRL BS:BSD BT:BTN BW:BWP BY:BYN BZ:BZD CA:CAD CD:CDF CL:CLP CN:CNY CO:COP CR:CRC CU:CUP ' +
  'CV:CVE CZ:CZK DJ:DJF DO:DOP DZ:DZD EG:EGP ER:ERN ET:ETB FJ:FJD FK:FKP GE:GEL GH:GHS GI:GIP GM:GMD GN:GNF ' +
  'GT:GTQ GY:GYD HK:HKD HN:HNL HT:HTG HU:HUF ID:IDR IL:ILS IQ:IQD IR:IRR IS:ISK JM:JMD JO:JOD JP:JPY KE:KES ' +
  'KG:KGS KH:KHR KM:KMF KP:KPW KR:KRW KW:KWD KY:KYD KZ:KZT LA:LAK LB:LBP LK:LKR LR:LRD LS:LSL LY:LYD MD:MDL ' +
  'MG:MGA MK:MKD MM:MMK MN:MNT MO:MOP MR:MRU MU:MUR MV:MVR MW:MWK MX:MXN MY:MYR MZ:MZN NA:NAD NG:NGN NI:NIO ' +
  'NP:NPR OM:OMR PA:PAB PE:PEN PG:PGK PH:PHP PK:PKR PL:PLN PY:PYG QA:QAR RO:RON RS:RSD RU:RUB RW:RWF SA:SAR ' +
  'SB:SBD SC:SCR SD:SDG SE:SEK SG:SGD SH:SHP SL:SLE SO:SOS SR:SRD SS:SSP ST:STN SY:SYP SZ:SZL TH:THB TJ:TJS ' +
  'TM:TMT TN:TND TO:TOP TR:TRY TT:TTD TW:TWD TZ:TZS UA:UAH UG:UGX UY:UYU UZ:UZS VE:VES VN:VND VU:VUV WS:WST ' +
  'YE:YER ZM:ZMW ZW:ZWG';

for (const pair of singleRegion.split(' ')) {
  const [region = '', currency = ''] = pair.split(':');

  regionCurrencies[region] = currency;
}

/**
 * The region a locale tag names explicitly, such as "US" in "en-US". A
 * language alone, such as "en", names no country, so it gives none.
 */
export function localeRegion(locale: string | undefined): string | null {
  if (!locale) return null;

  try {
    return new Intl.Locale(locale).region ?? null;
  } catch {
    return null;
  }
}

/** The currency of a region, or null when it is unknown. */
export function regionCurrency(region: string | null | undefined): string | null {
  return (region && regionCurrencies[region.toUpperCase()]) || null;
}

/** The currencies most groups use, offered right after the group's own. */
export const commonCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'CNY', 'INR', 'MXN', 'BRL', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'NZD', 'SGD', 'HKD', 'KRW', 'ZAR', 'TRY', 'THB'];

export type CurrencyOption = { code: string; name: string };

let catalog: CurrencyOption[] | null = null;

/** Every currency the runtime can name, and every one in the region table, by code. */
function allCurrencies(): CurrencyOption[] {
  if (catalog) return catalog;

  const names = new Intl.DisplayNames(['en'], { type: 'currency' });
  const codes = new Set([...Intl.supportedValuesOf('currency'), ...Object.values(regionCurrencies)]);

  catalog = [...codes].sort().map((code) => ({ code, name: names.of(code) ?? code }));

  return catalog;
}

/** How well a currency matches a search, best first; null when it does not. */
function matchRank(option: CurrencyOption, search: string): number | null {
  const code = option.code.toLowerCase();
  const name = option.name.toLowerCase();

  if (code === search) return 0;

  if (code.startsWith(search)) return 1;

  if (name.split(/[\s-]+/).some((word) => word.startsWith(search))) return 2;

  return name.includes(search) ? 3 : null;
}

/**
 * The currencies to choose from. Without a search: the group's recent ones,
 * then the common ones, then the rest by code. A search keeps that order
 * within each kind of match: the code itself, codes starting with it, names
 * with a word starting with it, then names containing it. A three-letter code
 * that matches nothing listed is still offered.
 */
export function currencyOptions(recent: string[], query: string): CurrencyOption[] {
  const all = allCurrencies();
  const byCode = new Map(all.map((option) => [option.code, option]));
  const first = [...recent, ...commonCurrencies].map((code) => byCode.get(code) ?? { code, name: code });
  const ordered = [...new Map([...first, ...all].map((option) => [option.code, option])).values()];
  const search = query.trim().toLowerCase();

  if (!search) return ordered;

  const matches = ordered
    .flatMap((option) => {
      const rank = matchRank(option, search);

      return rank === null ? [] : [{ option, rank }];
    })
    .sort((left, right) => left.rank - right.rank)
    .map((match) => match.option);

  const typed = search.toUpperCase();

  if (!matches.length && /^[A-Z]{3}$/.test(typed)) matches.push({ code: typed, name: 'Not a listed currency' });

  return matches;
}
