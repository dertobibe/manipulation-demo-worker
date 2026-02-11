// ============================================================
// Cloudflare Worker: Visitor Company Detection + AI City Image
// ============================================================
// Bindings: AI → Workers AI, IMAGE_CACHE → R2 "city-images"
// ============================================================

const KNOWN_ISPS = new Set([
  'deutsche telekom ag', 'telekom deutschland gmbh',
  'vodafone gmbh', 'vodafone deutschland gmbh', 'vodafone cable germany',
  'telefonica germany', 'telefonica germany gmbh & co. ohg', 'o2 germany',
  '1&1 versatel', '1&1 internet ag', '1&1 telecom gmbh',
  'unitymedia', 'liberty global',
  'freenet datenkommunikations gmbh', 'netcologne',
  'ewe tel gmbh', 'm-net telekommunikations gmbh', 'htp gmbh',
  'comcast', 'comcast cable communications',
  'at&t services', 'verizon', 'verizon business',
  'charter communications', 'spectrum', 'cox communications',
  'bt', 'sky broadband', 'virgin media',
  'orange', 'bouygues telecom',
  'swisscom', 'a1 telekom austria', 'sunrise', 'upc',
  'kpn', 'ziggo', 'telia', 'telenor',
  'cloudflare', 'google llc', 'apple inc.', 'akamai',
  'amazon.com', 'microsoft corporation',
  'digitalocean', 'hetzner online gmbh', 'ovh sas',
]);

const COMPANY_CONTENT = {
  '_default_b2b': {
    title: 'Willkommen aus der Unternehmenswelt',
    text: 'Wir haben erkannt, dass Sie aus einem Unternehmenskontext auf unsere Seite zugreifen. Gerne zeigen wir Ihnen, wie unsere Lösungen speziell für Ihr Unternehmen Mehrwert schaffen können.',
    cta_title: 'Enterprise-Lösungen entdecken',
    cta_text: 'Maßgeschneiderte Pakete für Ihr Unternehmen',
    cta_button: 'Demo vereinbaren',
  },
  '_default_private': {
    title: 'Willkommen!',
    text: 'Entdecke unsere Produkte und Services. Egal ob für dich persönlich oder dein Team – wir haben die passende Lösung.',
    cta_title: 'Jetzt loslegen',
    cta_text: 'Starte kostenlos und überzeuge dich selbst.',
    cta_button: 'Kostenlos testen',
  },
  'sap se': {
    title: 'Hallo SAP! 👋',
    text: 'Als SAP-Partner wissen wir, wie komplex Enterprise-Landschaften sein können. Unsere Lösung integriert sich nahtlos in bestehende SAP-Ökosysteme und ergänzt Ihre BTP-Strategie.',
    cta_title: 'SAP-Integration ansehen',
    cta_text: 'Erfahren Sie, wie wir mit S/4HANA und BTP zusammenarbeiten.',
    cta_button: 'Integration ansehen',
  },
  'siemens ag': {
    title: 'Willkommen, Siemens!',
    text: 'Für Industrieunternehmen wie Siemens bieten wir spezialisierte Lösungen im Bereich IoT-Datenanalyse und Predictive Maintenance.',
    cta_title: 'Industrie 4.0 Use Cases',
    cta_text: 'Konkrete Anwendungsfälle aus der Fertigungsindustrie.',
    cta_button: 'Use Cases entdecken',
  },
};

// --- City → Landmark Mapping ---
const CITY_LANDMARKS = {
  'berlin':       { landmark: 'Brandenburg Gate', city: 'Berlin' },
  'hamburg':      { landmark: 'Elbphilharmonie concert hall', city: 'Hamburg' },
  'munich':       { landmark: 'Frauenkirche cathedral with twin domes', city: 'Munich' },
  'münchen':      { landmark: 'Frauenkirche cathedral with twin domes', city: 'Munich' },
  'cologne':      { landmark: 'Cologne Cathedral (Kölner Dom)', city: 'Cologne' },
  'köln':         { landmark: 'Cologne Cathedral (Kölner Dom)', city: 'Cologne' },
  'frankfurt':    { landmark: 'Frankfurt skyline with skyscrapers and Alte Oper', city: 'Frankfurt' },
  'stuttgart':    { landmark: 'Neues Schloss Stuttgart palace', city: 'Stuttgart' },
  'esslingen':    { landmark: 'Neues Schloss Stuttgart palace', city: 'Stuttgart' },
  'düsseldorf':   { landmark: 'Rheinturm tower on the Rhine river', city: 'Düsseldorf' },
  'dortmund':     { landmark: 'Dortmunder U tower', city: 'Dortmund' },
  'essen':        { landmark: 'Zeche Zollverein industrial complex', city: 'Essen' },
  'leipzig':      { landmark: 'Völkerschlachtdenkmal monument', city: 'Leipzig' },
  'dresden':      { landmark: 'Frauenkirche Dresden baroque church', city: 'Dresden' },
  'hannover':     { landmark: 'Neues Rathaus Hannover city hall', city: 'Hannover' },
  'nürnberg':     { landmark: 'Kaiserburg Nürnberg imperial castle', city: 'Nürnberg' },
  'nuremberg':    { landmark: 'Kaiserburg Nürnberg imperial castle', city: 'Nürnberg' },
  'bremen':       { landmark: 'Bremen Town Musicians statue and Roland statue', city: 'Bremen' },
  'karlsruhe':    { landmark: 'Karlsruhe Palace with fan-shaped garden', city: 'Karlsruhe' },
  'mannheim':     { landmark: 'Mannheim Water Tower (Wasserturm)', city: 'Mannheim' },
  'heidelberg':   { landmark: 'Heidelberg Castle ruins above the Neckar river', city: 'Heidelberg' },
  'freiburg':     { landmark: 'Freiburg Minster cathedral', city: 'Freiburg' },
  'augsburg':     { landmark: 'Augsburg Rathaus renaissance town hall', city: 'Augsburg' },
  'bonn':         { landmark: 'Beethoven monument and old city hall Bonn', city: 'Bonn' },
  'münster':      { landmark: 'Prinzipalmarkt historic gabled houses Münster', city: 'Münster' },
  'regensburg':   { landmark: 'Stone Bridge and Regensburg Cathedral', city: 'Regensburg' },
  'ulm':          { landmark: 'Ulm Minster, the tallest church in the world', city: 'Ulm' },
  'tübingen':     { landmark: 'Neues Schloss Stuttgart palace', city: 'Stuttgart' },
  'ludwigsburg':  { landmark: 'Neues Schloss Stuttgart palace', city: 'Stuttgart' },
  'reutlingen':   { landmark: 'Neues Schloss Stuttgart palace', city: 'Stuttgart' },
  'böblingen':    { landmark: 'Neues Schloss Stuttgart palace', city: 'Stuttgart' },
  'sindelfingen': { landmark: 'Neues Schloss Stuttgart palace', city: 'Stuttgart' },
  'göppingen':    { landmark: 'Neues Schloss Stuttgart palace', city: 'Stuttgart' },
  'waiblingen':   { landmark: 'Neues Schloss Stuttgart palace', city: 'Stuttgart' },
  'heilbronn':    { landmark: 'Kilianskirche Heilbronn', city: 'Heilbronn' },
  'pforzheim':    { landmark: 'Karlsruhe Palace with fan-shaped garden', city: 'Karlsruhe' },
  'vienna':       { landmark: 'Stephansdom cathedral', city: 'Vienna' },
  'wien':         { landmark: 'Stephansdom cathedral', city: 'Vienna' },
  'salzburg':     { landmark: 'Hohensalzburg Fortress', city: 'Salzburg' },
  'innsbruck':    { landmark: 'Golden Roof (Goldenes Dachl)', city: 'Innsbruck' },
  'graz':         { landmark: 'Grazer Uhrturm clock tower on Schlossberg', city: 'Graz' },
  'linz':         { landmark: 'Ars Electronica Center Linz', city: 'Linz' },
  'zurich':       { landmark: 'Grossmünster church towers on Lake Zurich', city: 'Zurich' },
  'zürich':       { landmark: 'Grossmünster church towers on Lake Zurich', city: 'Zurich' },
  'bern':         { landmark: 'Zytglogge medieval clock tower', city: 'Bern' },
  'basel':        { landmark: 'Basel Minster red sandstone cathedral', city: 'Basel' },
  'geneva':       { landmark: 'Jet d\'Eau fountain on Lake Geneva', city: 'Geneva' },
  'genf':         { landmark: 'Jet d\'Eau fountain on Lake Geneva', city: 'Geneva' },
  'lucerne':      { landmark: 'Chapel Bridge (Kapellbrücke) wooden bridge', city: 'Lucerne' },
  'luzern':       { landmark: 'Chapel Bridge (Kapellbrücke) wooden bridge', city: 'Lucerne' },
  'london':       { landmark: 'Big Ben and Houses of Parliament', city: 'London' },
  'paris':        { landmark: 'Eiffel Tower', city: 'Paris' },
  'amsterdam':    { landmark: 'Canal houses and Rijksmuseum', city: 'Amsterdam' },
  'rome':         { landmark: 'Colosseum', city: 'Rome' },
  'madrid':       { landmark: 'Royal Palace of Madrid', city: 'Madrid' },
  'barcelona':    { landmark: 'Sagrada Familia basilica', city: 'Barcelona' },
  'prague':       { landmark: 'Charles Bridge and Prague Castle', city: 'Prague' },
  'prag':         { landmark: 'Charles Bridge and Prague Castle', city: 'Prague' },
  'new york':     { landmark: 'Statue of Liberty and Manhattan skyline', city: 'New York' },
  'san francisco':{ landmark: 'Golden Gate Bridge', city: 'San Francisco' },
  'tokyo':        { landmark: 'Tokyo Tower and Shibuya crossing', city: 'Tokyo' },
  'sydney':       { landmark: 'Sydney Opera House', city: 'Sydney' },
};

const DEFAULT_LANDMARK = { landmark: 'a beautiful European city skyline', city: 'Europe' };

// --- Helpers ---

function getTimeOfDay(utcHour, timezoneOffset) {
  const localHour = (utcHour + timezoneOffset + 24) % 24;
  if (localHour >= 5 && localHour < 8)   return { period: 'early morning', light: 'soft dawn light, pink and orange sky' };
  if (localHour >= 8 && localHour < 11)  return { period: 'morning', light: 'bright morning sunlight, clear sky' };
  if (localHour >= 11 && localHour < 14) return { period: 'midday', light: 'bright midday sun, high contrast' };
  if (localHour >= 14 && localHour < 17) return { period: 'afternoon', light: 'warm afternoon light, golden tones' };
  if (localHour >= 17 && localHour < 20) return { period: 'golden hour', light: 'golden hour sunset, dramatic warm light, long shadows' };
  if (localHour >= 20 && localHour < 22) return { period: 'dusk', light: 'blue hour twilight, city lights beginning to glow' };
  return { period: 'night', light: 'nighttime cityscape, illuminated buildings, dark blue sky' };
}

function getSeason(month) {
  if (month >= 3 && month <= 5)  return { season: 'spring', weather: 'fresh green trees, blooming flowers' };
  if (month >= 6 && month <= 8)  return { season: 'summer', weather: 'lush green foliage, warm atmosphere' };
  if (month >= 9 && month <= 11) return { season: 'autumn', weather: 'golden and red autumn leaves, crisp air' };
  return { season: 'winter', weather: 'bare trees, possible light snow, cold atmosphere' };
}

function getTimezoneOffset(country) {
  const offsets = {
    'Germany': 1, 'Austria': 1, 'Switzerland': 1,
    'France': 1, 'Italy': 1, 'Spain': 1, 'Netherlands': 1, 'Belgium': 1,
    'United Kingdom': 0, 'Portugal': 0, 'Ireland': 0,
    'Finland': 2, 'Greece': 2, 'Romania': 2, 'Turkey': 3,
    'United States': -5, 'Canada': -5, 'Brazil': -3,
    'Japan': 9, 'China': 8, 'India': 5, 'Australia': 10,
  };
  return offsets[country] ?? 1;
}

function resolveLandmark(city) {
  if (!city) return DEFAULT_LANDMARK;
  const key = city.toLowerCase().trim();
  if (CITY_LANDMARKS[key]) return CITY_LANDMARKS[key];
  for (const [k, v] of Object.entries(CITY_LANDMARKS)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return { landmark: `a famous landmark in ${city}`, city: city };
}

function buildImagePrompt(city, country) {
  const landmark = resolveLandmark(city);
  const now = new Date();
  const tzOffset = getTimezoneOffset(country);
  const timeInfo = getTimeOfDay(now.getUTCHours(), tzOffset);
  const seasonInfo = getSeason(now.getUTCMonth() + 1);
  const prompt = `Photorealistic wide-angle photograph of ${landmark.landmark} in ${landmark.city}, ${timeInfo.light}, ${seasonInfo.weather}, ${seasonInfo.season} season, professional architectural photography, 8k quality, cinematic composition`;
  const cacheKey = `${landmark.city.toLowerCase().replace(/\s+/g, '-')}-${timeInfo.period.replace(/\s+/g, '-')}-${seasonInfo.season}`;
  return { prompt, cacheKey, landmark, timeInfo, seasonInfo };
}

// --- ArrayBuffer ↔ Base64 ---

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// --- IP Lookup ---

async function lookupIP(ip) {
  const url = `http://ip-api.com/json/${ip}?fields=status,message,country,regionName,city,isp,org,as,query`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`IP API returned ${response.status}`);
    const data = await response.json();
    if (data.status === 'fail') return { success: false, error: data.message };
    return {
      success: true, ip: data.query, isp: data.isp || '', org: data.org || '',
      as: data.as || '', city: data.city || '', region: data.regionName || '', country: data.country || '',
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// --- Classify ---

function classifyVisitor(ipData) {
  if (!ipData.success) {
    return { type: 'unknown', company: null, label: 'Nicht erkannt', detail: 'IP-Lookup fehlgeschlagen' };
  }
  const org = (ipData.org || '').toLowerCase().trim();
  const isp = (ipData.isp || '').toLowerCase().trim();
  const orgIsISP = KNOWN_ISPS.has(org) || [...KNOWN_ISPS].some(k => org.includes(k));
  if (org && org !== isp && !orgIsISP) {
    return { type: 'b2b', company: ipData.org, label: 'Unternehmen erkannt', detail: `via ${ipData.isp} · ${ipData.city}, ${ipData.country}` };
  }
  if (org && !orgIsISP) {
    return { type: 'b2b', company: ipData.org, label: 'Organisation erkannt', detail: `${ipData.city}, ${ipData.country}` };
  }
  return { type: 'private', company: null, label: 'Privater Zugang', detail: `${ipData.isp} · ${ipData.city}, ${ipData.country}` };
}

function getPersonalizedContent(classification) {
  if (classification.type === 'b2b' && classification.company) {
    const key = classification.company.toLowerCase().trim();
    if (COMPANY_CONTENT[key]) return COMPANY_CONTENT[key];
    for (const [companyKey, content] of Object.entries(COMPANY_CONTENT)) {
      if (companyKey.startsWith('_')) continue;
      if (key.includes(companyKey) || companyKey.includes(key)) return content;
    }
    return COMPANY_CONTENT['_default_b2b'];
  }
  return COMPANY_CONTENT['_default_private'];
}

// --- Product Variant Content ---

const PRODUCT_VARIANTS = {
  mtb: {
    title: 'Giro Coalition Spherical – Der ultimative Trail-Helm für kompromisslose Rider',
    imageKey: 'product-variant-mtb',
  },
  safety: {
    title: 'Giro Coalition Spherical – Maximaler Schutz mit MIPS II für Ihr Kind',
    imageKey: 'product-variant-safety',
  },
};

const SHOP_URL = 'https://shop.grofa.com/de/p/giro-coalition-spherical-fahrradhelm-200285/?itemId=200285011';

// --- Shop Proxy: HTMLRewriter Handlers ---

class BaseTagHandler {
  element(element) {
    element.prepend('<base href="https://shop.grofa.com/">', { html: true });
  }
}

class ProductTitleHandler {
  constructor(newTitle) { this.newTitle = newTitle; }
  element(element) {
    element.setInnerContent(this.newTitle, { html: false });
  }
}

class ProductImageHandler {
  constructor(imageUrl) { this.imageUrl = imageUrl; this.replaced = false; }
  element(element) {
    if (this.replaced) return;
    const src = element.getAttribute('src') || '';
    if (src.includes('hero')) {
      element.setAttribute('src', this.imageUrl);
      if (element.getAttribute('data-bigimage')) {
        element.setAttribute('data-bigimage', this.imageUrl);
      }
      if (element.getAttribute('srcset')) {
        element.setAttribute('srcset', '');
      }
      this.replaced = true;
    }
  }
}

// --- Shop Proxy Handler ---

async function handleShopProxy(request, env, ctx) {
  const url = new URL(request.url);
  const variant = url.searchParams.get('variant') || 'original';
  const variantConfig = PRODUCT_VARIANTS[variant];

  // Fetch shop page
  const shopResponse = await fetch(SHOP_URL, {
    headers: {
      'User-Agent': request.headers.get('user-agent') || 'Mozilla/5.0',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
    },
  });

  // Clean response headers to allow iframe embedding
  const newHeaders = new Headers(shopResponse.headers);
  newHeaders.delete('x-frame-options');
  newHeaders.delete('content-security-policy');
  newHeaders.delete('content-security-policy-report-only');

  // Build HTMLRewriter — always inject base tag for relative URLs
  let rewriter = new HTMLRewriter()
    .on('head', new BaseTagHandler());

  // Apply content manipulation only for non-original variants
  if (variantConfig) {
    rewriter = rewriter.on('h1', new ProductTitleHandler(variantConfig.title));
    // Absolute URL so <base> tag doesn't redirect to shop.grofa.com
    const imageUrl = `${url.origin}/proxy/product-image?variant=${variant}`;
    rewriter = rewriter.on('img[itemprop="image"]', new ProductImageHandler(imageUrl));
  }

  const modifiedResponse = new Response(shopResponse.body, {
    status: shopResponse.status,
    headers: newHeaders,
  });

  return rewriter.transform(modifiedResponse);
}

// --- Serve product variant image from R2 ---

async function handleProductImage(request, env) {
  const url = new URL(request.url);
  const variant = url.searchParams.get('variant');
  const variantConfig = PRODUCT_VARIANTS[variant];

  if (!variantConfig) {
    return new Response('Unknown variant', { status: 404 });
  }

  const object = await env.IMAGE_CACHE.get(variantConfig.imageKey);
  if (!object) {
    return new Response('Image not found', { status: 404 });
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=86400');
  return new Response(object.body, { headers });
}

// --- BESV Demo: Variant Content ---

const BESV_URL = 'https://besv.eu/de/e-bike/trs-b-170-1-2/';

const BESV_VARIANTS = {
  trail: {
    claim: 'Mehr Höhenmeter, mehr Lines, mehr Kontrolle – das TRS‑B 170 1.2 ist dein E‑MTB für lange Nächte auf dem Trail.',
    description: 'Mit 170 mm vorne und 160 mm hinten, Bosch Performance CX Gen.5 mit 100 Nm und 800 Wh PowerTube-Akku holst du aus jedem Anstieg und jeder Abfahrt das Maximum heraus. Die Mullet-Laufradkombination gibt dir präzise Frontkontrolle und ein verspieltes Heck, während die RockShox-Fahrwerkskombi jeden Drop glattbügelt. Shimano Deore XT 12‑fach, 220/203 mm Vierkolbenbremsen und ein robuster Alloy‑Rahmen machen das TRS‑B 170 1.2 bereit für steile Lines, Bikepark‑Tage und lange Enduro‑Touren.',
    imageKey: 'besv-variant-trail',
  },
  speed: {
    claim: 'Dein Trail‑Bike für den Feierabend – und dein Trainingspartner für jede Steigung.',
    description: 'Wenn dein Arbeitsweg über Höhenmeter, Waldwege und grobe Passagen führt, bringt dich das TRS‑B 170 1.2 mit Bosch Performance CX Motor (100 Nm) und 800 Wh Akku mit Tempo und Reserven ans Ziel. Die 170/160 mm RockShox-Federung sorgt dafür, dass selbst ruppige Abschnitte ruhig bleiben, während Shimano Deore XT 12‑fach dir immer den richtigen Gang liefert. Die starken Vierkolbenbremsen mit 220/203 mm Scheiben geben dir Sicherheit, wenn es bergab schneller wird – egal ob auf dem Heimweg oder bei der Wochenendrunde.',
    imageKey: 'besv-variant-speed',
  },
  touring: {
    claim: 'Für alle, deren Alltag über Forstwege, Trails und Höhenmeter führt – ein E‑MTB mit Touren‑Reserven.',
    description: 'Du kombinierst lange Arbeitswege mit anspruchsvollem Gelände? Das TRS‑B 170 1.2 liefert mit Bosch Performance CX Motor, 800 Wh Akku und Shimano XT 12‑fach die Ausdauer und Schaltpräzision, die du für lange Tage im Sattel brauchst. Die 170/160 mm RockShox-Federung entschärft Wurzelteppiche und grobe Passagen, während die Maxxis Minion Bereifung dir Grip bei Nässe und auf Schotter gibt. Mit 160 kg zulässigem Gesamtgewicht bleibt auch mit Rucksack und Ausrüstung genug Reserve.',
    imageKey: 'besv-variant-touring',
  },
  urban: {
    claim: 'Tagsüber Alltag, abends Trail – ein E‑MTB für alle, die mehr wollen als nur von A nach B.',
    description: 'Du willst nach der Arbeit nicht auf Asphalt hängenbleiben? Das TRS‑B 170 1.2 verbindet einen modernen, markanten Look mit einem Paket für echte Offroad‑Performance. Der Bosch Performance CX Motor unterstützt dich kraftvoll auch auf steilen Rampen, während der 800 Wh Akku genug Kapazität für Arbeitsweg plus Abendrunde liefert. RockShox-Fahrwerk, Mullet-Laufräder und Shimano XT 12‑fach geben dir Sicherheit und Kontrolle, wenn aus der Feierabendstrecke spontan ein Trail‑Abenteuer wird.',
    imageKey: 'besv-variant-urban',
  },
  comfort: {
    claim: 'Sicher unterwegs – auch wenn der Weg mal ruppiger wird.',
    description: 'Wenn du wieder mehr in die Natur willst und dabei Reserven für unebene Wege suchst, bietet dir das TRS‑B 170 1.2 viel Sicherheit. Der Bosch Performance CX Motor unterstützt dich kraftvoll am Berg, während 170 mm Federweg vorne und 160 mm hinten Stöße abfedern und das Rad ruhig halten. Die starken Scheibenbremsen mit vier Kolben sorgen für kontrolliertes Abbremsen, selbst wenn es steil bergab geht – so kannst du dich auf die Aussicht konzentrieren.',
    imageKey: 'besv-variant-comfort',
  },
};

// --- BESV: HTMLRewriter Handlers ---

class BESVBaseTagHandler {
  element(element) {
    element.prepend('<base href="https://besv.eu/">', { html: true });
  }
}

class BESVShortDescriptionHandler {
  constructor(claim, description) { this.claim = claim; this.description = description; }
  element(element) {
    element.setInnerContent(
      `<p><strong>${this.claim}</strong><br />${this.description}</p>`,
      { html: true }
    );
  }
}

class BESVBannerImageHandler {
  constructor(imageUrl) { this.imageUrl = imageUrl; this.done = false; }
  element(element) {
    if (this.done) return;
    const style = element.getAttribute('style') || '';
    if (style.includes('background-image')) {
      const newStyle = style.replace(/background-image:\s*url\([^)]+\)/, `background-image:url(${this.imageUrl})`);
      element.setAttribute('style', newStyle);
      this.done = true;
    }
  }
}

// --- BESV: Rewrite font stylesheet link to proxy through our worker (CORS fix) ---

class BESVFontLinkRewriter {
  element(element) {
    const href = element.getAttribute('href') || '';
    if (href.includes('besv-by-dayz/font/stylesheet.css')) {
      element.setAttribute('href', '/proxy/besv-font/stylesheet.css');
    }
  }
}

// --- BESV: Serve font files from besv.eu through our origin ---

async function handleBESVFont(request) {
  const url = new URL(request.url);
  const fontPath = url.pathname.replace('/proxy/besv-font/', '');
  const fontUrl = `https://besv.eu/wp-content/themes/besv-by-dayz/font/${fontPath}`;

  const fontResponse = await fetch(fontUrl);
  const headers = new Headers(fontResponse.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', 'public, max-age=604800');
  return new Response(fontResponse.body, { status: fontResponse.status, headers });
}

// --- BESV Proxy Handler ---

async function handleBESVProxy(request, env, ctx) {
  const url = new URL(request.url);
  const variant = url.searchParams.get('variant') || 'original';
  const variantConfig = BESV_VARIANTS[variant];

  const besvResponse = await fetch(BESV_URL, {
    headers: {
      'User-Agent': request.headers.get('user-agent') || 'Mozilla/5.0',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
    },
  });

  const newHeaders = new Headers(besvResponse.headers);
  newHeaders.delete('x-frame-options');
  newHeaders.delete('content-security-policy');
  newHeaders.delete('content-security-policy-report-only');

  let rewriter = new HTMLRewriter()
    .on('head', new BESVBaseTagHandler())
    .on('link[href*="besv-by-dayz/font"]', new BESVFontLinkRewriter());

  if (variantConfig) {
    rewriter = rewriter
      .on('.woocommerce-product-details__short-description', new BESVShortDescriptionHandler(variantConfig.claim, variantConfig.description));

    if (variantConfig.imageKey) {
      const imageUrl = `${url.origin}/proxy/besv-image?variant=${variant}`;
      rewriter = rewriter
        .on('.single-product-banner-image div[style*="background-image"]', new BESVBannerImageHandler(imageUrl));
    }
  }

  const modifiedResponse = new Response(besvResponse.body, {
    status: besvResponse.status,
    headers: newHeaders,
  });

  return rewriter.transform(modifiedResponse);
}

// --- Serve BESV variant image from R2 ---

async function handleBESVImage(request, env) {
  const url = new URL(request.url);
  const variant = url.searchParams.get('variant');
  const variantConfig = BESV_VARIANTS[variant];

  if (!variantConfig || !variantConfig.imageKey) {
    return new Response('Unknown variant', { status: 404 });
  }

  const object = await env.IMAGE_CACHE.get(variantConfig.imageKey);
  if (!object) {
    return new Response('Image not found in R2', { status: 404 });
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/jpeg');
  headers.set('Cache-Control', 'public, max-age=86400');
  return new Response(object.body, { headers });
}

// --- HTMLRewriter Handlers (IP Detection Demo) ---

class InjectByID {
  constructor(contentMap) { this.contentMap = contentMap; }
  element(element) {
    const id = element.getAttribute('id');
    if (!id || !this.contentMap[id]) return;
    const config = this.contentMap[id];
    if (config.text !== undefined) element.setInnerContent(config.text, { html: false });
    if (config.html !== undefined) element.setInnerContent(config.html, { html: true });
    if (config.class) element.setAttribute('class', config.class);
  }
}

class InjectStatusDot {
  constructor(isB2B) { this.isB2B = isB2B; }
  element(element) {
    const dotClass = this.isB2B ? 'status-dot' : 'status-dot status-dot--unknown';
    element.prepend(`<span class="${dotClass}"></span>`, { html: true });
  }
}

class InjectHeroImage {
  constructor(imageSrc, imageInfo) { this.imageSrc = imageSrc; this.imageInfo = imageInfo; }
  element(element) {
    const html = `
    <div class="hero-image fade-in delay-1" style="margin-bottom: 32px; border-radius: 16px; overflow: hidden; border: 1px solid var(--border); position: relative;">
      <img src="${this.imageSrc}" alt="${this.imageInfo.landmark.landmark} in ${this.imageInfo.landmark.city}"
           style="width: 100%; height: 300px; object-fit: cover; display: block;" loading="eager" />
      <div style="position: absolute; bottom: 0; left: 0; right: 0; padding: 16px 20px;
                  background: linear-gradient(transparent, rgba(0,0,0,0.8));
                  font-size: 13px; color: rgba(255,255,255,0.9);">
        <strong>${this.imageInfo.landmark.city}</strong> · ${this.imageInfo.timeInfo.period} · ${this.imageInfo.seasonInfo.season}
        <span style="float: right; font-family: var(--mono); font-size: 10px; opacity: 0.6;">AI-generated</span>
      </div>
    </div>`;
    element.after(html, { html: true });
  }
}

// --- Get or generate image, always returns base64 data URI ---

async function getOrGenerateImage(imageInfo, env, ctx) {
  const { cacheKey, prompt } = imageInfo;

  // 1. Try R2 cache
  try {
    const cached = await env.IMAGE_CACHE.get(cacheKey);
    if (cached) {
      const buffer = await cached.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      return { src: `data:image/png;base64,${base64}`, source: 'r2-cache' };
    }
  } catch (e) {
    // Cache miss or error, continue to generation
  }

  // 2. Generate via Workers AI
  try {
    const aiResponse = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
      prompt: prompt,
      num_steps: 4,
    });

    // FLUX returns a ReadableStream — read it fully into an ArrayBuffer
    let imageBuffer;
    if (aiResponse instanceof ReadableStream) {
      const reader = aiResponse.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      imageBuffer = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        imageBuffer.set(chunk, offset);
        offset += chunk.length;
      }
      imageBuffer = imageBuffer.buffer;
    } else if (aiResponse instanceof ArrayBuffer) {
      imageBuffer = aiResponse;
    } else if (aiResponse.image) {
      // Some models return { image: base64string }
      const base64 = aiResponse.image;
      // Store raw in R2 async
      const binaryStr = atob(base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      ctx.waitUntil(
        env.IMAGE_CACHE.put(cacheKey, bytes.buffer, {
          httpMetadata: { contentType: 'image/png' },
          customMetadata: { prompt, generated: new Date().toISOString() },
        })
      );
      return { src: `data:image/png;base64,${base64}`, source: 'ai-generated' };
    } else {
      throw new Error('Unexpected AI response format');
    }

    // Convert to base64 for inline embedding
    const base64 = arrayBufferToBase64(imageBuffer);

    // Store in R2 async (don't block response)
    ctx.waitUntil(
      env.IMAGE_CACHE.put(cacheKey, imageBuffer, {
        httpMetadata: { contentType: 'image/png' },
        customMetadata: { prompt, generated: new Date().toISOString() },
      })
    );

    return { src: `data:image/png;base64,${base64}`, source: 'ai-generated' };
  } catch (e) {
    return { src: '', source: `error: ${e.message}` };
  }
}

// --- Main Worker ---

export default {
  async fetch(request, env, ctx) {
    const startTime = Date.now();
    const requestUrl = new URL(request.url);
    const pathname = requestUrl.pathname;

    // --- Routing ---

    // BESV font proxy (CORS fix for cross-origin @font-face)
    if (pathname.startsWith('/proxy/besv-font/')) {
      return handleBESVFont(request);
    }

    // BESV variant image from R2
    if (pathname === '/proxy/besv-image') {
      return handleBESVImage(request, env);
    }

    // BESV proxy for besv-demo
    if (pathname === '/proxy/besv') {
      return handleBESVProxy(request, env, ctx);
    }

    // BESV demo page → serve from Pages
    if (pathname === '/besv-demo') {
      const pagesUrl = new URL(request.url);
      pagesUrl.hostname = 'manipulation-demo.pages.dev';
      pagesUrl.pathname = '/besv-demo.html';
      return fetch(pagesUrl.toString());
    }

    // Product variant image from R2
    if (pathname === '/proxy/product-image') {
      return handleProductImage(request, env);
    }

    // Shop proxy for product demo
    if (pathname === '/proxy/shop') {
      return handleShopProxy(request, env, ctx);
    }

    // Product demo page → serve from Pages
    if (pathname === '/product-demo') {
      const pagesUrl = new URL(request.url);
      pagesUrl.hostname = 'manipulation-demo.pages.dev';
      pagesUrl.pathname = '/product-demo.html';
      return fetch(pagesUrl.toString());
    }

    // --- Existing IP Detection Demo ---

    const visitorIP = request.headers.get('cf-connecting-ip') || '0.0.0.0';

    // Bypass
    if (requestUrl.searchParams.get('utm_bypass') === 'true') {
      const pagesUrl = new URL(request.url);
      pagesUrl.hostname = 'manipulation-demo.pages.dev';
      return fetch(pagesUrl.toString());
    }

    // IP-Lookup
    const ipData = await lookupIP(visitorIP);
    const classification = classifyVisitor(ipData);
    const content = getPersonalizedContent(classification);
    const isB2B = classification.type === 'b2b';

    // Image: build prompt + get or generate
    const city = ipData.success ? ipData.city : '';
    const country = ipData.success ? ipData.country : '';
    const imageInfo = buildImagePrompt(city, country);

    // Parallel: fetch pages HTML + generate/load image
    const pagesUrl = new URL(request.url);
    pagesUrl.hostname = 'manipulation-demo.pages.dev';

    const [originResponse, imageResult] = await Promise.all([
      fetch(pagesUrl.toString()),
      getOrGenerateImage(imageInfo, env, ctx),
    ]);

    // Non-HTML passthrough
    const contentType = originResponse.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return originResponse;
    }

    const processingTime = Date.now() - startTime;

    const contentMap = {
      'status-label':         { text: isB2B ? '● Unternehmen erkannt' : '○ Privater Zugang' },
      'company-name':         { text: classification.company || 'Privatperson / Unbekannt', class: isB2B ? 'company-name company-name--b2b' : 'company-name' },
      'company-detail':       { text: classification.detail || '' },
      'visitor-ip':           { text: ipData.success ? ipData.ip : visitorIP },
      'visitor-org':          { text: ipData.success ? (ipData.org || ipData.isp || '–') : '–' },
      'visitor-location':     { text: ipData.success ? `${ipData.city}, ${ipData.region}, ${ipData.country}` : '–' },
      'visitor-asn':          { text: ipData.success ? (ipData.as || '–') : '–' },
      'personalized-title':   { text: content.title },
      'personalized-text':    { text: content.text },
      'cta-title':            { text: content.cta_title },
      'cta-text':             { text: content.cta_text },
      'cta-button':           { text: content.cta_button },
      'debug-classification': { text: `${classification.type} → ${classification.company || 'n/a'} | image: ${imageResult.source} (${imageInfo.cacheKey})` },
      'debug-timing':         { text: `${processingTime}ms (inkl. IP-Lookup + Image)` },
    };

    let rewriter = new HTMLRewriter()
      .on('[id]', new InjectByID(contentMap))
      .on('.detection-card__status', new InjectStatusDot(isB2B));

    // Hero image (only if we have one)
    if (imageResult.src) {
      rewriter = rewriter.on('.header', new InjectHeroImage(imageResult.src, imageInfo));
    }

    return rewriter.transform(originResponse);
  },
};
