// ============================================================
// Cloudflare Worker: Visitor Company Detection + HTML Manipulation
// ============================================================
// 
// SETUP:
// 1. Deploy index.html to Cloudflare Pages (z.B. "company-detect.pages.dev")
// 2. Erstelle einen Cloudflare Worker mit diesem Code
// 3. Füge eine Route hinzu, die den Worker VOR die Pages-Domain schaltet
//    ODER: nutze den Worker als Custom Domain / Worker Route
//
// ARCHITEKTUR:
// Request → Worker → IP-Lookup (ip-api.com) → Klassifizierung → 
// HTMLRewriter injiziert personalisierte Inhalte → Response an Besucher
// ============================================================

// --- Konfiguration ---

// Bekannte ISP-Namen, die NICHT als Unternehmen gelten
const KNOWN_ISPS = new Set([
  'deutsche telekom ag',
  'telekom deutschland gmbh',
  'vodafone gmbh',
  'vodafone deutschland gmbh',
  'vodafone cable germany',
  'telefonica germany',
  'telefonica germany gmbh & co. ohg',
  'o2 germany',
  '1&1 versatel',
  '1&1 internet ag',
  '1&1 telecom gmbh',
  'unitymedia',
  'liberty global',
  'freenet datenkommunikations gmbh',
  'netcologne',
  'ewe tel gmbh',
  'm-net telekommunikations gmbh',
  'htp gmbh',
  'comcast',
  'comcast cable communications',
  'at&t services',
  'verizon',
  'verizon business',
  'charter communications',
  'spectrum',
  'cox communications',
  'bt',
  'sky broadband',
  'virgin media',
  'orange',
  'bouygues telecom',
  'swisscom',
  'a1 telekom austria',
  'sunrise',
  'upc',
  'kpn',
  'ziggo',
  'telia',
  'telenor',
  'cloudflare',       // Cloudflare WARP users
  'google llc',       // Google DNS / VPN
  'apple inc.',       // iCloud Private Relay
  'akamai',
  'amazon.com',       // AWS-based VPNs
  'microsoft corporation',
  'digitalocean',
  'hetzner online gmbh',
  'ovh sas',
]);

// Beispielhafte Personalisierung pro erkanntem Unternehmen
// In Produktion: aus KV Store, D1 Database oder externem CRM laden
const COMPANY_CONTENT = {
  // Fallback für erkannte B2B-Besucher ohne spezifischen Content
  '_default_b2b': {
    title: 'Willkommen aus der Unternehmenswelt',
    text: 'Wir haben erkannt, dass Sie aus einem Unternehmenskontext auf unsere Seite zugreifen. Gerne zeigen wir Ihnen, wie unsere Lösungen speziell für Ihr Unternehmen Mehrwert schaffen können.',
    cta_title: 'Enterprise-Lösungen entdecken',
    cta_text: 'Maßgeschneiderte Pakete für Ihr Unternehmen',
    cta_button: 'Demo vereinbaren',
  },
  // Fallback für Privatpersonen / unbekannte Besucher
  '_default_private': {
    title: 'Willkommen!',
    text: 'Entdecke unsere Produkte und Services. Egal ob für dich persönlich oder dein Team – wir haben die passende Lösung.',
    cta_title: 'Jetzt loslegen',
    cta_text: 'Starte kostenlos und überzeuge dich selbst.',
    cta_button: 'Kostenlos testen',
  },

  // === Beispiele für unternehmensspezifische Inhalte ===
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


// --- IP Lookup ---

async function lookupIP(ip) {
  // ip-api.com: kostenlos, kein API-Key nötig, 45 req/min
  // In Produktion: Caching via Cloudflare KV oder Cache API nutzen!
  const url = `http://ip-api.com/json/${ip}?fields=status,message,country,regionName,city,isp,org,as,query`;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`IP API returned ${response.status}`);
    const data = await response.json();

    if (data.status === 'fail') {
      return { success: false, error: data.message };
    }

    return {
      success: true,
      ip: data.query,
      isp: data.isp || '',
      org: data.org || '',
      as: data.as || '',
      city: data.city || '',
      region: data.regionName || '',
      country: data.country || '',
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}


// --- Klassifizierung ---

function classifyVisitor(ipData) {
  if (!ipData.success) {
    return {
      type: 'unknown',
      company: null,
      label: 'Nicht erkannt',
      detail: 'IP-Lookup fehlgeschlagen',
    };
  }

  const org = (ipData.org || '').toLowerCase().trim();
  const isp = (ipData.isp || '').toLowerCase().trim();

  // Prüfe ob Organisation ein bekannter ISP ist
  const orgIsISP = KNOWN_ISPS.has(org) || [...KNOWN_ISPS].some(k => org.includes(k));
  const ispIsISP = KNOWN_ISPS.has(isp) || [...KNOWN_ISPS].some(k => isp.includes(k));

  // Wenn org ≠ isp UND org kein bekannter ISP → wahrscheinlich Unternehmen
  if (org && org !== isp && !orgIsISP) {
    return {
      type: 'b2b',
      company: ipData.org,
      label: 'Unternehmen erkannt',
      detail: `via ${ipData.isp} · ${ipData.city}, ${ipData.country}`,
    };
  }

  // Wenn org == isp oder org ist ISP → Privatperson
  if (orgIsISP || ispIsISP || !org) {
    return {
      type: 'private',
      company: null,
      label: 'Privater Zugang',
      detail: `${ipData.isp} · ${ipData.city}, ${ipData.country}`,
    };
  }

  // Edge case: org existiert, ist kein bekannter ISP, aber gleich wie ISP
  // → könnte trotzdem ein Unternehmen sein (z.B. Uni-Netze)
  if (org && !orgIsISP) {
    return {
      type: 'b2b',
      company: ipData.org,
      label: 'Organisation erkannt',
      detail: `${ipData.city}, ${ipData.country}`,
    };
  }

  return {
    type: 'unknown',
    company: null,
    label: 'Nicht klassifiziert',
    detail: `${ipData.isp} · ${ipData.city}, ${ipData.country}`,
  };
}


// --- Content Resolution ---

function getPersonalizedContent(classification) {
  if (classification.type === 'b2b' && classification.company) {
    const key = classification.company.toLowerCase().trim();
    // Exakte Übereinstimmung
    if (COMPANY_CONTENT[key]) return COMPANY_CONTENT[key];
    // Teilübereinstimmung
    for (const [companyKey, content] of Object.entries(COMPANY_CONTENT)) {
      if (companyKey.startsWith('_')) continue;
      if (key.includes(companyKey) || companyKey.includes(key)) return content;
    }
    return COMPANY_CONTENT['_default_b2b'];
  }
  return COMPANY_CONTENT['_default_private'];
}


// --- HTMLRewriter Handlers ---

class PlaceholderRewriter {
  constructor(replacements) {
    this.replacements = replacements;
  }

  element(element) {
    // Inject status dot class
    const id = element.getAttribute('id');
    if (id && this.replacements[id]?.class) {
      element.setAttribute('class', 
        (element.getAttribute('class') || '') + ' ' + this.replacements[id].class
      );
    }
  }

  text(text) {
    for (const [placeholder, value] of Object.entries(this.replacements)) {
      if (typeof value === 'string' && text.text.includes(placeholder)) {
        text.replace(text.text.replace(placeholder, value), { html: true });
      }
    }
  }
}

// Spezialhandler für den Status-Dot (wird als HTML eingefügt)
class StatusDotInjector {
  constructor(isB2B) {
    this.isB2B = isB2B;
    this.done = false;
  }

  text(text) {
    if (!this.done && text.text.includes('<!--DETECTION_STATUS_DOT-->')) {
      const dotClass = this.isB2B ? 'status-dot' : 'status-dot status-dot--unknown';
      text.replace(`<span class="${dotClass}"></span>`, { html: true });
      this.done = true;
    }
  }
}


// --- Main Worker ---

export default {
  async fetch(request, env, ctx) {
    const startTime = Date.now();

    // Besucher-IP ermitteln (Cloudflare liefert die immer im Header)
    const visitorIP = request.headers.get('cf-connecting-ip') || '0.0.0.0';

    // IP-Lookup durchführen
    const ipData = await lookupIP(visitorIP);

    // Klassifizierung
    const classification = classifyVisitor(ipData);

    // Personalisierte Inhalte auflösen
    const content = getPersonalizedContent(classification);

    // Ursprüngliche Seite von Pages holen
    // WICHTIG: URL anpassen auf deine Cloudflare Pages Domain!
    const pagesUrl = new URL(request.url);
    // Option A: Wenn Worker als Route VOR Pages → einfach fetch(request) weiterleiten
    // Option B: Wenn Worker standalone → Origin-URL setzen:
    // pagesUrl.hostname = 'dein-projekt.pages.dev';
    const originResponse = await fetch(request);

    // Check ob HTML
    const contentType = originResponse.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return originResponse; // Nicht-HTML-Assets direkt durchreichen
    }

    const processingTime = Date.now() - startTime;

    // Replacements definieren
    const isB2B = classification.type === 'b2b';
    const companyNameClass = isB2B ? 'company-name company-name--b2b' : 'company-name';

    // HTMLRewriter anwenden
    const rewritten = new HTMLRewriter()
      // Status Dot
      .on('.detection-card__status', new StatusDotInjector(isB2B))
      // Company Name Klasse
      .on('#company-name', {
        element(el) { el.setAttribute('class', companyNameClass); }
      })
      // Alle Text-Platzhalter ersetzen
      .on('*', new PlaceholderRewriter({
        '<!--DETECTION_STATUS_LABEL-->': isB2B ? '● Unternehmen erkannt' : '○ Privater Zugang',
        '<!--DETECTION_COMPANY_NAME-->': classification.company || 'Privatperson / Unbekannt',
        '<!--DETECTION_COMPANY_DETAIL-->': classification.detail || '',
        '<!--VISITOR_IP-->': ipData.success ? ipData.ip : visitorIP,
        '<!--VISITOR_ORG-->': ipData.success ? (ipData.org || ipData.isp || '–') : '–',
        '<!--VISITOR_LOCATION-->': ipData.success ? `${ipData.city}, ${ipData.region}, ${ipData.country}` : '–',
        '<!--VISITOR_ASN-->': ipData.success ? (ipData.as || '–') : '–',
        '<!--PERSONALIZED_TITLE-->': content.title,
        '<!--PERSONALIZED_TEXT-->': content.text,
        '<!--CTA_TITLE-->': content.cta_title,
        '<!--CTA_TEXT-->': content.cta_text,
        '<!--CTA_BUTTON-->': content.cta_button,
        '<!--DEBUG_CLASSIFICATION-->': `${classification.type} → ${classification.company || 'n/a'}`,
        '<!--DEBUG_TIMING-->': `${processingTime}ms (inkl. IP-Lookup)`,
      }))
      .transform(originResponse);

    return rewritten;
  },
};
