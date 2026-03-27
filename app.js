/* ============================================
   DE CLUB — Main JavaScript
   ============================================ */

// Register GSAP plugins
gsap.registerPlugin(ScrollTrigger);

// ============================================
// Preloader
// ============================================
const preloader = document.getElementById('preloader');
const preloaderFill = document.querySelector('.preloader-fill');
let progress = 0;

const preloaderInterval = setInterval(() => {
    progress += Math.random() * 30;
    if (progress > 100) progress = 100;
    preloaderFill.style.width = progress + '%';
    if (progress >= 100) {
        clearInterval(preloaderInterval);
        setTimeout(() => {
            preloader.classList.add('hidden');
            initAnimations();
        }, 400);
    }
}, 200);

// ============================================
// Navigation
// ============================================
const nav = document.getElementById('nav');
const menuBtn = document.getElementById('menuBtn');
const menuOverlay = document.getElementById('menuOverlay');
const menuLinks = document.querySelectorAll('.menu-link');

// Scroll behavior
window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 80);
});

// Mobile menu
menuBtn.addEventListener('click', () => {
    const isActive = menuBtn.classList.toggle('active');
    menuOverlay.classList.toggle('active', isActive);
    document.body.style.overflow = isActive ? 'hidden' : '';
});

menuLinks.forEach(link => {
    link.addEventListener('click', () => {
        menuBtn.classList.remove('active');
        menuOverlay.classList.remove('active');
        document.body.style.overflow = '';
    });
});

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.querySelector(anchor.getAttribute('href'));
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
});

// ============================================
// Accordion
// ============================================
document.querySelectorAll('.accordion-trigger').forEach(trigger => {
    trigger.addEventListener('click', () => {
        const item = trigger.parentElement;
        const isActive = item.classList.contains('active');
        document.querySelectorAll('.accordion-item').forEach(i => i.classList.remove('active'));
        if (!isActive) {
            item.classList.add('active');
        }
    });
});

// ============================================
// GSAP Animations
// ============================================
function initAnimations() {
    // Hero animations
    const heroTl = gsap.timeline({ delay: 0.3 });

    heroTl
        .to('.hero-tag', {
            opacity: 1, y: 0, duration: 0.8, ease: 'power3.out'
        })
        .to('.hero-title-line', {
            opacity: 1, y: 0, duration: 1, stagger: 0.15, ease: 'power3.out'
        }, '-=0.5')
        .to('.hero-sub', {
            opacity: 1, y: 0, duration: 0.8, ease: 'power3.out'
        }, '-=0.6')
        .to('.hero-ctas', {
            opacity: 1, y: 0, duration: 0.8, ease: 'power3.out'
        }, '-=0.5')
        .to('.hero-scroll-indicator', {
            opacity: 0.6, duration: 1, ease: 'power2.out'
        }, '-=0.3');

    // Stats counter animation
    document.querySelectorAll('.stat-number').forEach(num => {
        const target = parseInt(num.getAttribute('data-target'));
        ScrollTrigger.create({
            trigger: num,
            start: 'top 85%',
            once: true,
            onEnter: () => {
                gsap.to(num, {
                    innerHTML: target,
                    duration: 1.5,
                    ease: 'power2.out',
                    snap: { innerHTML: 1 },
                    onUpdate: function () {
                        num.textContent = Math.round(parseFloat(num.textContent));
                    }
                });
            }
        });
    });

    // About section reveal
    gsap.from('.about .section-tag', {
        scrollTrigger: { trigger: '.about', start: 'top 75%' },
        opacity: 0, y: 30, duration: 0.8
    });
    gsap.from('.about .section-title', {
        scrollTrigger: { trigger: '.about', start: 'top 75%' },
        opacity: 0, y: 40, duration: 1, delay: 0.15
    });
    gsap.from('.about-text', {
        scrollTrigger: { trigger: '.about-right', start: 'top 75%' },
        opacity: 0, y: 30, duration: 0.8, stagger: 0.15
    });
    gsap.from('.about-highlight', {
        scrollTrigger: { trigger: '.about-right', start: 'top 65%' },
        opacity: 0, x: -20, duration: 0.8
    });

    // Floors header
    gsap.from('.floors-header .section-tag', {
        scrollTrigger: { trigger: '.floors-header', start: 'top 75%' },
        opacity: 0, y: 30, duration: 0.8
    });
    gsap.from('.floors-header .section-title', {
        scrollTrigger: { trigger: '.floors-header', start: 'top 75%' },
        opacity: 0, y: 40, duration: 1, delay: 0.15
    });
    gsap.from('.floors-intro', {
        scrollTrigger: { trigger: '.floors-header', start: 'top 70%' },
        opacity: 0, y: 20, duration: 0.8, delay: 0.3
    });

    // ============================================
    // Isometric Building — Scroll-driven floor separation
    // ============================================
    const floorTop = document.getElementById('floorTop');
    const floorMiddle = document.getElementById('floorMiddle');
    const floorBottom = document.getElementById('floorBottom');
    const floorBase = document.getElementById('floorBase');
    const floorLabelTop = document.getElementById('floorLabelTop');
    const floorLabelMiddle = document.getElementById('floorLabelMiddle');
    const floorLabelBottom = document.getElementById('floorLabelBottom');
    const floorLabelBase = document.getElementById('floorLabelBase');

    if (floorTop && window.innerWidth > 900) {
        // Floors start stacked, then separate on scroll
        const buildingTl = gsap.timeline({
            scrollTrigger: {
                trigger: '.floors-building',
                start: 'top 70%',
                end: 'center 40%',
                scrub: 1,
            }
        });

        // Start stacked together, spread apart
        gsap.set(floorTop, { y: 180 });
        gsap.set(floorBottom, { y: -60 });
        if (floorBase) gsap.set(floorBase, { y: -180 });

        buildingTl
            .to(floorTop, { y: -20, duration: 1, ease: 'none' }, 0)
            .to(floorBottom, { y: 20, duration: 1, ease: 'none' }, 0);
        if (floorBase) buildingTl.to(floorBase, { y: 20, duration: 1, ease: 'none' }, 0);

        // Labels fade in as floors separate
        ScrollTrigger.create({
            trigger: '.floors-building',
            start: 'top 50%',
            onEnter: () => {
                floorLabelTop.classList.add('visible');
                floorLabelMiddle.classList.add('visible');
                floorLabelBottom.classList.add('visible');
                if (floorLabelBase) floorLabelBase.classList.add('visible');
            },
            onLeaveBack: () => {
                floorLabelTop.classList.remove('visible');
                floorLabelMiddle.classList.remove('visible');
                floorLabelBottom.classList.remove('visible');
                if (floorLabelBase) floorLabelBase.classList.remove('visible');
            }
        });
    } else {
        // Mobile: just show labels on scroll
        document.querySelectorAll('.floor-label').forEach(l => l.classList.add('visible'));
    }

    // Floor cards animation
    gsap.from('.floor-card', {
        scrollTrigger: { trigger: '.floor-cards', start: 'top 75%' },
        opacity: 0, y: 40, duration: 0.8, stagger: 0.15, ease: 'power3.out'
    });

    // Experience / timeline
    gsap.from('.experience-header .section-tag', {
        scrollTrigger: { trigger: '.experience-header', start: 'top 75%' },
        opacity: 0, y: 30, duration: 0.8
    });
    gsap.from('.experience-header .section-title', {
        scrollTrigger: { trigger: '.experience-header', start: 'top 75%' },
        opacity: 0, y: 40, duration: 1, delay: 0.15
    });

    document.querySelectorAll('.timeline-item').forEach((item, i) => {
        gsap.to(item, {
            scrollTrigger: { trigger: item, start: 'top 80%' },
            opacity: 1, y: 0, duration: 0.8, delay: i * 0.1, ease: 'power3.out'
        });
    });

    // Quote
    gsap.from('.quote p', {
        scrollTrigger: { trigger: '.pull-quote', start: 'top 70%' },
        opacity: 0, y: 30, duration: 1
    });
    gsap.from('.quote cite', {
        scrollTrigger: { trigger: '.pull-quote', start: 'top 70%' },
        opacity: 0, duration: 0.8, delay: 0.3
    });

    // Philosophy
    gsap.from('.philosophy .section-tag', {
        scrollTrigger: { trigger: '.philosophy', start: 'top 75%' },
        opacity: 0, y: 30, duration: 0.8
    });
    gsap.from('.philosophy .section-title', {
        scrollTrigger: { trigger: '.philosophy', start: 'top 75%' },
        opacity: 0, y: 40, duration: 1, delay: 0.15
    });
    gsap.from('.accordion-item', {
        scrollTrigger: { trigger: '.accordion', start: 'top 75%' },
        opacity: 0, y: 20, duration: 0.6, stagger: 0.1
    });

    // Join section
    gsap.from('.join-content > *', {
        scrollTrigger: { trigger: '.join', start: 'top 90%' },
        opacity: 0, y: 30, duration: 0.6, stagger: 0.06, ease: 'power3.out'
    });

    // Footer
    gsap.from('.footer-grid > *', {
        scrollTrigger: { trigger: '.footer', start: 'top 85%' },
        opacity: 0, y: 20, duration: 0.6, stagger: 0.1
    });
}
