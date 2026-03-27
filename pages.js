/* ============================================
   DE CLUB — Inner Pages JavaScript
   ============================================ */

gsap.registerPlugin(ScrollTrigger);

// ============================================
// Navigation (shared)
// ============================================
const nav = document.getElementById('nav');
const menuBtn = document.getElementById('menuBtn');
const menuOverlay = document.getElementById('menuOverlay');

window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 80);
});

menuBtn.addEventListener('click', () => {
    const isActive = menuBtn.classList.toggle('active');
    menuOverlay.classList.toggle('active', isActive);
    document.body.style.overflow = isActive ? 'hidden' : '';
});

document.querySelectorAll('.menu-link').forEach(link => {
    link.addEventListener('click', () => {
        menuBtn.classList.remove('active');
        menuOverlay.classList.remove('active');
        document.body.style.overflow = '';
    });
});

document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.querySelector(anchor.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
});

// ============================================
// Accordion (shared)
// ============================================
document.querySelectorAll('.accordion-trigger').forEach(trigger => {
    trigger.addEventListener('click', () => {
        const item = trigger.parentElement;
        const isActive = item.classList.contains('active');
        document.querySelectorAll('.accordion-item').forEach(i => i.classList.remove('active'));
        if (!isActive) item.classList.add('active');
    });
});

// ============================================
// Page Animations
// ============================================

// Floor hero parallax
const floorHeroBg = document.querySelector('.floor-hero-bg img');
if (floorHeroBg) {
    gsap.to(floorHeroBg, {
        y: '15%',
        ease: 'none',
        scrollTrigger: {
            trigger: '.floor-hero',
            start: 'top top',
            end: 'bottom top',
            scrub: 1
        }
    });
}

// Hero content entrance
gsap.from('.floor-hero-content > *', {
    opacity: 0, y: 30, duration: 0.8, stagger: 0.12, delay: 0.3, ease: 'power3.out'
});

// Section reveals
document.querySelectorAll('.section-tag').forEach(tag => {
    gsap.from(tag, {
        scrollTrigger: { trigger: tag, start: 'top 85%' },
        opacity: 0, y: 20, duration: 0.6
    });
});

document.querySelectorAll('.section-title').forEach(title => {
    gsap.from(title, {
        scrollTrigger: { trigger: title, start: 'top 85%' },
        opacity: 0, y: 30, duration: 0.8, delay: 0.1
    });
});

// Class cards
document.querySelectorAll('.class-card').forEach((card, i) => {
    gsap.from(card, {
        scrollTrigger: { trigger: card, start: 'top 85%' },
        opacity: 0, y: 30, duration: 0.6, delay: i * 0.08
    });
});

// Gallery images
document.querySelectorAll('.gallery-grid img').forEach((img, i) => {
    gsap.from(img, {
        scrollTrigger: { trigger: img, start: 'top 88%' },
        opacity: 0, y: 20, duration: 0.6, delay: i * 0.06
    });
});

// Highlights
gsap.from('.highlights-text > *', {
    scrollTrigger: { trigger: '.highlights-section', start: 'top 70%' },
    opacity: 0, y: 25, duration: 0.7, stagger: 0.1
});

gsap.from('.highlights-image', {
    scrollTrigger: { trigger: '.highlights-section', start: 'top 70%' },
    opacity: 0, x: 30, duration: 0.8
});

// Ideal section
gsap.from('.ideal-text', {
    scrollTrigger: { trigger: '.ideal-section', start: 'top 75%' },
    opacity: 0, y: 25, duration: 0.8
});

// Mid CTAs
document.querySelectorAll('.mid-cta').forEach(cta => {
    gsap.from(cta.children[0].children, {
        scrollTrigger: { trigger: cta, start: 'top 85%' },
        opacity: 0, y: 20, duration: 0.6, stagger: 0.08
    });
});

// Trainer cards
document.querySelectorAll('.trainer-card').forEach((card, i) => {
    gsap.from(card, {
        scrollTrigger: { trigger: card, start: 'top 85%' },
        opacity: 0, y: 30, duration: 0.6, delay: i * 0.1
    });
});

// Value cards
document.querySelectorAll('.value-card').forEach((card, i) => {
    gsap.from(card, {
        scrollTrigger: { trigger: card, start: 'top 85%' },
        opacity: 0, y: 25, duration: 0.6, delay: i * 0.1
    });
});

// Tier cards
document.querySelectorAll('.tier-card').forEach((card, i) => {
    gsap.from(card, {
        scrollTrigger: { trigger: card, start: 'top 85%' },
        opacity: 0, y: 30, duration: 0.7, delay: i * 0.1
    });
});

// FAQ accordion
document.querySelectorAll('.accordion-item').forEach((item, i) => {
    gsap.from(item, {
        scrollTrigger: { trigger: item, start: 'top 88%' },
        opacity: 0, y: 15, duration: 0.5, delay: i * 0.06
    });
});

// Bottom CTA
const joinContent = document.querySelector('.join .join-content');
if (joinContent) {
    gsap.from(joinContent.children, {
        scrollTrigger: { trigger: '.join', start: 'top 90%' },
        opacity: 0, y: 25, duration: 0.6, stagger: 0.06
    });
}

// Next floor
const nextFloor = document.querySelector('.next-floor');
if (nextFloor) {
    gsap.from('.next-floor-inner > *', {
        scrollTrigger: { trigger: nextFloor, start: 'top 85%' },
        opacity: 0, y: 20, duration: 0.6, stagger: 0.1
    });
}

// Footer
gsap.from('.footer-grid > *', {
    scrollTrigger: { trigger: '.footer', start: 'top 90%' },
    opacity: 0, y: 20, duration: 0.5, stagger: 0.08
});

// Community hero
const commHero = document.querySelector('.community-hero');
if (commHero) {
    gsap.from('.community-hero > *', {
        opacity: 0, y: 30, duration: 0.8, stagger: 0.12, delay: 0.3
    });
}

// Join hero
const joinHero = document.querySelector('.join-hero');
if (joinHero) {
    gsap.from('.join-hero > *', {
        opacity: 0, y: 30, duration: 0.8, stagger: 0.12, delay: 0.3
    });
}
