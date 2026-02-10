// ============================================================
// Cloudflare Worker: Visitor Company Detection + HTML Manipulation
// ============================================================

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
  'cloudflare',
  'google llc',
  'apple inc.',
  'akamai',
  'amazon.com',
  'microsoft corporation',
  'digitalocean',
  'hetzner online gmbh',
  'ovh sas',
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

async function lookupIP(ip) {
  const url = `http://ip-api.com/json/${ip}?fields=status,message,country,regionName,city,isp,org,as,query`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`IP API returned ${response.status}`);
    const data = await response.json();
    if (data.status === 'fail') return { success: false, error: data.message };
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

// --- HTMLRewriter Handler: setzt Inhalt per Element-ID ---
class InjectByID {
  constructor(contentMap) {
    this.contentMap = contentMap;
  }
  element(element) {
    const id = element.getAttribute('id');
    if (!id || !this.contentMap[id]) return;
    const config = this.contentMap[id];
    if (config.text !== undefined) {
      element.setInnerContent(config.text, { html: false });
    }
    if (config.html !== undefined) {
      element.setInnerContent(config.html, { html: true });
    }
    if (config.class) {
      element.setAttribute('class', config.class);
    }
  }
}

class InjectStatusDot {
  constructor(isB2B) {
    this.isB2B = isB2B;
  }
  element(element) {
    const dotClass = this.isB2B ? 'status-dot' : 'status-dot status-dot--unknown';
    element.prepend(`<span class="${dotClass}"></span>`, { html: true });
  }
}

// --- Main ---
export default {
  async fetch(request, env, ctx) {
    const startTime = Date.now();
    const visitorIP = request.headers.get('cf-connecting-ip') || '0.0.0.0';

    const ipData = await lookupIP(visitorIP);
    const classification = classifyVisitor(ipData);
    const content = getPersonalizedContent(classification);
    const isB2B = classification.type === 'b2b';

    // HTML von Pages Origin holen
    const pagesUrl = new URL(request.url);
    pagesUrl.hostname = 'manipulation-demo.pages.dev';
    const originResponse = await fetch(pagesUrl.toString());

    const contentType = originResponse.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return originResponse;
    }

    const processingTime = Date.now() - startTime;

    const contentMap = {
      'status-label':        { text: isB2B ? '● Unternehmen erkannt' : '○ Privater Zugang' },
      'company-name':        { text: classification.company || 'Privatperson / Unbekannt', class: isB2B ? 'company-name company-name--b2b' : 'company-name' },
      'company-detail':      { text: classification.detail || '' },
      'visitor-ip':          { text: ipData.success ? ipData.ip : visitorIP },
      'visitor-org':         { text: ipData.success ? (ipData.org || ipData.isp || '–') : '–' },
      'visitor-location':    { text: ipData.success ? `${ipData.city}, ${ipData.region}, ${ipData.country}` : '–' },
      'visitor-asn':         { text: ipData.success ? (ipData.as || '–') : '–' },
      'personalized-title':  { text: content.title },
      'personalized-text':   { text: content.text },
      'cta-title':           { text: content.cta_title },
      'cta-text':            { text: content.cta_text },
      'cta-button':          { text: content.cta_button },
      'debug-classification': { text: `${classification.type} → ${classification.company || 'n/a'}` },
      'debug-timing':        { text: `${processingTime}ms (inkl. IP-Lookup)` },
    };

    return new HTMLRewriter()
      .on('[id]', new InjectByID(contentMap))
      .on('.detection-card__status', new InjectStatusDot(isB2B))
      .transform(originResponse);
  },
};
