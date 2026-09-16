/**
 * Google geotarget location codes as used by DataForSEO (Labs / SERP / Google Ads).
 * Derived from the public DataForSEO locations list; the subset marked
 * `labsSupported: false` is only served by the Google Ads keyword endpoints.
 * Country coverage list originally compiled by the open-seo project (MIT, (c) 2026 Ben Senescu); re-keyed here.
 */
export interface LocationEntry {
  code: number;
  iso: string;
  name: string;
  /** Default language for keyword-data endpoints. */
  language: string;
  labsSupported?: boolean;
}

export const LOCATIONS: readonly LocationEntry[] = [
  { code: 2008, iso: "AL", name: "Albania", language: "sq" },
  { code: 2012, iso: "DZ", name: "Algeria", language: "fr" },
  { code: 2020, iso: "AD", name: "Andorra", language: "ca", labsSupported: false },
  { code: 2024, iso: "AO", name: "Angola", language: "pt" },
  { code: 2032, iso: "AR", name: "Argentina", language: "es" },
  { code: 2051, iso: "AM", name: "Armenia", language: "hy" },
  { code: 2036, iso: "AU", name: "Australia", language: "en" },
  { code: 2040, iso: "AT", name: "Austria", language: "de" },
  { code: 2031, iso: "AZ", name: "Azerbaijan", language: "az" },
  { code: 2044, iso: "BS", name: "Bahamas", language: "en", labsSupported: false },
  { code: 2048, iso: "BH", name: "Bahrain", language: "ar" },
  { code: 2050, iso: "BD", name: "Bangladesh", language: "bn" },
  { code: 2052, iso: "BB", name: "Barbados", language: "en", labsSupported: false },
  { code: 2056, iso: "BE", name: "Belgium", language: "nl" },
  { code: 2084, iso: "BZ", name: "Belize", language: "en", labsSupported: false },
  { code: 2068, iso: "BO", name: "Bolivia", language: "es" },
  { code: 2070, iso: "BA", name: "Bosnia and Herzegovina", language: "bs" },
  { code: 2072, iso: "BW", name: "Botswana", language: "en", labsSupported: false },
  { code: 2076, iso: "BR", name: "Brazil", language: "pt" },
  { code: 2096, iso: "BN", name: "Brunei", language: "ms", labsSupported: false },
  { code: 2100, iso: "BG", name: "Bulgaria", language: "bg" },
  { code: 2854, iso: "BF", name: "Burkina Faso", language: "fr" },
  { code: 2116, iso: "KH", name: "Cambodia", language: "en" },
  { code: 2120, iso: "CM", name: "Cameroon", language: "fr" },
  { code: 2124, iso: "CA", name: "Canada", language: "en" },
  { code: 2152, iso: "CL", name: "Chile", language: "es" },
  { code: 2170, iso: "CO", name: "Colombia", language: "es" },
  { code: 2188, iso: "CR", name: "Costa Rica", language: "es" },
  { code: 2384, iso: "CI", name: "Cote d'Ivoire", language: "fr" },
  { code: 2191, iso: "HR", name: "Croatia", language: "hr" },
  { code: 2196, iso: "CY", name: "Cyprus", language: "el" },
  { code: 2203, iso: "CZ", name: "Czechia", language: "cs" },
  { code: 2208, iso: "DK", name: "Denmark", language: "da" },
  { code: 2214, iso: "DO", name: "Dominican Republic", language: "es", labsSupported: false },
  { code: 2218, iso: "EC", name: "Ecuador", language: "es" },
  { code: 2818, iso: "EG", name: "Egypt", language: "ar" },
  { code: 2222, iso: "SV", name: "El Salvador", language: "es" },
  { code: 2233, iso: "EE", name: "Estonia", language: "et" },
  { code: 2231, iso: "ET", name: "Ethiopia", language: "en", labsSupported: false },
  { code: 2242, iso: "FJ", name: "Fiji", language: "en", labsSupported: false },
  { code: 2246, iso: "FI", name: "Finland", language: "fi" },
  { code: 2250, iso: "FR", name: "France", language: "fr" },
  { code: 2268, iso: "GE", name: "Georgia", language: "en", labsSupported: false },
  { code: 2276, iso: "DE", name: "Germany", language: "de" },
  { code: 2288, iso: "GH", name: "Ghana", language: "en" },
  { code: 2300, iso: "GR", name: "Greece", language: "el" },
  { code: 2320, iso: "GT", name: "Guatemala", language: "es" },
  { code: 2831, iso: "GG", name: "Guernsey", language: "en", labsSupported: false },
  { code: 2328, iso: "GY", name: "Guyana", language: "en", labsSupported: false },
  { code: 2332, iso: "HT", name: "Haiti", language: "fr", labsSupported: false },
  { code: 2340, iso: "HN", name: "Honduras", language: "es", labsSupported: false },
  { code: 2344, iso: "HK", name: "Hong Kong", language: "zh-TW" },
  { code: 2348, iso: "HU", name: "Hungary", language: "hu" },
  { code: 2352, iso: "IS", name: "Iceland", language: "is", labsSupported: false },
  { code: 2356, iso: "IN", name: "India", language: "en" },
  { code: 2360, iso: "ID", name: "Indonesia", language: "id" },
  { code: 2368, iso: "IQ", name: "Iraq", language: "ar", labsSupported: false },
  { code: 2372, iso: "IE", name: "Ireland", language: "en" },
  { code: 2833, iso: "IM", name: "Isle of Man", language: "en", labsSupported: false },
  { code: 2376, iso: "IL", name: "Israel", language: "he" },
  { code: 2380, iso: "IT", name: "Italy", language: "it" },
  { code: 2388, iso: "JM", name: "Jamaica", language: "en", labsSupported: false },
  { code: 2392, iso: "JP", name: "Japan", language: "ja" },
  { code: 2832, iso: "JE", name: "Jersey", language: "en", labsSupported: false },
  { code: 2400, iso: "JO", name: "Jordan", language: "ar" },
  { code: 2398, iso: "KZ", name: "Kazakhstan", language: "ru" },
  { code: 2404, iso: "KE", name: "Kenya", language: "en" },
  { code: 2414, iso: "KW", name: "Kuwait", language: "ar", labsSupported: false },
  { code: 2417, iso: "KG", name: "Kyrgyzstan", language: "ru", labsSupported: false },
  { code: 2418, iso: "LA", name: "Laos", language: "en", labsSupported: false },
  { code: 2428, iso: "LV", name: "Latvia", language: "lv" },
  { code: 2422, iso: "LB", name: "Lebanon", language: "ar", labsSupported: false },
  { code: 2438, iso: "LI", name: "Liechtenstein", language: "de", labsSupported: false },
  { code: 2440, iso: "LT", name: "Lithuania", language: "lt" },
  { code: 2442, iso: "LU", name: "Luxembourg", language: "fr", labsSupported: false },
  { code: 2450, iso: "MG", name: "Madagascar", language: "fr", labsSupported: false },
  { code: 2454, iso: "MW", name: "Malawi", language: "en", labsSupported: false },
  { code: 2458, iso: "MY", name: "Malaysia", language: "en" },
  { code: 2462, iso: "MV", name: "Maldives", language: "en", labsSupported: false },
  { code: 2470, iso: "MT", name: "Malta", language: "en" },
  { code: 2480, iso: "MU", name: "Mauritius", language: "en", labsSupported: false },
  { code: 2484, iso: "MX", name: "Mexico", language: "es" },
  { code: 2498, iso: "MD", name: "Moldova", language: "ro" },
  { code: 2492, iso: "MC", name: "Monaco", language: "fr" },
  { code: 2496, iso: "MN", name: "Mongolia", language: "en", labsSupported: false },
  { code: 2499, iso: "ME", name: "Montenegro", language: "sr", labsSupported: false },
  { code: 2504, iso: "MA", name: "Morocco", language: "ar" },
  { code: 2508, iso: "MZ", name: "Mozambique", language: "pt", labsSupported: false },
  { code: 2104, iso: "MM", name: "Myanmar (Burma)", language: "en" },
  { code: 2516, iso: "NA", name: "Namibia", language: "en", labsSupported: false },
  { code: 2524, iso: "NP", name: "Nepal", language: "en", labsSupported: false },
  { code: 2528, iso: "NL", name: "Netherlands", language: "nl" },
  { code: 2554, iso: "NZ", name: "New Zealand", language: "en" },
  { code: 2558, iso: "NI", name: "Nicaragua", language: "es" },
  { code: 2566, iso: "NG", name: "Nigeria", language: "en" },
  { code: 2807, iso: "MK", name: "North Macedonia", language: "mk" },
  { code: 2578, iso: "NO", name: "Norway", language: "nb" },
  { code: 2512, iso: "OM", name: "Oman", language: "ar", labsSupported: false },
  { code: 2586, iso: "PK", name: "Pakistan", language: "en" },
  { code: 2275, iso: "PS", name: "Palestine", language: "ar", labsSupported: false },
  { code: 2591, iso: "PA", name: "Panama", language: "es" },
  { code: 2598, iso: "PG", name: "Papua New Guinea", language: "en", labsSupported: false },
  { code: 2600, iso: "PY", name: "Paraguay", language: "es" },
  { code: 2604, iso: "PE", name: "Peru", language: "es" },
  { code: 2608, iso: "PH", name: "Philippines", language: "en" },
  { code: 2616, iso: "PL", name: "Poland", language: "pl" },
  { code: 2620, iso: "PT", name: "Portugal", language: "pt" },
  { code: 2634, iso: "QA", name: "Qatar", language: "ar", labsSupported: false },
  { code: 2642, iso: "RO", name: "Romania", language: "ro" },
  { code: 2646, iso: "RW", name: "Rwanda", language: "en", labsSupported: false },
  { code: 2674, iso: "SM", name: "San Marino", language: "it", labsSupported: false },
  { code: 2682, iso: "SA", name: "Saudi Arabia", language: "ar" },
  { code: 2686, iso: "SN", name: "Senegal", language: "fr" },
  { code: 2688, iso: "RS", name: "Serbia", language: "sr" },
  { code: 2702, iso: "SG", name: "Singapore", language: "en" },
  { code: 2703, iso: "SK", name: "Slovakia", language: "sk" },
  { code: 2705, iso: "SI", name: "Slovenia", language: "sl" },
  { code: 2710, iso: "ZA", name: "South Africa", language: "en" },
  { code: 2410, iso: "KR", name: "South Korea", language: "ko" },
  { code: 2724, iso: "ES", name: "Spain", language: "es" },
  { code: 2144, iso: "LK", name: "Sri Lanka", language: "en" },
  { code: 2740, iso: "SR", name: "Suriname", language: "nl", labsSupported: false },
  { code: 2752, iso: "SE", name: "Sweden", language: "sv" },
  { code: 2756, iso: "CH", name: "Switzerland", language: "de" },
  { code: 2158, iso: "TW", name: "Taiwan", language: "zh-TW" },
  { code: 2762, iso: "TJ", name: "Tajikistan", language: "ru", labsSupported: false },
  { code: 2834, iso: "TZ", name: "Tanzania", language: "en", labsSupported: false },
  { code: 2764, iso: "TH", name: "Thailand", language: "th" },
  { code: 2780, iso: "TT", name: "Trinidad and Tobago", language: "en", labsSupported: false },
  { code: 2788, iso: "TN", name: "Tunisia", language: "ar" },
  { code: 2792, iso: "TR", name: "Turkiye", language: "tr" },
  { code: 2795, iso: "TM", name: "Turkmenistan", language: "ru", labsSupported: false },
  { code: 2800, iso: "UG", name: "Uganda", language: "en", labsSupported: false },
  { code: 2804, iso: "UA", name: "Ukraine", language: "uk" },
  { code: 2784, iso: "AE", name: "United Arab Emirates", language: "en" },
  { code: 2826, iso: "UK", name: "United Kingdom", language: "en" },
  { code: 2840, iso: "US", name: "United States", language: "en" },
  { code: 2858, iso: "UY", name: "Uruguay", language: "es" },
  { code: 2860, iso: "UZ", name: "Uzbekistan", language: "ru", labsSupported: false },
  { code: 2862, iso: "VE", name: "Venezuela", language: "es" },
  { code: 2704, iso: "VN", name: "Vietnam", language: "vi" },
  { code: 2894, iso: "ZM", name: "Zambia", language: "en", labsSupported: false },
  { code: 2716, iso: "ZW", name: "Zimbabwe", language: "en", labsSupported: false },
];

/** Countries where DataForSEO keyword-data endpoints accept more than one language. */
export const MULTI_LANGUAGE_LOCATIONS: Record<number, string[]> = {
  2012: ["ar", "fr"],
  2056: ["de", "fr", "nl"],
  2124: ["en", "fr"],
  2196: ["el", "en"],
  2300: ["el", "en"],
  2344: ["en", "zh-TW"],
  2356: ["en", "hi"],
  2360: ["en", "id"],
  2376: ["ar", "he"],
  2458: ["en", "ms"],
  2504: ["ar", "fr"],
  2586: ["en", "ur"],
  2608: ["en", "tl"],
  2702: ["en", "zh-CN"],
  2704: ["en", "vi"],
  2756: ["de", "fr", "it"],
  2784: ["ar", "en"],
  2804: ["ru", "uk"],
  2818: ["ar", "en"],
  2840: ["en", "es"],
};

const byIso = new Map(LOCATIONS.map((l) => [l.iso, l]));
const byCode = new Map(LOCATIONS.map((l) => [l.code, l]));

export function locationByIso(iso: string): LocationEntry | null {
  return byIso.get(iso.toUpperCase()) ?? null;
}
export function locationByCode(code: number): LocationEntry | null {
  return byCode.get(code) ?? null;
}
export function languagesForLocation(code: number): string[] {
  const l = byCode.get(code);
  if (!l) return [];
  return MULTI_LANGUAGE_LOCATIONS[code] ?? [l.language];
}
/** Language to send to keyword-data endpoints: the requested one if the country supports it, else the country default. */
export function keywordDataLanguage(code: number, requested: string): string {
  const langs = languagesForLocation(code);
  return langs.includes(requested) ? requested : (langs[0] ?? requested);
}
