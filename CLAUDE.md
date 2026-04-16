# De Club Website

## Overview
De Club is a wellness club in Tel Aviv (2 Bar-Giyora St.) combining boxing, movement, yoga, recovery, and community. This is the marketing website with lead generation.

## Tech Stack
- **Static HTML/CSS/JS** (no build step, no framework)
- **GitHub**: https://github.com/De-Club-TLV/declub-website-new
- **Original site reference**: https://declub.co.il (built on Webflow)

## Pages
| Page | File | Description |
|------|------|-------------|
| Home | `index.html` | Hero video, about section, 4-floor isometric building animation, DeBox coffee, experience, philosophy, join CTA |
| VUCA | `vuca.html` | Boxing floor. Classes, gallery, trainers |
| ART | `art.html` | Movement/yoga/dance floor. Classes, gallery |
| LIVO | `livo.html` | Recovery floor. Breathwork, sauna, ice baths, contrast therapy |
| ECHO | `echo.html` | Lounge floor. Bar, sound system, community space |
| Community | `community.html` | 14 trainers with hover-to-reveal bios, original grid layout from declub.co.il |
| Join | `join.html` | Membership tiers (Full Access, VUCA Only, LIVO Only) |

## Design System
- **Colors**: `--color-bg: #0a0a08` (near black), `--color-sage: #b0c290` (sage green for CTAs), `--color-cream: #f5f0e8`, `--color-green: #d1dcbd`, `--color-brown: #8f8b7e`
- **Fonts**: Figtree (headings), IBM Plex Mono (body/details)
- **Style**: Dark, minimal, premium wellness aesthetic. Rounded corners (20-60px). No em dashes in copy.
- **Logo SVG**: `https://cdn.prod.website-files.com/68cff027ea83674e59a4438a/68cff1151ce82cd6aef9bf30_logo-declub.svg`
- **Logo PNG**: `logo.png` (white on transparent)

## Key Files
- `styles.css` - Global styles, nav, hero, sections, footer, contact modal
- `pages.css` - Floor detail page styles (hero, classes grid, gallery, CTAs)
- `app.js` - Homepage JS (GSAP animations, floor building, scroll triggers)
- `pages.js` - Floor page JS (gallery, scroll animations)
- `echo-floor.svg` - Isometric SVG for Echo floor in the building animation

## Contact Modal
Every CTA button across all pages opens a contact popup (not a page navigation). The modal collects:
- Name, Phone, Email
- "Talk with us now" WhatsApp link

### Webhook
Form submissions POST to: `https://n8n.declub.co.il/webhook/446c500d-6649-4f06-bc06-59dbd087b6e4`

Payload includes UTM tracking:
```json
{
  "name": "", "phone": "", "email": "",
  "source": "/",
  "url": "full page URL",
  "utm_source": "", "utm_medium": "", "utm_campaign": "",
  "utm_content": "", "utm_term": "",
  "referrer": ""
}
```

## Images & Assets
All images are hotlinked from the original Webflow CDN:
- `cdn.prod.website-files.com/68cff027ea83674e59a4438a/` (site assets)
- `cdn.prod.website-files.com/68d7b102c2950a7075801556/` (CMS/dynamic assets)

Trainer photos, floor images, gallery images, and hero backgrounds all come from these CDN URLs.

## Deployment
Static site, no build command needed.

## Contact Info
- **Phone**: +972542077057
- **WhatsApp**: https://wa.me/972542077057
- **Instagram**: @declub_tlv
- **Address**: 2 Bar-Giyora St., Tel Aviv

## Copy Guidelines
- No em dashes (looks AI-generated)
- Avoid "fight" or aggressive language. This is wellness, not combat
- Tone: magical, one-of-a-kind, wellness as a way of life
- The place combines health, movement, community, and something hard to define
- DeBox (coffee place outside) is separate from the floors

## Community Page
Matches the original declub.co.il/community layout exactly:
- 4-column grid (2 on tablet, 2 on mobile)
- Cards with 2:3 aspect ratio, 20px border radius
- Trainer bios appear on **hover** (not click)
- Dark gradient overlay on hover for readability
- 14 trainers total with real photos from CDN
