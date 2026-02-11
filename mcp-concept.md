# Konzept: Content Manipulation MCP

## 1. Überblick

Ein System aus zwei Komponenten, das es ermöglicht, über einen MCP-Server beliebige Webseiten zu proxyen und deren Inhalte segmentspezifisch zu manipulieren — ohne pro Demo Code schreiben oder deployen zu müssen.

| Komponente | Rolle |
|---|---|
| **Generic Worker** | Rendert Demos, proxyt Zielseiten, wendet Manipulationen an, liefert Bilder aus, **und** bietet eine Admin-API für den MCP-Server |
| **MCP Server** | Dünner Client, der die Admin-API des Workers aufruft. Wird von Claude Code / Claude Desktop genutzt |

```
Claude Code + MCP Server
        │
        │ HTTP (Bearer Token)
        ▼
┌─────────────────────────────────────┐
│          Generic Worker             │
│                                     │
│  Public Routes:                     │
│    /demo/:slug        → Control UI  │
│    /proxy/:slug       → Proxy+Rewrite│
│    /proxy/:slug/image → R2 Image    │
│                                     │
│  Admin API:                         │
│    /api/demos         → CRUD        │
│    /api/demos/:slug/images → Upload │
│    /api/analyze       → Page Fetch  │
│                                     │
│  Bindings:                          │
│    KV: DEMO_CONFIG                  │
│    R2: DEMO_IMAGES                  │
└─────────────────────────────────────┘
```

---

## 2. Generic Worker

### 2.1 Routing

```
Public (kein Auth):
  GET  /demo/:slug                → Generierte Control-Page (HTML)
  GET  /proxy/:slug?variant=X     → Proxy der Zielseite mit Manipulation
  GET  /proxy/:slug/image?variant=X → Varianten-Bild aus R2

Admin API (Bearer Token):
  GET    /api/demos               → Alle Demos auflisten
  GET    /api/demos/:slug         → Demo-Config lesen
  PUT    /api/demos/:slug         → Demo erstellen/aktualisieren
  DELETE /api/demos/:slug         → Demo + Bilder löschen
  POST   /api/demos/:slug/images/:variant → Bild hochladen
  DELETE /api/demos/:slug/images/:variant → Bild löschen
  POST   /api/analyze             → Zielseite abrufen, HTML zurückgeben
```

### 2.2 Control-Page-Generierung

Der Worker generiert die Control-Page dynamisch aus der Config — kein statisches HTML nötig:

```js
function renderControlPage(config) {
  const buttons = Object.entries(config.variants)
    .map(([key, v]) => `<button data-variant="${key}">${v.label}</button>`)
    .join('');

  return `<!DOCTYPE html>
  <html><head>...</head>
  <body>
    <div class="toolbar">
      <span class="toolbar__title">${config.title}</span>
      <button data-variant="original" class="active">Original</button>
      ${buttons}
    </div>
    <iframe id="frame" src="/proxy/${config.slug}?variant=original"></iframe>
    <script>
      document.querySelectorAll('button[data-variant]').forEach(btn => {
        btn.onclick = () => {
          frame.src = '/proxy/${config.slug}?variant=' + btn.dataset.variant;
        };
      });
    </script>
  </body></html>`;
}
```

### 2.3 Dynamischer HTMLRewriter

Der Worker liest die Config und baut den HTMLRewriter zur Laufzeit:

```js
async function handleProxy(slug, variant, request, env) {
  const config = JSON.parse(await env.DEMO_CONFIG.get(slug));
  const variantData = config.variants[variant];

  const response = await fetch(config.targetUrl, { ... });

  // Header bereinigen (immer)
  const headers = new Headers(response.headers);
  headers.delete('x-frame-options');
  headers.delete('content-security-policy');

  let rewriter = new HTMLRewriter();

  // Base-Tag (immer)
  if (config.baseHref) {
    rewriter = rewriter.on('head', {
      element(el) { el.prepend(`<base href="${config.baseHref}">`, { html: true }); }
    });
  }

  // Felder nur bei nicht-original Varianten
  if (variant !== 'original' && variantData) {
    for (const field of config.fields) {
      const value = variantData.content[field.id];
      if (value === undefined) continue;

      switch (field.type) {
        case 'text':
          rewriter = rewriter.on(field.selector, {
            element(el) { el.setInnerContent(value, { html: false }); }
          });
          break;

        case 'html':
          rewriter = rewriter.on(field.selector, {
            element(el) { el.setInnerContent(value, { html: true }); }
          });
          break;

        case 'template':
          rewriter = rewriter.on(field.selector, {
            element(el) {
              let html = field.template;
              for (const [k, v] of Object.entries(variantData.content)) {
                html = html.replaceAll(`{{${k}}}`, v);
              }
              el.setInnerContent(html, { html: true });
            }
          });
          break;

        case 'background-image':
          rewriter = rewriter.on(field.selector, {
            element(el) {
              const style = el.getAttribute('style') || '';
              el.setAttribute('style',
                style.replace(/background-image:\s*url\([^)]+\)/,
                  `background-image:url(${imageUrl})`));
            }
          });
          break;

        case 'image-src':
          rewriter = rewriter.on(field.selector, {
            element(el) { el.setAttribute('src', imageUrl); }
          });
          break;
      }
    }
  }

  return rewriter.transform(new Response(response.body, { headers }));
}
```

---

## 3. Config-Format

Wird als JSON in KV gespeichert. Key = Slug.

```json
{
  "slug": "besv-trs",
  "title": "Tailor-Made Product Content for BESV",
  "targetUrl": "https://besv.eu/de/e-bike/trs-b-170-1-2/",
  "baseHref": "https://besv.eu/",
  "fetchHeaders": {
    "Accept-Language": "de-DE,de;q=0.9"
  },
  "fields": [
    {
      "id": "hero",
      "label": "Hero Section (Claim + Description)",
      "selector": ".woocommerce-product-details__short-description",
      "type": "template",
      "template": "<p><strong>{{claim}}</strong><br />{{description}}</p>"
    },
    {
      "id": "banner",
      "label": "Banner Image",
      "selector": ".single-product-banner-image div[style*='background-image']",
      "type": "background-image"
    }
  ],
  "variants": {
    "trail": {
      "label": "Trail-Enthusiast",
      "content": {
        "claim": "Mehr Höhenmeter, mehr Lines...",
        "description": "Mit 170 mm vorne und 160 mm hinten...",
        "banner": "besv-trs/trail.png"
      }
    },
    "speed": {
      "label": "Speed-Pendler",
      "content": {
        "claim": "Dein Trail-Bike für den Feierabend...",
        "description": "Wenn dein Arbeitsweg über Höhenmeter...",
        "banner": "besv-trs/speed.png"
      }
    }
  }
}
```

### Feld-Typen

| Typ | Aktion | Beispiel |
|---|---|---|
| `text` | `setInnerContent(value, html:false)` | Produkttitel |
| `html` | `setInnerContent(value, html:true)` | Beschreibungsblock |
| `template` | Template mit `{{placeholders}}` | Claim + Description kombiniert |
| `background-image` | `style`-Attribut `background-image:url(...)` | Banner-Hintergrund |
| `image-src` | `src`-Attribut ersetzen | Produktbild |
| `attribute` | Beliebiges Attribut | `data-*`, `href`, etc. |

---

## 4. MCP Server

### 4.1 Tools

```typescript
// 1. Seite analysieren — gibt HTML-Struktur zurück,
//    Claude interpretiert die Selektoren
analyze_page(url: string)
  → { html: string, title: string, status: number }

// 2. Demo erstellen/aktualisieren
create_demo(config: DemoConfig)
  → { slug: string, url: string }

// 3. Variante aktualisieren
update_variant(slug: string, variant: string, content: Record<string, string>)
  → { success: boolean }

// 4. Bild hochladen (base64 oder Dateipfad)
upload_image(slug: string, variant: string, fieldId: string, imagePath: string)
  → { key: string }

// 5. Demos auflisten
list_demos()
  → { demos: Array<{ slug, title, url }> }

// 6. Demo lesen
get_demo(slug: string)
  → DemoConfig

// 7. Demo löschen
delete_demo(slug: string)
  → { success: boolean }
```

### 4.2 Kommunikation

Der MCP-Server ist ein dünner HTTP-Client gegen die Worker Admin-API:

```
MCP Tool Call → HTTP Request an Worker /api/* → KV/R2
```

Auth: Ein `ADMIN_SECRET` als Bearer Token. Wird als Environment-Variable im MCP-Server konfiguriert und als Secret im Worker hinterlegt.

### 4.3 MCP Config (für Claude Code)

```json
{
  "mcpServers": {
    "content-manipulation": {
      "command": "node",
      "args": ["./mcp-server/dist/index.js"],
      "env": {
        "WORKER_URL": "https://content-manipulation.workers.dev",
        "ADMIN_SECRET": "..."
      }
    }
  }
}
```

---

## 5. Workflow: Neue Demo erstellen

So würde ein typischer Prompt-Flow aussehen, wenn der MCP aktiv ist:

**User:** *"Erstelle eine Demo für https://example.com/product/xyz mit drei Personas: Sportler, Familie, Senior"*

**Claude:**
1. `analyze_page("https://example.com/product/xyz")` → bekommt HTML
2. Claude identifiziert Selektoren: Titel = `h1.product-name`, Bild = `img.hero`, Beschreibung = `.product-desc`
3. Claude fragt nach: *"Ich sehe folgende manipulierbare Elemente: Titel, Hero-Bild, Beschreibung. Welche sollen wir pro Persona ändern?"*
4. User bestätigt / gibt Texte und Bilder an
5. `create_demo({ slug: "example-xyz", targetUrl: "...", fields: [...], variants: {...} })`
6. `upload_image("example-xyz", "sportler", "hero", "/path/to/sportler.jpg")`
7. *"Demo ist live unter /demo/example-xyz"*

---

## 6. Cloudflare-Ressourcen

| Ressource | Name | Binding |
|---|---|---|
| Worker | `content-manipulation` | — |
| KV Namespace | `demo-configs` | `DEMO_CONFIG` |
| R2 Bucket | `demo-images` | `DEMO_IMAGES` |
| Secret | `ADMIN_SECRET` | `ADMIN_SECRET` |

```jsonc
// wrangler.jsonc
{
  "name": "content-manipulation",
  "main": "worker/worker.js",
  "compatibility_date": "2026-02-11",
  "kv_namespaces": [
    { "binding": "DEMO_CONFIG", "id": "..." }
  ],
  "r2_buckets": [
    { "binding": "DEMO_IMAGES", "bucket_name": "demo-images" }
  ]
}
```

---

## 7. Projekt-Struktur

```
content-manipulation-mcp/
├── worker/
│   └── worker.js              # Generischer Worker (Public + Admin API)
├── mcp-server/
│   ├── src/
│   │   ├── index.ts           # MCP Server Entry
│   │   ├── tools.ts           # Tool-Implementierungen
│   │   └── cloudflare.ts      # HTTP Client für Worker Admin API
│   ├── package.json
│   └── tsconfig.json
├── wrangler.jsonc
├── package.json
└── .gitignore
```

---

## 8. Offene Fragen / Entscheidungen

1. **Bestehende Demos migrieren?** — Die BESV- und Giro-Demos als Config in das neue System übertragen, oder parallel laufen lassen?

2. **Seitenanalyse** — Reicht es, das rohe HTML an Claude zurückzugeben, oder soll der MCP schon eine strukturierte Analyse machen (z.B. alle `h1`-`h6`, alle `img`, alle Elemente mit `class`)?

3. **Multi-Selector-Support** — Soll ein Feld mehrere Selektoren unterstützen (z.B. Bild in Gallery UND im Banner ersetzen)?

4. **Live-Preview** — Soll der MCP ein `preview_variant` Tool haben, das den manipulierten HTML-Output zurückgibt, bevor die Config gespeichert wird?
