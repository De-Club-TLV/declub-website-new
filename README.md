# De Club Website

Marketing website for **De Club** — a wellness club in Tel Aviv (2 Bar-Giyora St.) combining boxing, movement, yoga, recovery, and community.

**Live reference**: [declub.co.il](https://declub.co.il) (original Webflow site)

## Tech Stack

- Static HTML / CSS / JavaScript (no build step, no framework)
- GSAP for animations
- Images hosted on Webflow CDN

## Setup

```bash
# Clone the repo
git clone https://github.com/De-Club-TLV/declub-website-new.git

# No install or build needed — just open index.html or serve locally
npx serve .
```

## Folder Structure

```
├── index.html          # Homepage
├── vuca.html           # Boxing floor (VUCA)
├── art.html            # Movement/yoga/dance floor (ART)
├── livo.html           # Recovery floor (LIVO)
├── echo.html           # Lounge floor (ECHO)
├── community.html      # Trainers page
├── join.html           # Membership tiers
├── styles.css          # Global styles
├── pages.css           # Floor detail page styles
├── app.js              # Homepage JS (GSAP, scroll triggers)
├── pages.js            # Floor page JS (gallery, animations)
├── echo-floor.svg      # Isometric SVG for building animation
├── BRAND_BOOK.pdf      # Brand guidelines
├── Privacy Policy.pdf  # Legal
└── Terms Of Service.pdf
```

## Pages

| Page | File | Description |
|------|------|-------------|
| Home | `index.html` | Hero, about, isometric building, DeBox coffee, philosophy, join CTA |
| VUCA | `vuca.html` | Boxing floor — classes, gallery, trainers |
| ART | `art.html` | Movement/yoga/dance — classes, gallery |
| LIVO | `livo.html` | Recovery — breathwork, sauna, ice baths |
| ECHO | `echo.html` | Lounge — bar, sound, community space |
| Community | `community.html` | 14 trainers with hover bios |
| Join | `join.html` | Membership tiers (Full Access, VUCA Only, LIVO Only) |

## Contact

- Phone: +972542077057
- WhatsApp: https://wa.me/972542077057
- Instagram: @declub_tlv
- Address: 2 Bar-Giyora St., Tel Aviv
