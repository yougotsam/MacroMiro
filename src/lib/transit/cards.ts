export type Region = "americas" | "europe" | "asia" | "oceania" | "cis" | "world";

export type TransitCard = {
  name: string;
  where: string;
  region: Region;
  media: string;
  ios: boolean;
  keys: boolean;
  idOnly?: boolean;
};

export const CARDS: TransitCard[] = [
  { name: "Clipper", where: "San Francisco Bay, CA", region: "americas", media: "DESFire", ios: true, keys: false },
  { name: "ORCA", where: "Seattle, WA", region: "americas", media: "DESFire", ios: true, keys: false },
  { name: "Transit Access Pass", where: "Los Angeles, CA", region: "americas", media: "MIFARE Classic", ios: false, keys: true },
  { name: "Hop Fastpass", where: "Portland, OR", region: "americas", media: "DESFire", ios: true, keys: false },
  { name: "Ventra", where: "Chicago, IL", region: "americas", media: "DESFire", ios: true, keys: false },
  { name: "CharlieCard", where: "Boston, MA", region: "americas", media: "MIFARE Classic", ios: false, keys: true },
  { name: "Go-To Card", where: "Minneapolis–St. Paul, MN", region: "americas", media: "MIFARE Classic", ios: false, keys: true },
  { name: "SunCard", where: "Orlando, FL", region: "americas", media: "MIFARE Classic", ios: false, keys: true },
  { name: "HOLO", where: "Oʻahu, HI", region: "americas", media: "DESFire", ios: true, keys: false },
  { name: "Compass", where: "Vancouver, BC", region: "americas", media: "DESFire / Ultralight", ios: true, keys: false },
  { name: "Opus", where: "Québec, Canada", region: "americas", media: "Calypso", ios: true, keys: false },
  { name: "bip!", where: "Santiago, Chile", region: "americas", media: "MIFARE Classic", ios: false, keys: true },
  { name: "Bilhete Único", where: "São Paulo, Brazil", region: "americas", media: "MIFARE Classic", ios: false, keys: true },
  { name: "Oyster", where: "London, UK", region: "europe", media: "MIFARE Classic", ios: false, keys: true },
  { name: "Navigo", where: "Paris, France", region: "europe", media: "Calypso", ios: true, keys: false },
  { name: "OV-chipkaart", where: "Netherlands", region: "europe", media: "MIFARE Classic", ios: false, keys: true },
  { name: "Mobib", where: "Belgium", region: "europe", media: "Calypso", ios: true, keys: false },
  { name: "Rejsekort", where: "Denmark", region: "europe", media: "MIFARE Classic", ios: false, keys: true },
  { name: "HSL / Waltti", where: "Finland", region: "europe", media: "DESFire", ios: true, keys: false },
  { name: "Lisboa Viva", where: "Lisbon, Portugal", region: "europe", media: "Calypso", ios: true, keys: false },
  { name: "Leap", where: "Ireland", region: "europe", media: "DESFire", ios: false, keys: true },
  { name: "Rav-Kav", where: "Israel", region: "europe", media: "Calypso", ios: true, keys: false },
  { name: "SL Access", where: "Stockholm, Sweden", region: "europe", media: "MIFARE Classic", ios: false, keys: true },
  { name: "Warszawska Karta Miejska", where: "Warsaw, Poland", region: "europe", media: "MIFARE Classic", ios: true, keys: true },
  { name: "Opal", where: "Sydney, NSW", region: "oceania", media: "DESFire", ios: true, keys: false },
  { name: "myki", where: "Melbourne, VIC", region: "oceania", media: "DESFire", ios: true, keys: false },
  { name: "Go card", where: "Brisbane / SEQ", region: "oceania", media: "MIFARE Classic", ios: false, keys: true },
  { name: "SmartRider", where: "Western Australia", region: "oceania", media: "MIFARE Classic", ios: false, keys: true },
  { name: "MyWay", where: "Australian Capital Territory", region: "oceania", media: "MIFARE Classic", ios: false, keys: true },
  { name: "AT HOP", where: "Auckland, NZ", region: "oceania", media: "FeliCa", ios: true, keys: false, idOnly: true },
  { name: "Snapper", where: "Wellington, NZ", region: "oceania", media: "FeliCa", ios: true, keys: false },
  { name: "Suica / ICOCA / PASMO", where: "Japan", region: "asia", media: "FeliCa", ios: true, keys: false },
  { name: "Octopus", where: "Hong Kong", region: "asia", media: "FeliCa", ios: true, keys: false },
  { name: "EZ-Link", where: "Singapore", region: "asia", media: "CEPAS", ios: false, keys: false },
  { name: "T-Money", where: "South Korea", region: "asia", media: "ISO 7816", ios: true, keys: false },
  { name: "EasyCard", where: "Taipei", region: "asia", media: "MIFARE Classic", ios: false, keys: true },
  { name: "Shenzhen Tong", where: "Shenzhen, China", region: "asia", media: "ISO 7816 / FeliCa", ios: true, keys: false },
  { name: "Nol", where: "Dubai, UAE", region: "asia", media: "DESFire", ios: true, keys: false, idOnly: true },
  { name: "IstanbulKart", where: "Istanbul, Turkey", region: "asia", media: "DESFire", ios: true, keys: false },
  { name: "Troika", where: "Moscow", region: "cis", media: "MIFARE Classic", ios: false, keys: true },
  { name: "Podorozhnik", where: "Saint Petersburg", region: "cis", media: "MIFARE Classic", ios: false, keys: true },
  { name: "Strelka", where: "Moscow", region: "cis", media: "MIFARE Classic", ios: false, keys: true },
  { name: "EMV bank card", where: "worldwide", region: "world", media: "EMV", ios: true, keys: false },
];

export const PROTOCOLS = [
  "FeliCa / FeliCa Lite",
  "ISO/IEC 7816-4",
  "Calypso",
  "CEPAS",
  "T-Money",
  "ISO/IEC 15693 Vicinity",
  "MIFARE Classic (NXP chipset)",
  "MIFARE DESFire",
  "MIFARE Ultralight",
];
