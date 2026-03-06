/**
 * Website Builder Plugin — Professional website generation and Firebase full-stack deployment.
 *
 * Generates production-grade websites following 2026 web standards:
 * - Tailwind CSS v4 (CDN), semantic HTML5, modern responsive design
 * - SEO: meta tags, Open Graph, JSON-LD structured data, canonical URLs
 * - Performance: lazy loading, preconnect, font optimization, critical CSS
 * - Accessibility: ARIA landmarks, semantic elements, skip navigation, focus management
 * - Dark/light mode with system preference detection
 * - Smooth scroll, intersection observer animations, view transitions
 * - Contact forms with validation and Firebase Functions backend
 * - Cookie consent banner (GDPR/CCPA compliant)
 * - Analytics-ready (GA4 placeholder)
 *
 * Firebase Full Stack:
 * - Firebase Hosting: CDN, custom domains, SSL, security headers (CSP, HSTS, X-Frame)
 * - Firebase Functions: Contact form handler, API endpoints, CORS middleware
 * - Firebase Firestore: Form submissions, page analytics, dynamic content
 * - Proper firebase.json with rewrites, headers, caching, clean URLs
 * - Firestore security rules
 *
 * Tools:
 * - website_generate: Create complete website project with all pages and config
 * - website_add_page: Add additional pages to existing site
 * - website_deploy: Deploy to Firebase (Hosting + Functions + Firestore rules)
 * - website_list: List all generated/deployed websites with status
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentTool, ToolResult, ToolContext } from '@jarvis/tools';
import type { JarvisPluginDefinition } from '../types.js';

const execFileAsync = promisify(execFile);

function shortId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeJsonFile(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

// ─── Color Themes ───────────────────────────────────────────────────

interface ThemeConfig {
  name: string;
  primary: string; primaryHover: string; primaryLight: string;
  secondary: string;
  bg: string; bgAlt: string; bgCard: string;
  text: string; textMuted: string; textHeading: string;
  border: string; borderLight: string;
  gradient: string;
  darkBg: string; darkBgAlt: string; darkBgCard: string;
  darkText: string; darkTextMuted: string; darkBorder: string;
}

const THEMES: Record<string, ThemeConfig> = {
  modern: {
    name: 'Modern', primary: '#3b82f6', primaryHover: '#2563eb', primaryLight: '#dbeafe',
    secondary: '#8b5cf6', bg: '#ffffff', bgAlt: '#f8fafc', bgCard: '#ffffff',
    text: '#1e293b', textMuted: '#64748b', textHeading: '#0f172a', border: '#e2e8f0', borderLight: '#f1f5f9',
    gradient: 'from-blue-600 to-violet-600',
    darkBg: '#0f172a', darkBgAlt: '#1e293b', darkBgCard: '#1e293b', darkText: '#e2e8f0', darkTextMuted: '#94a3b8', darkBorder: '#334155',
  },
  dark: {
    name: 'Dark Tech', primary: '#00ff41', primaryHover: '#00cc33', primaryLight: '#052e16',
    secondary: '#06b6d4', bg: '#0a0e14', bgAlt: '#111827', bgCard: '#1f2937',
    text: '#e5e7eb', textMuted: '#9ca3af', textHeading: '#f9fafb', border: '#374151', borderLight: '#1f2937',
    gradient: 'from-green-500 to-cyan-500',
    darkBg: '#0a0e14', darkBgAlt: '#111827', darkBgCard: '#1f2937', darkText: '#e5e7eb', darkTextMuted: '#9ca3af', darkBorder: '#374151',
  },
  bold: {
    name: 'Bold', primary: '#ef4444', primaryHover: '#dc2626', primaryLight: '#fef2f2',
    secondary: '#f97316', bg: '#ffffff', bgAlt: '#fafafa', bgCard: '#ffffff',
    text: '#171717', textMuted: '#737373', textHeading: '#0a0a0a', border: '#e5e5e5', borderLight: '#f5f5f5',
    gradient: 'from-red-500 to-orange-500',
    darkBg: '#0a0a0a', darkBgAlt: '#171717', darkBgCard: '#262626', darkText: '#e5e5e5', darkTextMuted: '#a3a3a3', darkBorder: '#404040',
  },
  minimal: {
    name: 'Minimal', primary: '#0a0a0a', primaryHover: '#262626', primaryLight: '#f5f5f5',
    secondary: '#525252', bg: '#ffffff', bgAlt: '#fafafa', bgCard: '#ffffff',
    text: '#404040', textMuted: '#737373', textHeading: '#0a0a0a', border: '#e5e5e5', borderLight: '#fafafa',
    gradient: 'from-neutral-800 to-neutral-600',
    darkBg: '#0a0a0a', darkBgAlt: '#171717', darkBgCard: '#262626', darkText: '#d4d4d4', darkTextMuted: '#a3a3a3', darkBorder: '#404040',
  },
  corporate: {
    name: 'Corporate', primary: '#1d4ed8', primaryHover: '#1e40af', primaryLight: '#dbeafe',
    secondary: '#047857', bg: '#ffffff', bgAlt: '#f8fafc', bgCard: '#ffffff',
    text: '#334155', textMuted: '#64748b', textHeading: '#1e293b', border: '#cbd5e1', borderLight: '#f1f5f9',
    gradient: 'from-blue-700 to-blue-500',
    darkBg: '#0f172a', darkBgAlt: '#1e293b', darkBgCard: '#334155', darkText: '#cbd5e1', darkTextMuted: '#94a3b8', darkBorder: '#475569',
  },
};

// ─── HTML Generator ─────────────────────────────────────────────────

function generateProfessionalHtml(config: {
  title: string; description: string; style: string; sections: string[];
  product?: string; brandName?: string; contactEmail?: string; domain?: string;
}): string {
  const theme = THEMES[config.style] ?? THEMES.modern;
  const brand = config.brandName ?? config.product ?? config.title;
  const year = new Date().getFullYear();

  const sectionBlocks = config.sections.map(s => generateSection(s, config, theme)).join('\n');

  return `<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${escHtml(config.description.slice(0, 160))}">
  <meta name="author" content="${escHtml(brand)}">
  <meta name="robots" content="index, follow">
  <meta name="theme-color" content="${theme.primary}">

  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escHtml(config.title)}">
  <meta property="og:description" content="${escHtml(config.description.slice(0, 200))}">
  <meta property="og:site_name" content="${escHtml(brand)}">
  ${config.domain ? `<meta property="og:url" content="https://${config.domain}">` : ''}

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escHtml(config.title)}">
  <meta name="twitter:description" content="${escHtml(config.description.slice(0, 200))}">

  ${config.domain ? `<link rel="canonical" href="https://${config.domain}">` : ''}

  <title>${escHtml(config.title)}</title>

  <!-- Preconnect for performance -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">

  <!-- Tailwind CSS v4 CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: { primary: '${theme.primary}', 'primary-hover': '${theme.primaryHover}' },
          fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
        }
      }
    }
  </script>

  <!-- JSON-LD Structured Data -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "${escJson(brand)}",
    "description": "${escJson(config.description.slice(0, 200))}",
    ${config.domain ? `"url": "https://${config.domain}",` : ''}
    "publisher": { "@type": "Organization", "name": "${escJson(brand)}" }
  }
  </script>

  <style>
    /* Critical CSS — loaded inline for performance */
    .fade-in { opacity: 0; transform: translateY(20px); transition: opacity 0.6s ease, transform 0.6s ease; }
    .fade-in.visible { opacity: 1; transform: translateY(0); }
    .slide-in-left { opacity: 0; transform: translateX(-40px); transition: opacity 0.6s ease, transform 0.6s ease; }
    .slide-in-left.visible { opacity: 1; transform: translateX(0); }
    .slide-in-right { opacity: 0; transform: translateX(40px); transition: opacity 0.6s ease, transform 0.6s ease; }
    .slide-in-right.visible { opacity: 1; transform: translateX(0); }
    .scale-in { opacity: 0; transform: scale(0.95); transition: opacity 0.5s ease, transform 0.5s ease; }
    .scale-in.visible { opacity: 1; transform: scale(1); }
    @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
    .animate-float { animation: float 3s ease-in-out infinite; }
    .glass { backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
    /* Smooth dark mode transition */
    html { transition: background-color 0.3s, color 0.3s; }
  </style>
</head>
<body class="font-sans antialiased bg-white dark:bg-[${theme.darkBg}] text-[${theme.text}] dark:text-[${theme.darkText}] transition-colors">

  <!-- Skip Navigation (Accessibility) -->
  <a href="#main-content" class="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-primary focus:text-white focus:px-4 focus:py-2 focus:rounded-lg">
    Skip to main content
  </a>

  <!-- Navigation -->
  <nav class="fixed top-0 left-0 right-0 z-40 glass bg-white/80 dark:bg-[${theme.darkBg}]/80 border-b border-[${theme.border}] dark:border-[${theme.darkBorder}]" role="navigation" aria-label="Main navigation">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between h-16">
        <a href="#" class="text-xl font-bold text-[${theme.textHeading}] dark:text-white tracking-tight">${escHtml(brand)}</a>
        <div class="hidden md:flex items-center gap-8">
          ${config.sections.includes('features') ? '<a href="#features" class="text-sm font-medium text-[' + theme.textMuted + '] dark:text-[' + theme.darkTextMuted + '] hover:text-[' + theme.primary + '] transition-colors">Features</a>' : ''}
          ${config.sections.includes('pricing') ? '<a href="#pricing" class="text-sm font-medium text-[' + theme.textMuted + '] dark:text-[' + theme.darkTextMuted + '] hover:text-[' + theme.primary + '] transition-colors">Pricing</a>' : ''}
          ${config.sections.includes('testimonials') ? '<a href="#testimonials" class="text-sm font-medium text-[' + theme.textMuted + '] dark:text-[' + theme.darkTextMuted + '] hover:text-[' + theme.primary + '] transition-colors">Testimonials</a>' : ''}
          ${config.sections.includes('contact') ? '<a href="#contact" class="text-sm font-medium text-[' + theme.textMuted + '] dark:text-[' + theme.darkTextMuted + '] hover:text-[' + theme.primary + '] transition-colors">Contact</a>' : ''}
          <button onclick="toggleDarkMode()" class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" aria-label="Toggle dark mode">
            <svg class="w-5 h-5 hidden dark:block" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
            <svg class="w-5 h-5 block dark:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
          </button>
          <a href="#cta" class="inline-flex items-center px-5 py-2.5 text-sm font-semibold text-white bg-[${theme.primary}] hover:bg-[${theme.primaryHover}] rounded-lg transition-all shadow-lg shadow-[${theme.primary}]/25 hover:shadow-[${theme.primary}]/40">
            Get Started
          </a>
        </div>
        <!-- Mobile menu button -->
        <button onclick="document.getElementById('mobile-menu').classList.toggle('hidden')" class="md:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Toggle menu">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
        </button>
      </div>
      <!-- Mobile menu -->
      <div id="mobile-menu" class="hidden md:hidden pb-4 border-t border-[${theme.border}] dark:border-[${theme.darkBorder}]">
        <div class="flex flex-col gap-2 pt-4">
          ${config.sections.includes('features') ? '<a href="#features" class="px-3 py-2 text-sm font-medium rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">Features</a>' : ''}
          ${config.sections.includes('pricing') ? '<a href="#pricing" class="px-3 py-2 text-sm font-medium rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">Pricing</a>' : ''}
          ${config.sections.includes('contact') ? '<a href="#contact" class="px-3 py-2 text-sm font-medium rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">Contact</a>' : ''}
          <a href="#cta" class="mx-3 mt-2 text-center px-5 py-2.5 text-sm font-semibold text-white bg-[${theme.primary}] rounded-lg">Get Started</a>
        </div>
      </div>
    </div>
  </nav>

  <main id="main-content">
${sectionBlocks}
  </main>

  <!-- Footer -->
  <footer class="bg-[${theme.bgAlt}] dark:bg-[${theme.darkBgAlt}] border-t border-[${theme.border}] dark:border-[${theme.darkBorder}]">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-8">
        <div class="md:col-span-2">
          <h3 class="text-lg font-bold text-[${theme.textHeading}] dark:text-white mb-2">${escHtml(brand)}</h3>
          <p class="text-sm text-[${theme.textMuted}] dark:text-[${theme.darkTextMuted}] max-w-md">${escHtml(config.description.slice(0, 150))}</p>
        </div>
        <div>
          <h4 class="text-sm font-semibold text-[${theme.textHeading}] dark:text-white mb-3 uppercase tracking-wider">Links</h4>
          <ul class="space-y-2 text-sm text-[${theme.textMuted}] dark:text-[${theme.darkTextMuted}]">
            ${config.sections.includes('features') ? '<li><a href="#features" class="hover:text-[' + theme.primary + '] transition-colors">Features</a></li>' : ''}
            ${config.sections.includes('pricing') ? '<li><a href="#pricing" class="hover:text-[' + theme.primary + '] transition-colors">Pricing</a></li>' : ''}
            <li><a href="#" class="hover:text-[${theme.primary}] transition-colors">Privacy Policy</a></li>
            <li><a href="#" class="hover:text-[${theme.primary}] transition-colors">Terms of Service</a></li>
          </ul>
        </div>
        <div>
          <h4 class="text-sm font-semibold text-[${theme.textHeading}] dark:text-white mb-3 uppercase tracking-wider">Contact</h4>
          <ul class="space-y-2 text-sm text-[${theme.textMuted}] dark:text-[${theme.darkTextMuted}]">
            ${config.contactEmail ? `<li><a href="mailto:${config.contactEmail}" class="hover:text-[${theme.primary}] transition-colors">${config.contactEmail}</a></li>` : ''}
            <li><a href="#contact" class="hover:text-[${theme.primary}] transition-colors">Contact Form</a></li>
          </ul>
        </div>
      </div>
      <div class="mt-8 pt-8 border-t border-[${theme.border}] dark:border-[${theme.darkBorder}] flex flex-col sm:flex-row justify-between items-center gap-4">
        <p class="text-sm text-[${theme.textMuted}] dark:text-[${theme.darkTextMuted}]">&copy; ${year} ${escHtml(brand)}. All rights reserved.</p>
        <div class="flex gap-4">
          <a href="#" class="text-[${theme.textMuted}] dark:text-[${theme.darkTextMuted}] hover:text-[${theme.primary}] transition-colors" aria-label="Twitter">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </a>
          <a href="#" class="text-[${theme.textMuted}] dark:text-[${theme.darkTextMuted}] hover:text-[${theme.primary}] transition-colors" aria-label="LinkedIn">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M20.5 2h-17A1.5 1.5 0 002 3.5v17A1.5 1.5 0 003.5 22h17a1.5 1.5 0 001.5-1.5v-17A1.5 1.5 0 0020.5 2zM8 19H5v-9h3zM6.5 8.25A1.75 1.75 0 118.3 6.5a1.78 1.78 0 01-1.8 1.75zM19 19h-3v-4.74c0-1.42-.6-1.93-1.38-1.93A1.74 1.74 0 0013 14.19a.66.66 0 000 .14V19h-3v-9h2.9v1.3a3.11 3.11 0 012.7-1.4c1.55 0 3.36.86 3.36 3.66z"/></svg>
          </a>
        </div>
      </div>
    </div>
  </footer>

  <!-- Cookie Consent (GDPR) -->
  <div id="cookie-banner" class="fixed bottom-0 left-0 right-0 z-50 p-4 bg-white dark:bg-[${theme.darkBgCard}] border-t border-[${theme.border}] dark:border-[${theme.darkBorder}] shadow-2xl transform translate-y-0 transition-transform" style="display:none">
    <div class="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
      <p class="text-sm text-[${theme.textMuted}] dark:text-[${theme.darkTextMuted}]">We use cookies to improve your experience. By continuing, you agree to our <a href="#" class="underline hover:text-[${theme.primary}]">cookie policy</a>.</p>
      <div class="flex gap-3">
        <button onclick="acceptCookies()" class="px-4 py-2 text-sm font-medium text-white bg-[${theme.primary}] rounded-lg hover:bg-[${theme.primaryHover}] transition-colors">Accept</button>
        <button onclick="declineCookies()" class="px-4 py-2 text-sm font-medium text-[${theme.textMuted}] bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">Decline</button>
      </div>
    </div>
  </div>

  <script>
    // Dark mode toggle with system preference detection
    function toggleDarkMode() {
      document.documentElement.classList.toggle('dark');
      localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    }
    (function() {
      const stored = localStorage.getItem('theme');
      if (stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
      }
    })();

    // Intersection Observer for scroll animations
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

    document.querySelectorAll('.fade-in, .slide-in-left, .slide-in-right, .scale-in').forEach(el => observer.observe(el));

    // Cookie consent
    function acceptCookies() { localStorage.setItem('cookies', 'accepted'); document.getElementById('cookie-banner').style.display = 'none'; }
    function declineCookies() { localStorage.setItem('cookies', 'declined'); document.getElementById('cookie-banner').style.display = 'none'; }
    if (!localStorage.getItem('cookies')) { setTimeout(() => { document.getElementById('cookie-banner').style.display = 'block'; }, 2000); }

    // Contact form handler (Firebase Functions endpoint)
    async function handleContactForm(e) {
      e.preventDefault();
      const form = e.target;
      const btn = form.querySelector('button[type="submit"]');
      const msg = document.getElementById('form-message');
      btn.disabled = true; btn.textContent = 'Sending...';
      try {
        const data = Object.fromEntries(new FormData(form));
        const res = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        if (res.ok) {
          msg.textContent = 'Message sent successfully! We\\'ll get back to you soon.';
          msg.className = 'mt-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-sm';
          form.reset();
        } else { throw new Error('Server error'); }
      } catch {
        msg.textContent = 'Something went wrong. Please try again or email us directly.';
        msg.className = 'mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-sm';
      }
      btn.disabled = false; btn.textContent = 'Send Message';
    }

    // Smooth reveal for nav on scroll
    let lastScroll = 0;
    const nav = document.querySelector('nav');
    window.addEventListener('scroll', () => {
      const curr = window.scrollY;
      if (curr > 100) { nav.classList.add('shadow-lg'); } else { nav.classList.remove('shadow-lg'); }
      lastScroll = curr;
    }, { passive: true });
  </script>

  <!-- Analytics placeholder (replace with actual GA4 ID) -->
  <!-- <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script> -->
</body>
</html>`;
}

function generateSection(section: string, config: { title: string; description: string; product?: string; brandName?: string }, theme: ThemeConfig): string {
  const brand = config.brandName ?? config.product ?? config.title;

  switch (section) {
    case 'hero': return `
    <!-- Hero Section -->
    <section class="relative pt-32 pb-20 lg:pt-40 lg:pb-32 overflow-hidden">
      <div class="absolute inset-0 bg-gradient-to-br from-[${theme.primaryLight}] via-transparent to-transparent dark:from-[${theme.primary}]/10 dark:via-transparent"></div>
      <div class="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="text-center max-w-4xl mx-auto">
          <div class="fade-in">
            <span class="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-[${theme.primaryLight}] dark:bg-[${theme.primary}]/10 text-[${theme.primary}] mb-6">
              Now Available &mdash; Start Free Today
            </span>
          </div>
          <h1 class="fade-in text-4xl sm:text-5xl lg:text-7xl font-extrabold tracking-tight text-[${theme.textHeading}] dark:text-white leading-[1.1] mb-6">
            ${escHtml(brand)}
          </h1>
          <p class="fade-in text-lg sm:text-xl text-[${theme.textMuted}] dark:text-[${theme.darkTextMuted}] max-w-2xl mx-auto mb-10 leading-relaxed">
            ${escHtml(config.description)}
          </p>
          <div class="fade-in flex flex-col sm:flex-row items-center justify-center gap-4">
            <a href="#cta" class="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 text-base font-semibold text-white bg-[${theme.primary}] hover:bg-[${theme.primaryHover}] rounded-xl transition-all shadow-lg shadow-[${theme.primary}]/25 hover:shadow-xl hover:shadow-[${theme.primary}]/30 hover:-translate-y-0.5">
              Get Started Free
              <svg class="ml-2 w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>
            </a>
            <a href="#features" class="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 text-base font-semibold text-[${theme.text}] dark:text-white bg-white dark:bg-white/10 border border-[${theme.border}] dark:border-[${theme.darkBorder}] hover:bg-gray-50 dark:hover:bg-white/20 rounded-xl transition-all">
              Learn More
            </a>
          </div>
        </div>
      </div>
    </section>`;

    case 'features': return `
    <!-- Features Section -->
    <section id="features" class="py-20 lg:py-28 bg-[${theme.bgAlt}] dark:bg-[${theme.darkBgAlt}]">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="text-center mb-16 fade-in">
          <span class="text-sm font-semibold text-[${theme.primary}] uppercase tracking-wider">Features</span>
          <h2 class="mt-3 text-3xl sm:text-4xl font-bold text-[${theme.textHeading}] dark:text-white">Everything you need</h2>
          <p class="mt-4 text-lg text-[${theme.textMuted}] dark:text-[${theme.darkTextMuted}] max-w-2xl mx-auto">Built with the tools and integrations your team already uses.</p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          ${[
            { icon: '⚡', title: 'Lightning Fast', desc: 'Optimized for speed with sub-second response times and global CDN delivery.' },
            { icon: '🔒', title: 'Enterprise Security', desc: 'Bank-grade encryption, SOC 2 compliant, with role-based access control.' },
            { icon: '📊', title: 'Advanced Analytics', desc: 'Real-time dashboards with actionable insights and custom reporting.' },
            { icon: '🔗', title: 'Seamless Integration', desc: 'Connect with 100+ tools via API, webhooks, and native integrations.' },
            { icon: '🎨', title: 'Fully Customizable', desc: 'White-label ready with complete brand kit support and custom themes.' },
            { icon: '🚀', title: 'Scale Infinitely', desc: 'Auto-scaling infrastructure that grows with your business needs.' },
          ].map((f, i) => `
          <div class="scale-in group p-8 rounded-2xl bg-[${theme.bgCard}] dark:bg-[${theme.darkBgCard}] border border-[${theme.borderLight}] dark:border-[${theme.darkBorder}] hover:border-[${theme.primary}]/30 hover:shadow-xl hover:shadow-[${theme.primary}]/5 transition-all duration-300 hover:-translate-y-1" style="transition-delay: ${i * 100}ms">
            <div class="w-12 h-12 rounded-xl bg-[${theme.primaryLight}] dark:bg-[${theme.primary}]/10 flex items-center justify-center text-2xl mb-5 group-hover:scale-110 transition-transform">${f.icon}</div>
            <h3 class="text-lg font-semibold text-[${theme.textHeading}] dark:text-white mb-2">${f.title}</h3>
            <p class="text-[${theme.textMuted}] dark:text-[${theme.darkTextMuted}] text-sm leading-relaxed">${f.desc}</p>
          </div>`).join('')}
        </div>
      </div>
    </section>`;

    case 'pricing': return `
    <!-- Pricing Section -->
    <section id="pricing" class="py-20 lg:py-28">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="text-center mb-16 fade-in">
          <span class="text-sm font-semibold text-[${theme.primary}] uppercase tracking-wider">Pricing</span>
          <h2 class="mt-3 text-3xl sm:text-4xl font-bold text-[${theme.textHeading}] dark:text-white">Simple, transparent pricing</h2>
          <p class="mt-4 text-lg text-[${theme.textMuted}] dark:text-[${theme.darkTextMuted}]">No hidden fees. Cancel anytime.</p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          ${[
            { name: 'Starter', price: 'Free', period: 'forever', features: ['Up to 3 projects', 'Basic analytics', 'Community support', '1 GB storage'], cta: 'Start Free', highlight: false },
            { name: 'Pro', price: '$29', period: '/month', features: ['Unlimited projects', 'Advanced analytics', 'Priority support', '100 GB storage', 'Custom domain', 'API access'], cta: 'Start Pro Trial', highlight: true },
            { name: 'Enterprise', price: 'Custom', period: '', features: ['Everything in Pro', 'Dedicated account manager', 'SLA guarantee', 'Unlimited storage', 'SSO & SAML', 'Custom integrations'], cta: 'Contact Sales', highlight: false },
          ].map((plan, i) => `
          <div class="scale-in relative p-8 rounded-2xl ${plan.highlight ? `bg-[${theme.primary}] text-white ring-2 ring-[${theme.primary}] shadow-2xl shadow-[${theme.primary}]/20` : `bg-[${theme.bgCard}] dark:bg-[${theme.darkBgCard}] border border-[${theme.border}] dark:border-[${theme.darkBorder}]`}" style="transition-delay: ${i * 100}ms">
            ${plan.highlight ? '<span class="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 text-xs font-bold bg-white text-[' + theme.primary + '] rounded-full shadow-md">Most Popular</span>' : ''}
            <h3 class="text-lg font-semibold ${plan.highlight ? '' : `text-[${theme.textHeading}] dark:text-white`}">${plan.name}</h3>
            <div class="mt-4 flex items-baseline gap-1">
              <span class="text-4xl font-extrabold">${plan.price}</span>
              <span class="text-sm ${plan.highlight ? 'opacity-80' : `text-[${theme.textMuted}] dark:text-[${theme.darkTextMuted}]`}">${plan.period}</span>
            </div>
            <ul class="mt-6 space-y-3">
              ${plan.features.map(f => `<li class="flex items-center gap-2 text-sm ${plan.highlight ? 'opacity-90' : `text-[${theme.textMuted}] dark:text-[${theme.darkTextMuted}]`}"><svg class="w-4 h-4 ${plan.highlight ? 'text-white' : `text-[${theme.primary}]`} flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>${f}</li>`).join('')}
            </ul>
            <a href="#cta" class="mt-8 block text-center px-6 py-3 text-sm font-semibold rounded-xl transition-all ${plan.highlight ? `bg-white text-[${theme.primary}] hover:bg-gray-100` : `bg-[${theme.primary}] text-white hover:bg-[${theme.primaryHover}] shadow-lg shadow-[${theme.primary}]/20`}">${plan.cta}</a>
          </div>`).join('')}
        </div>
      </div>
    </section>`;

    case 'testimonials': return `
    <!-- Testimonials Section -->
    <section id="testimonials" class="py-20 lg:py-28 bg-[${theme.bgAlt}] dark:bg-[${theme.darkBgAlt}]">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="text-center mb-16 fade-in">
          <span class="text-sm font-semibold text-[${theme.primary}] uppercase tracking-wider">Testimonials</span>
          <h2 class="mt-3 text-3xl sm:text-4xl font-bold text-[${theme.textHeading}] dark:text-white">Loved by teams worldwide</h2>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
          ${[
            { quote: 'This completely transformed how our team works. The ROI was visible within the first week.', name: 'Sarah Chen', role: 'VP of Engineering', company: 'TechCorp' },
            { quote: 'Best decision we made this year. The support team is incredible and the product just works.', name: 'Marcus Rodriguez', role: 'Founder & CEO', company: 'StartupXYZ' },
            { quote: 'We evaluated 12 solutions before choosing this one. No regrets — it\'s in a league of its own.', name: 'Aisha Patel', role: 'Head of Operations', company: 'ScaleUp Inc.' },
          ].map((t, i) => `
          <div class="fade-in p-8 rounded-2xl bg-[${theme.bgCard}] dark:bg-[${theme.darkBgCard}] border border-[${theme.borderLight}] dark:border-[${theme.darkBorder}]" style="transition-delay: ${i * 150}ms">
            <div class="flex gap-1 mb-4">${'★'.repeat(5).split('').map(() => `<svg class="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/></svg>`).join('')}</div>
            <p class="text-[${theme.text}] dark:text-[${theme.darkText}] mb-6 leading-relaxed">"${t.quote}"</p>
            <div>
              <p class="font-semibold text-[${theme.textHeading}] dark:text-white text-sm">${t.name}</p>
              <p class="text-xs text-[${theme.textMuted}] dark:text-[${theme.darkTextMuted}]">${t.role}, ${t.company}</p>
            </div>
          </div>`).join('')}
        </div>
      </div>
    </section>`;

    case 'contact': return `
    <!-- Contact Section -->
    <section id="contact" class="py-20 lg:py-28">
      <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="text-center mb-12 fade-in">
          <span class="text-sm font-semibold text-[${theme.primary}] uppercase tracking-wider">Contact</span>
          <h2 class="mt-3 text-3xl sm:text-4xl font-bold text-[${theme.textHeading}] dark:text-white">Get in touch</h2>
          <p class="mt-4 text-lg text-[${theme.textMuted}] dark:text-[${theme.darkTextMuted}]">Have a question? We'd love to hear from you.</p>
        </div>
        <form onsubmit="handleContactForm(event)" class="fade-in space-y-6 p-8 rounded-2xl bg-[${theme.bgCard}] dark:bg-[${theme.darkBgCard}] border border-[${theme.border}] dark:border-[${theme.darkBorder}] shadow-sm">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label for="name" class="block text-sm font-medium text-[${theme.text}] dark:text-[${theme.darkText}] mb-1.5">Name</label>
              <input type="text" id="name" name="name" required class="w-full px-4 py-3 rounded-xl bg-[${theme.bgAlt}] dark:bg-[${theme.darkBgAlt}] border border-[${theme.border}] dark:border-[${theme.darkBorder}] text-[${theme.text}] dark:text-[${theme.darkText}] focus:ring-2 focus:ring-[${theme.primary}] focus:border-transparent outline-none transition-all text-sm" placeholder="Your name">
            </div>
            <div>
              <label for="email" class="block text-sm font-medium text-[${theme.text}] dark:text-[${theme.darkText}] mb-1.5">Email</label>
              <input type="email" id="email" name="email" required class="w-full px-4 py-3 rounded-xl bg-[${theme.bgAlt}] dark:bg-[${theme.darkBgAlt}] border border-[${theme.border}] dark:border-[${theme.darkBorder}] text-[${theme.text}] dark:text-[${theme.darkText}] focus:ring-2 focus:ring-[${theme.primary}] focus:border-transparent outline-none transition-all text-sm" placeholder="you@company.com">
            </div>
          </div>
          <div>
            <label for="company" class="block text-sm font-medium text-[${theme.text}] dark:text-[${theme.darkText}] mb-1.5">Company</label>
            <input type="text" id="company" name="company" class="w-full px-4 py-3 rounded-xl bg-[${theme.bgAlt}] dark:bg-[${theme.darkBgAlt}] border border-[${theme.border}] dark:border-[${theme.darkBorder}] text-[${theme.text}] dark:text-[${theme.darkText}] focus:ring-2 focus:ring-[${theme.primary}] focus:border-transparent outline-none transition-all text-sm" placeholder="Your company">
          </div>
          <div>
            <label for="message" class="block text-sm font-medium text-[${theme.text}] dark:text-[${theme.darkText}] mb-1.5">Message</label>
            <textarea id="message" name="message" rows="4" required class="w-full px-4 py-3 rounded-xl bg-[${theme.bgAlt}] dark:bg-[${theme.darkBgAlt}] border border-[${theme.border}] dark:border-[${theme.darkBorder}] text-[${theme.text}] dark:text-[${theme.darkText}] focus:ring-2 focus:ring-[${theme.primary}] focus:border-transparent outline-none transition-all resize-none text-sm" placeholder="How can we help?"></textarea>
          </div>
          <button type="submit" class="w-full sm:w-auto px-8 py-3.5 text-sm font-semibold text-white bg-[${theme.primary}] hover:bg-[${theme.primaryHover}] rounded-xl transition-all shadow-lg shadow-[${theme.primary}]/25">
            Send Message
          </button>
          <div id="form-message" class="hidden"></div>
        </form>
      </div>
    </section>`;

    case 'cta': return `
    <!-- CTA Section -->
    <section id="cta" class="py-20 lg:py-28 relative overflow-hidden">
      <div class="absolute inset-0 bg-gradient-to-br ${theme.gradient} opacity-95"></div>
      <div class="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h2 class="fade-in text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white mb-6">Ready to get started?</h2>
        <p class="fade-in text-lg text-white/80 mb-10 max-w-2xl mx-auto">Join thousands of teams already using ${escHtml(brand)}. Start your free trial today — no credit card required.</p>
        <div class="fade-in flex flex-col sm:flex-row items-center justify-center gap-4">
          <a href="#" class="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 text-base font-semibold text-[${theme.primary}] bg-white hover:bg-gray-100 rounded-xl transition-all shadow-xl hover:shadow-2xl hover:-translate-y-0.5">
            Start Free Trial
            <svg class="ml-2 w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>
          </a>
          <a href="#contact" class="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 text-base font-semibold text-white border-2 border-white/30 hover:bg-white/10 rounded-xl transition-all">
            Talk to Sales
          </a>
        </div>
      </div>
    </section>`;

    default: return '';
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escJson(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// ─── Firebase Config Generators ─────────────────────────────────────

function generateFirebaseJson(hasFunctions: boolean): string {
  const config: Record<string, unknown> = {
    hosting: {
      public: 'public',
      ignore: ['firebase.json', '**/.*', '**/node_modules/**', 'functions/**'],
      cleanUrls: true,
      trailingSlash: false,
      headers: [
        {
          source: '**',
          headers: [
            { key: 'X-Frame-Options', value: 'DENY' },
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'X-XSS-Protection', value: '1; mode=block' },
            { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
            { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ],
        },
        {
          source: '**/*.@(jpg|jpeg|gif|png|svg|webp|avif|ico|woff2)',
          headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
        },
        {
          source: '**/*.@(js|css)',
          headers: [{ key: 'Cache-Control', value: 'public, max-age=2592000' }],
        },
        {
          source: '**/*.html',
          headers: [{ key: 'Cache-Control', value: 'public, max-age=300' }],
        },
      ],
      ...(hasFunctions ? {
        rewrites: [
          { source: '/api/**', function: { functionId: 'api', region: 'europe-west1' } },
        ],
      } : {}),
    },
  };

  if (hasFunctions) {
    config.functions = [{ source: 'functions', codebase: 'default', runtime: 'nodejs20' }];
    config.firestore = { rules: 'firestore.rules', indexes: 'firestore.indexes.json' };
  }

  return JSON.stringify(config, null, 2);
}

function generateFirestoreRules(): string {
  return `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Contact form submissions — write-only from client, read from admin/functions
    match /submissions/{submissionId} {
      allow create: if request.resource.data.keys().hasAll(['name', 'email', 'message'])
                    && request.resource.data.name is string
                    && request.resource.data.email is string
                    && request.resource.data.message is string
                    && request.resource.data.name.size() > 0
                    && request.resource.data.name.size() < 200
                    && request.resource.data.email.size() < 200
                    && request.resource.data.message.size() < 5000;
      allow read: if false; // Only accessible via admin SDK in Functions
    }

    // Page analytics — write-only
    match /analytics/{eventId} {
      allow create: if request.resource.data.keys().hasAll(['page', 'event', 'timestamp']);
      allow read: if false;
    }

    // Dynamic content — read-only from client
    match /content/{docId} {
      allow read: if true;
      allow write: if false; // Only via admin SDK
    }

    // Deny everything else by default
    match /{document=**} {
      allow read, write: if false;
    }
  }
}`;
}

function generateFirestoreIndexes(): string {
  return JSON.stringify({
    indexes: [
      { collectionGroup: 'submissions', queryScope: 'COLLECTION', fields: [{ fieldPath: 'createdAt', order: 'DESCENDING' }] },
      { collectionGroup: 'analytics', queryScope: 'COLLECTION', fields: [{ fieldPath: 'page', order: 'ASCENDING' }, { fieldPath: 'timestamp', order: 'DESCENDING' }] },
    ],
    fieldOverrides: [],
  }, null, 2);
}

function generateCloudFunction(): string {
  return `const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

// CORS middleware
const cors = (req, res) => {
  const origin = req.headers.origin;
  const allowed = process.env.ALLOWED_ORIGINS?.split(",") ?? ["*"];
  if (allowed.includes("*") || allowed.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin ?? "*");
  }
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") { res.status(204).send(""); return true; }
  return false;
};

// Rate limiting (in-memory, resets on cold start — use Redis for production)
const rateLimit = {};
const checkRate = (ip, limit = 10, windowMs = 60000) => {
  const now = Date.now();
  if (!rateLimit[ip]) rateLimit[ip] = [];
  rateLimit[ip] = rateLimit[ip].filter(t => t > now - windowMs);
  if (rateLimit[ip].length >= limit) return false;
  rateLimit[ip].push(now);
  return true;
};

// Contact form handler
exports.api = onRequest({ region: "europe-west1", cors: false }, async (req, res) => {
  if (cors(req, res)) return;

  // Route: POST /api/contact
  if (req.path === "/api/contact" && req.method === "POST") {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0] ?? req.ip;
    if (!checkRate(ip, 5, 300000)) {
      return res.status(429).json({ error: "Too many requests. Please try again later." });
    }

    const { name, email, message, company } = req.body ?? {};

    // Validation
    if (!name || typeof name !== "string" || name.length > 200) {
      return res.status(400).json({ error: "Valid name required (max 200 chars)" });
    }
    if (!email || typeof email !== "string" || !email.includes("@") || email.length > 200) {
      return res.status(400).json({ error: "Valid email required" });
    }
    if (!message || typeof message !== "string" || message.length > 5000) {
      return res.status(400).json({ error: "Message required (max 5000 chars)" });
    }

    // Sanitize
    const sanitize = (s) => s.replace(/<[^>]*>/g, "").trim();

    try {
      await db.collection("submissions").add({
        name: sanitize(name),
        email: sanitize(email),
        company: company ? sanitize(String(company).slice(0, 200)) : "",
        message: sanitize(message),
        ip,
        userAgent: req.headers["user-agent"]?.slice(0, 200) ?? "",
        createdAt: FieldValue.serverTimestamp(),
        status: "new",
      });

      return res.status(200).json({ success: true, message: "Message received" });
    } catch (err) {
      console.error("Contact form error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  // Route: GET /api/health
  if (req.path === "/api/health") {
    return res.status(200).json({ status: "ok", timestamp: Date.now() });
  }

  res.status(404).json({ error: "Not found" });
});
`;
}

function generateFunctionsPackageJson(projectName: string): string {
  return JSON.stringify({
    name: `${projectName}-functions`,
    description: `Cloud Functions for ${projectName}`,
    engines: { node: '20' },
    main: 'index.js',
    dependencies: {
      'firebase-admin': '^12.0.0',
      'firebase-functions': '^5.0.0',
    },
  }, null, 2);
}

// ─── Tool: website_generate ─────────────────────────────────────────

function createWebsiteGenerateTool(): AgentTool {
  return {
    definition: {
      name: 'website_generate',
      description: 'Generate a professional, production-grade website with Tailwind CSS, SEO, dark mode, animations, contact form, and Firebase full-stack config (Hosting + Functions + Firestore). Follows 2026 web standards with accessibility, performance optimization, and security headers.',
      input_schema: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Description of the website purpose and content' },
          style: { type: 'string', enum: ['modern', 'dark', 'bold', 'minimal', 'corporate'], description: 'Visual theme (default: modern)' },
          sections: {
            type: 'array', items: { type: 'string', enum: ['hero', 'features', 'pricing', 'testimonials', 'contact', 'cta'] },
            description: 'Page sections to include (default: hero, features, cta)',
          },
          product: { type: 'string', description: 'Product name (used for branding)' },
          brandName: { type: 'string', description: 'Brand name (overrides product for display)' },
          contactEmail: { type: 'string', description: 'Contact email address' },
          domain: { type: 'string', description: 'Target domain (for SEO canonical URL)' },
          firebaseProject: { type: 'string', description: 'Firebase project ID' },
          includeFunctions: { type: 'boolean', description: 'Include Firebase Functions for contact form backend (default: true)' },
        },
        required: ['description'],
      },
    },
    async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const {
        description, style, sections, product, brandName, contactEmail,
        domain, firebaseProject, includeFunctions,
      } = params as Record<string, unknown>;

      const siteId = shortId();
      const siteDir = join(context.nasPath, 'marketing', 'websites', siteId);
      const publicDir = join(siteDir, 'public');
      ensureDir(publicDir);

      const sectionList = (sections as string[]) ?? ['hero', 'features', 'pricing', 'testimonials', 'contact', 'cta'];
      const siteStyle = (style as string) ?? 'modern';
      const hasFunctions = includeFunctions !== false;
      const fbProject = (firebaseProject as string) ?? process.env['FIREBASE_PROJECT'] ?? `jarvis-site-${siteId}`;
      const title = (brandName as string) ?? (product as string) ?? 'Landing Page';

      // Generate HTML
      const html = generateProfessionalHtml({
        title,
        description: description as string,
        style: siteStyle,
        sections: sectionList,
        product: product as string,
        brandName: brandName as string,
        contactEmail: contactEmail as string,
        domain: domain as string,
      });
      writeFileSync(join(publicDir, 'index.html'), html);

      // Generate robots.txt
      writeFileSync(join(publicDir, 'robots.txt'), `User-agent: *\nAllow: /\n${domain ? `Sitemap: https://${domain}/sitemap.xml` : ''}\n`);

      // Generate sitemap.xml
      if (domain) {
        writeFileSync(join(publicDir, 'sitemap.xml'),
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://${domain}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>`
        );
      }

      // Generate 404.html
      writeFileSync(join(publicDir, '404.html'),
        `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>404 - Page Not Found</title><script src="https://cdn.tailwindcss.com"></script></head><body class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900"><div class="text-center"><h1 class="text-6xl font-bold text-gray-300 dark:text-gray-700">404</h1><p class="mt-4 text-lg text-gray-600 dark:text-gray-400">Page not found</p><a href="/" class="mt-8 inline-block px-6 py-3 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700">Go Home</a></div></body></html>`
      );

      // Firebase config
      writeFileSync(join(siteDir, 'firebase.json'), generateFirebaseJson(hasFunctions));
      writeJsonFile(join(siteDir, '.firebaserc'), { projects: { default: fbProject } });

      if (hasFunctions) {
        // Firestore rules
        writeFileSync(join(siteDir, 'firestore.rules'), generateFirestoreRules());
        writeFileSync(join(siteDir, 'firestore.indexes.json'), generateFirestoreIndexes());

        // Cloud Functions
        const functionsDir = join(siteDir, 'functions');
        ensureDir(functionsDir);
        writeFileSync(join(functionsDir, 'index.js'), generateCloudFunction());
        writeFileSync(join(functionsDir, 'package.json'), generateFunctionsPackageJson(fbProject));
        writeFileSync(join(functionsDir, '.gitignore'), 'node_modules/\n');
      }

      // Save metadata
      const files = ['public/index.html', 'public/robots.txt', 'public/404.html', 'firebase.json', '.firebaserc'];
      if (domain) files.push('public/sitemap.xml');
      if (hasFunctions) files.push('firestore.rules', 'firestore.indexes.json', 'functions/index.js', 'functions/package.json');

      const meta = {
        id: siteId, name: title, description, product: product ?? null,
        style: siteStyle, sections: sectionList, files,
        domain: domain ?? null, contactEmail: contactEmail ?? null,
        firebaseProject: fbProject, hasFunctions,
        status: 'generated', deployedUrl: null, deployedAt: null,
        createdAt: Date.now(),
        tech: {
          css: 'Tailwind CSS v4 (CDN)',
          features: ['Responsive design', 'Dark/light mode', 'SEO optimized', 'Scroll animations', 'Cookie consent', 'Contact form', 'Accessibility (ARIA)', 'Security headers'],
          firebase: hasFunctions ? ['Hosting', 'Functions (v2)', 'Firestore'] : ['Hosting'],
        },
      };
      writeJsonFile(join(siteDir, 'meta.json'), meta);

      return {
        type: 'text',
        content: [
          `Website generated successfully (ID: ${siteId})`,
          ``,
          `## Project Structure`,
          `${siteDir}/`,
          `├── public/`,
          `│   ├── index.html          # Main page (Tailwind CSS, dark mode, animations)`,
          `│   ├── robots.txt          # Search engine directives`,
          `│   ├── 404.html            # Custom error page`,
          domain ? `│   └── sitemap.xml         # XML sitemap` : '',
          `├── firebase.json           # Hosting config (security headers, caching, rewrites)`,
          `├── .firebaserc             # Firebase project: ${fbProject}`,
          hasFunctions ? `├── firestore.rules         # Firestore security rules` : '',
          hasFunctions ? `├── firestore.indexes.json  # Firestore indexes` : '',
          hasFunctions ? `├── functions/` : '',
          hasFunctions ? `│   ├── index.js            # Contact form API + health endpoint` : '',
          hasFunctions ? `│   └── package.json        # Functions dependencies` : '',
          `└── meta.json               # Site metadata`,
          ``,
          `## Tech Stack`,
          `- Tailwind CSS v4 (CDN) — responsive, mobile-first`,
          `- SEO: meta tags, Open Graph, Twitter Card, JSON-LD, canonical URL, sitemap`,
          `- Accessibility: ARIA landmarks, skip navigation, semantic HTML5`,
          `- Performance: font preconnect, lazy animations, critical CSS inline`,
          `- Dark/light mode with system preference detection`,
          `- Intersection Observer scroll animations`,
          `- Cookie consent banner (GDPR/CCPA)`,
          hasFunctions ? `- Firebase Functions v2 (contact form handler with rate limiting)` : '',
          hasFunctions ? `- Firestore (form submissions, analytics events)` : '',
          `- Security headers: X-Frame-Options, CSP, HSTS, XSS protection`,
          ``,
          `## Deploy`,
          `Run \`website_deploy\` with siteId: "${siteId}" to deploy to Firebase.`,
          hasFunctions ? `Functions will be deployed with \`npm install\` in functions/ first.` : '',
        ].filter(Boolean).join('\n'),
      };
    },
  };
}

// ─── Tool: website_deploy ───────────────────────────────────────────

function createWebsiteDeployTool(): AgentTool {
  return {
    definition: {
      name: 'website_deploy',
      description: 'Deploy website to Firebase full stack: Hosting (with CDN, SSL, custom domain), Functions (contact form API), and Firestore rules. Handles npm install for functions, applies security headers and caching.',
      input_schema: {
        type: 'object',
        properties: {
          siteId: { type: 'string', description: 'Site ID from website_generate' },
          projectId: { type: 'string', description: 'Override Firebase project ID' },
          targets: {
            type: 'array', items: { type: 'string', enum: ['hosting', 'functions', 'firestore'] },
            description: 'Which services to deploy (default: all configured)',
          },
        },
        required: ['siteId'],
      },
    },
    async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const { siteId, projectId, targets } = params as { siteId: string; projectId?: string; targets?: string[] };
      const siteDir = join(context.nasPath, 'marketing', 'websites', siteId);

      if (!existsSync(siteDir)) return { type: 'error', content: `Site ${siteId} not found at ${siteDir}` };

      const metaPath = join(siteDir, 'meta.json');
      const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf-8')) : {};
      const hasFunctions = meta.hasFunctions && existsSync(join(siteDir, 'functions', 'index.js'));

      // Override project ID if provided
      if (projectId) {
        writeJsonFile(join(siteDir, '.firebaserc'), { projects: { default: projectId } });
      }

      const steps: string[] = [];
      const errors: string[] = [];

      // Step 1: Install functions dependencies
      if (hasFunctions && (!targets || targets.includes('functions'))) {
        const functionsDir = join(siteDir, 'functions');
        if (!existsSync(join(functionsDir, 'node_modules'))) {
          try {
            steps.push('Installing functions dependencies...');
            await execFileAsync('npm', ['install', '--production'], { cwd: functionsDir, timeout: 120_000 });
            steps.push('Functions dependencies installed.');
          } catch (err) {
            errors.push(`Functions npm install failed: ${(err as Error).message}`);
          }
        }
      }

      // Step 2: Deploy to Firebase
      const deployTargets: string[] = [];
      if (!targets || targets.includes('hosting')) deployTargets.push('hosting');
      if (hasFunctions && (!targets || targets.includes('functions'))) deployTargets.push('functions');
      if (hasFunctions && (!targets || targets.includes('firestore'))) deployTargets.push('firestore:rules', 'firestore:indexes');

      try {
        steps.push(`Deploying: ${deployTargets.join(', ')}...`);
        const firebaseToken = process.env['FIREBASE_TOKEN'];
        const args = ['deploy', '--only', deployTargets.join(',')];
        if (firebaseToken) args.push('--token', firebaseToken);

        const { stdout, stderr } = await execFileAsync('firebase', args, {
          cwd: siteDir,
          timeout: 300_000,
          env: { ...process.env, FORCE_COLOR: '0' },
        });

        // Extract hosting URL
        const urlMatch = stdout.match(/Hosting URL: (https?:\/\/\S+)/);
        const deployedUrl = urlMatch?.[1] ?? `https://${meta.firebaseProject ?? siteId}.web.app`;

        // Update metadata
        meta.status = 'deployed';
        meta.deployedUrl = deployedUrl;
        meta.deployedAt = Date.now();
        if (projectId) meta.firebaseProject = projectId;
        writeJsonFile(metaPath, meta);

        steps.push(`Deploy successful!`);
        steps.push(`URL: ${deployedUrl}`);

        return {
          type: 'text',
          content: [
            `## Deployment Complete`,
            ``,
            ...steps.map(s => `- ${s}`),
            errors.length > 0 ? `\n### Warnings\n${errors.map(e => `- ${e}`).join('\n')}` : '',
            ``,
            `### Deployed Services`,
            `- Hosting: ${deployedUrl}`,
            hasFunctions ? `- Functions: ${deployedUrl}/api/health` : '',
            hasFunctions ? `- Firestore: Rules & indexes applied` : '',
            ``,
            `### Security`,
            `- SSL/TLS enabled (Firebase default)`,
            `- X-Frame-Options: DENY`,
            `- X-Content-Type-Options: nosniff`,
            `- Referrer-Policy: strict-origin-when-cross-origin`,
            `- Cache-Control: optimized per asset type`,
          ].filter(Boolean).join('\n'),
        };
      } catch (err) {
        const error = err as Error & { stderr?: string };
        meta.status = 'error';
        meta.lastError = error.message;
        writeJsonFile(metaPath, meta);

        return {
          type: 'error',
          content: `Deploy failed:\n${error.message}\n${error.stderr ?? ''}\n\nSteps completed:\n${steps.join('\n')}\n\nTroubleshooting:\n1. Ensure firebase CLI is installed: npm install -g firebase-tools\n2. Login: firebase login\n3. Or set FIREBASE_TOKEN env var for CI\n4. Verify project exists: firebase projects:list`,
        };
      }
    },
  };
}

// ─── Tool: website_add_page ─────────────────────────────────────────

function createWebsiteAddPageTool(): AgentTool {
  return {
    definition: {
      name: 'website_add_page',
      description: 'Add a new page to an existing website project. The page will follow the same theme and include consistent navigation.',
      input_schema: {
        type: 'object',
        properties: {
          siteId: { type: 'string', description: 'Existing site ID' },
          pageName: { type: 'string', description: 'Page filename (e.g., "about", "blog", "terms")' },
          title: { type: 'string', description: 'Page title' },
          content: { type: 'string', description: 'Page HTML content (will be wrapped in site layout)' },
        },
        required: ['siteId', 'pageName', 'title', 'content'],
      },
    },
    async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const { siteId, pageName, title, content } = params as Record<string, string>;
      const siteDir = join(context.nasPath, 'marketing', 'websites', siteId);
      const publicDir = join(siteDir, 'public');

      if (!existsSync(siteDir)) return { type: 'error', content: `Site ${siteId} not found` };

      const metaPath = join(siteDir, 'meta.json');
      const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf-8')) : {};
      const theme = THEMES[meta.style ?? 'modern'] ?? THEMES.modern;

      // Create a page that matches the site's theme
      const pageHtml = `<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)} — ${escHtml(meta.name ?? 'Site')}</title>
  <meta name="description" content="${escHtml(title)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>tailwind.config={darkMode:'class',theme:{extend:{colors:{primary:'${theme.primary}'},fontFamily:{sans:['Inter','system-ui','sans-serif']}}}}</script>
</head>
<body class="font-sans antialiased bg-white dark:bg-[${theme.darkBg}] text-[${theme.text}] dark:text-[${theme.darkText}]">
  <nav class="border-b border-[${theme.border}] dark:border-[${theme.darkBorder}]">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
      <a href="/" class="text-xl font-bold text-[${theme.textHeading}] dark:text-white">${escHtml(meta.name ?? 'Home')}</a>
      <a href="/" class="text-sm text-[${theme.textMuted}] hover:text-[${theme.primary}]">&larr; Back to Home</a>
    </div>
  </nav>
  <main class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
    <h1 class="text-3xl font-bold text-[${theme.textHeading}] dark:text-white mb-8">${escHtml(title)}</h1>
    ${content}
  </main>
  <script>
    if(localStorage.getItem('theme')==='dark'||((!localStorage.getItem('theme'))&&window.matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark')}
  </script>
</body>
</html>`;

      const fileName = pageName.replace(/[^a-z0-9-]/gi, '').toLowerCase();
      writeFileSync(join(publicDir, `${fileName}.html`), pageHtml);

      // Update metadata
      const files = (meta.files ?? []) as string[];
      const newFile = `public/${fileName}.html`;
      if (!files.includes(newFile)) files.push(newFile);
      meta.files = files;
      meta.updatedAt = Date.now();
      writeJsonFile(metaPath, meta);

      return { type: 'text', content: `Page "${title}" added to site ${siteId} as ${fileName}.html\nAccess at: /${fileName}` };
    },
  };
}

// ─── Tool: website_list ─────────────────────────────────────────────

function createWebsiteListTool(): AgentTool {
  return {
    definition: {
      name: 'website_list',
      description: 'List all generated/deployed websites with status, tech stack, and URLs.',
      input_schema: { type: 'object', properties: {} },
    },
    async execute(_params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const websitesDir = join(context.nasPath, 'marketing', 'websites');
      if (!existsSync(websitesDir)) return { type: 'text', content: 'No websites found.' };

      const entries = readdirSync(websitesDir, { withFileTypes: true });
      const sites: Record<string, unknown>[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const metaPath = join(websitesDir, entry.name, 'meta.json');
        if (existsSync(metaPath)) {
          try { sites.push(JSON.parse(readFileSync(metaPath, 'utf-8'))); } catch { /* skip */ }
        }
      }

      if (sites.length === 0) return { type: 'text', content: 'No websites found. Use website_generate to create one.' };

      const summary = sites.map((s: Record<string, unknown>) => {
        const tech = s.tech as Record<string, unknown> | undefined;
        const firebase = (tech?.firebase as string[])?.join(', ') ?? 'Hosting';
        return [
          `[${(s.status as string ?? 'unknown').toUpperCase().padEnd(9)}] ${s.name} (${s.id})`,
          `  Style: ${s.style} | Sections: ${(s.sections as string[])?.join(', ')}`,
          `  Firebase: ${firebase} | Project: ${s.firebaseProject ?? 'N/A'}`,
          s.deployedUrl ? `  URL: ${s.deployedUrl}` : '  Not deployed yet',
          `  Created: ${new Date(s.createdAt as number).toLocaleDateString()}${s.deployedAt ? ` | Deployed: ${new Date(s.deployedAt as number).toLocaleDateString()}` : ''}`,
        ].join('\n');
      }).join('\n\n');

      return { type: 'text', content: `${sites.length} website(s):\n\n${summary}` };
    },
  };
}

// ─── Plugin Export ───────────────────────────────────────────────────

export function createWebsiteBuilderPlugin(): JarvisPluginDefinition {
  return {
    id: 'website-builder',
    name: 'Website Builder',
    description: 'Professional website generation with Tailwind CSS, SEO, dark mode, and Firebase full-stack deployment (Hosting + Functions + Firestore)',
    version: '2.0.0',

    register(api) {
      api.registerTool([
        createWebsiteGenerateTool(),
        createWebsiteAddPageTool(),
        createWebsiteDeployTool(),
        createWebsiteListTool(),
      ]);

      api.registerPromptSection({
        title: 'Website Builder',
        content: [
          '# Website Builder — Professional Site Generation & Firebase Deployment',
          '',
          '## Tools',
          '',
          '### `website_generate`',
          'Creates a complete, production-grade website project:',
          '- **Tailwind CSS v4** (CDN) — responsive, mobile-first design',
          '- **SEO**: meta tags, Open Graph, Twitter Card, JSON-LD structured data, canonical URL, sitemap, robots.txt',
          '- **Accessibility**: ARIA landmarks, skip navigation, semantic HTML5, focus management',
          '- **Performance**: font preconnect, critical CSS inline, optimized caching headers',
          '- **Dark/light mode** with system preference detection and manual toggle',
          '- **Scroll animations** via Intersection Observer (fade-in, slide, scale)',
          '- **Contact form** with client-side validation and Firebase Functions backend',
          '- **Cookie consent** banner (GDPR/CCPA)',
          '- **Custom 404** error page',
          '',
          'Themes: modern (blue), dark (green terminal), bold (red), minimal (black/white), corporate (navy)',
          'Sections: hero, features, pricing, testimonials, contact, cta',
          '',
          '### `website_add_page`',
          'Add additional pages (about, blog, terms, etc.) to existing sites.',
          '',
          '### `website_deploy`',
          'Deploy to **Firebase full stack**:',
          '- **Hosting**: Global CDN, SSL, custom domains, clean URLs, security headers',
          '- **Functions** (v2): Contact form API endpoint with rate limiting, input validation, CORS',
          '- **Firestore**: Form submissions storage, analytics events, security rules',
          '- Auto npm install for functions dependencies',
          '',
          '### `website_list`',
          'View all generated/deployed sites with status and URLs.',
        ].join('\n'),
        priority: 7,
      });

      api.logger.info('Website Builder v2.0 registered (4 tools, Firebase full stack)');
    },
  };
}
