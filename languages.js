// The 22 scheduled languages of India + English.
// sarvam: BCP-47 code used by Sarvam speech APIs.
// tts: true where Sarvam Bulbul text-to-speech supports the language.
export const LANGUAGES = [
  { code: 'en',  name: 'English',          native: 'English',   sarvam: 'en-IN',  tts: true },
  { code: 'as',  name: 'Assamese',         native: 'অসমীয়া',     sarvam: 'as-IN',  tts: false },
  { code: 'bn',  name: 'Bengali',          native: 'বাংলা',       sarvam: 'bn-IN',  tts: true },
  { code: 'brx', name: 'Bodo',             native: 'बड़ो',        sarvam: 'brx-IN', tts: false },
  { code: 'doi', name: 'Dogri',            native: 'डोगरी',       sarvam: 'doi-IN', tts: false },
  { code: 'gu',  name: 'Gujarati',         native: 'ગુજરાતી',     sarvam: 'gu-IN',  tts: true },
  { code: 'hi',  name: 'Hindi',            native: 'हिन्दी',       sarvam: 'hi-IN',  tts: true },
  { code: 'kn',  name: 'Kannada',          native: 'ಕನ್ನಡ',       sarvam: 'kn-IN',  tts: true },
  { code: 'ks',  name: 'Kashmiri',         native: 'کٲشُر',       sarvam: 'ks-IN',  tts: false },
  { code: 'kok', name: 'Konkani',          native: 'कोंकणी',      sarvam: 'kok-IN', tts: false },
  { code: 'mai', name: 'Maithili',         native: 'मैथिली',      sarvam: 'mai-IN', tts: false },
  { code: 'ml',  name: 'Malayalam',        native: 'മലയാളം',     sarvam: 'ml-IN',  tts: true },
  { code: 'mni', name: 'Manipuri (Meitei)',native: 'ꯃꯤꯇꯩꯂꯣꯟ',     sarvam: 'mni-IN', tts: false },
  { code: 'mr',  name: 'Marathi',          native: 'मराठी',       sarvam: 'mr-IN',  tts: true },
  { code: 'ne',  name: 'Nepali',           native: 'नेपाली',      sarvam: 'ne-IN',  tts: false },
  { code: 'or',  name: 'Odia',             native: 'ଓଡ଼ିଆ',       sarvam: 'od-IN',  tts: true },
  { code: 'pa',  name: 'Punjabi',          native: 'ਪੰਜਾਬੀ',      sarvam: 'pa-IN',  tts: true },
  { code: 'sa',  name: 'Sanskrit',         native: 'संस्कृतम्',     sarvam: 'sa-IN',  tts: false },
  { code: 'sat', name: 'Santali',          native: 'ᱥᱟᱱᱛᱟᱲᱤ',     sarvam: 'sat-IN', tts: false },
  { code: 'sd',  name: 'Sindhi',           native: 'سنڌي',        sarvam: 'sd-IN',  tts: false },
  { code: 'ta',  name: 'Tamil',            native: 'தமிழ்',       sarvam: 'ta-IN',  tts: true },
  { code: 'te',  name: 'Telugu',           native: 'తెలుగు',      sarvam: 'te-IN',  tts: true },
  { code: 'ur',  name: 'Urdu',             native: 'اردو',        sarvam: 'ur-IN',  tts: false },
];

export const BY_CODE = Object.fromEntries(LANGUAGES.map(l => [l.code, l]));

// Sarvam returns codes like "ta-IN" / "od-IN"; map back to our short codes.
export function fromSarvam(code) {
  if (!code) return null;
  const hit = LANGUAGES.find(l => l.sarvam.toLowerCase() === String(code).toLowerCase());
  return hit ? hit.code : String(code).split('-')[0];
}
