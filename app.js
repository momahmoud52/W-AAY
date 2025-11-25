/* =========================================================
   WAI — Advanced Frontend Core (Vanilla JS)
   Purpose: Robust loader, animations, menu, lazy-loading,
            error recovery, accessibility, performance hooks.
   Usage: include with <script src="app.advanced.js" defer></script>
   ========================================================= */

/* Minimal "why" comments only. */
class WaiAdvanced {
  constructor(options = {}) {
    // Default config
    this.config = Object.assign({
      loaderSelector: '#app-loader',
      appSelector: '#app',
      hamburgerSelector: '.hamburger',
      mobileMenuSelector: '#mobile-menu',
      revealSelector: '[data-reveal]',
      lazyImageSelector: 'img[data-src]',
      loaderFallbackMs: 4000,
      loaderMinVisibleMs: 700,
      simulateProgress: true,
      progressIntervalMs: 80,
      maxImageRetries: 3,
      debug: false,
      prefersReducedMotionQuery: '(prefers-reduced-motion: reduce)',
      focusTrapClass: 'wai-focus-trap',
    }, options);

    // State
    this.state = {
      inited: false,
      loaderShownAt: null,
      loaderTimer: null,
      progress: 0,
      observers: [],
      openMenu: false,
      reducedMotion: false,
      retries: new WeakMap(),
    };

    // DOM refs (may be null initially)
    this.dom = {
      loader: null,
      app: null,
      hamburger: null,
      mobileMenu: null,
    };

    // Bind methods
    this._onDomReady = this._onDomReady.bind(this);
    this._onGlobalError = this._onGlobalError.bind(this);
    this._onUnhandledRejection = this._onUnhandledRejection.bind(this);
    this._onResize = this._onResize.bind(this);

    // Auto-init safe
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      // microtask to ensure consistent behavior
      setTimeout(() => this.init(), 0);
    } else {
      document.addEventListener('DOMContentLoaded', this._onDomReady, { once: true });
      // safety fallback
      setTimeout(() => {
        if (!this.state.inited) {
          this.log('DOM ready timeout — initializing anyway');
          this.init();
        }
      }, 2000);
    }
  }

  /* ===========================
     Utilities
     =========================== */
  log(...args) { if (this.config.debug) console.log('[WAI]', ...args); }
  warn(...args) { if (this.config.debug) console.warn('[WAI]', ...args); }
  error(...args) { console.error('[WAI]', ...args); }

  el(selector) {
    try { return document.querySelector(selector); } catch (e) { return null; }
  }

  /* Safe class toggles */
  addClass(el, cls) { if (el && !el.classList.contains(cls)) el.classList.add(cls); }
  removeClass(el, cls) { if (el && el.classList.contains(cls)) el.classList.remove(cls); }
  toggleClass(el, cls, force) {
    if (!el) return;
    if (typeof force === 'boolean') el.classList.toggle(cls, force);
    else el.classList.toggle(cls);
  }

  /* ===========================
     Init / teardown
     =========================== */
  _onDomReady() { this.init(); }

  init() {
    if (this.state.inited) return;
    this.state.inited = true;

    // attach globals
    window.addEventListener('error', this._onGlobalError);
    window.addEventListener('unhandledrejection', this._onUnhandledRejection);
    window.addEventListener('resize', this._onResize);

    // query DOM
    this.dom.loader = this.el(this.config.loaderSelector);
    this.dom.app = this.el(this.config.appSelector);
    this.dom.hamburger = this.el(this.config.hamburgerSelector);
    this.dom.mobileMenu = this.el(this.config.mobileMenuSelector);

    // reduced motion
    try {
      this.state.reducedMotion = window.matchMedia && window.matchMedia(this.config.prefersReducedMotionQuery).matches;
    } catch (e) { this.state.reducedMotion = false; }

    // start loader then components
    try {
      this.showLoader();
      this.setupMenu();        // safe even if DOM missing
      this.setupLazyLoading();
      this.setupRevealObserver();
      this.setupPerformanceObservers();
      // ensure app visible no matter what eventually
      this._safetyEnsureAppVisible();
    } catch (err) {
      this.error('Init error', err);
      // force show
      this.hideLoader(true);
    }
  }

  destroy() {
    // cleanup
    window.removeEventListener('error', this._onGlobalError);
    window.removeEventListener('unhandledrejection', this._onUnhandledRejection);
    window.removeEventListener('resize', this._onResize);
    this.state.observers.forEach(o => o.disconnect && o.disconnect());
    this.state.observers = [];
    this.state.inited = false;
  }

  /* ===========================
     Loader subsystem
     =========================== */
  createLoaderIfMissing() {
    if (!this.dom.loader) {
      // create minimal loader
      const div = document.createElement('div');
      div.id = this.config.loaderSelector.replace('#', '');
      div.className = 'app-loader';
      div.setAttribute('role', 'status');
      div.setAttribute('aria-live', 'polite');
      div.innerHTML = `
        <div class="loader-ring" aria-hidden="true">
          <svg class="logo-svg" width="72" height="72" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="50" cy="50" r="44" fill="none" stroke="#6b4a2e" stroke-width="6" stroke-linecap="round" />
            <path d="M34 40h32v20H34z" fill="none" stroke="#6b4a2e" stroke-width="3"/>
          </svg>
        </div>
      `;
      document.documentElement.appendChild(div);
      this.dom.loader = div;
    }
  }

  showLoader() {
    try {
      this.createLoaderIfMissing();
      const loader = this.dom.loader;
      if (!loader) return;

      this.state.loaderShownAt = performance.now();
      loader.style.opacity = '1';
      loader.style.display = 'flex';
      this.addClass(loader, 'visible');

      this.log('Loader shown');

      if (this.config.simulateProgress) this._simulateProgress();

      // fallback timeout
      clearTimeout(this.state.loaderTimer);
      this.state.loaderTimer = setTimeout(() => {
        this.warn('Loader fallback timeout reached');
        this.hideLoader();
      }, this.config.loaderFallbackMs);
    } catch (e) {
      this.error('showLoader error', e);
    }
  }

  hideLoader(force = false) {
    try {
      const loader = this.dom.loader;
      const app = this.dom.app;

      // ensure minimum visible time for UX
      const elapsed = this.state.loaderShownAt ? (performance.now() - this.state.loaderShownAt) : Infinity;
      const wait = force ? 0 : Math.max(0, this.config.loaderMinVisibleMs - elapsed);

      clearTimeout(this.state.loaderTimer);
      setTimeout(() => {
        if (loader) {
          loader.style.transition = 'opacity 320ms ease';
          loader.style.opacity = '0';
          setTimeout(() => {
            if (loader.parentNode) loader.parentNode.removeChild(loader);
            this.dom.loader = null;
          }, 350);
        }
        if (app) {
          app.hidden = false;
          app.style.display = '';
        }
        this.log('Loader hidden, app revealed');
      }, wait);
    } catch (e) {
      this.error('hideLoader error', e);
      if (this.dom.app) this.dom.app.hidden = false;
    }
  }

  _simulateProgress() {
    // lightweight simulated progress; stops when hideLoader called
    this.state.progress = 0;
    const step = () => {
      if (!this.dom.loader) return;
      this.state.progress = Math.min(99, this.state.progress + (Math.random() * 6));
      // reflect via data attribute for CSS if needed
      this.dom.loader.dataset.progress = Math.round(this.state.progress);
      if (this.state.progress < 99) {
        this.state.progressTimer = setTimeout(step, this.config.progressIntervalMs);
      }
    };
    step();
  }

  /* ===========================
     Menu (hamburger) + Accessibility
     =========================== */
  setupMenu() {
    const btn = this.dom.hamburger;
    const menu = this.dom.mobileMenu;
    if (!btn || !menu) {
      this.log('Menu elements not found — skipping menu setup');
      return;
    }

    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMenu();
    });

    // close on outside click
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && !btn.contains(e.target) && !menu.hasAttribute('hidden')) {
        this.closeMenu();
      }
    });

    // ESC to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hasAttribute('hidden')) this.closeMenu();
    });
  }

  toggleMenu() {
    if (!this.dom.mobileMenu) return;
    const isOpen = !this.dom.mobileMenu.hasAttribute('hidden');
    if (isOpen) this.closeMenu();
    else this.openMenu();
  }

  openMenu() {
    const menu = this.dom.mobileMenu;
    const btn = this.dom.hamburger;
    if (!menu || !btn) return;
    menu.removeAttribute('hidden');
    btn.setAttribute('aria-expanded', 'true');
    this.addClass(menu, 'is-open');
    this._trapFocus(menu);
    this.state.openMenu = true;
    this.log('Menu opened');
  }

  closeMenu() {
    const menu = this.dom.mobileMenu;
    const btn = this.dom.hamburger;
    if (!menu || !btn) return;
    menu.setAttribute('hidden', '');
    btn.setAttribute('aria-expanded', 'false');
    this.removeClass(menu, 'is-open');
    this._releaseFocus(menu);
    this.state.openMenu = false;
    this.log('Menu closed');
  }

  /* Focus trap (simple) */
  _trapFocus(container) {
    if (!container) return;
    const focusable = container.querySelectorAll('a, button, input, textarea, [tabindex]:not([tabindex="-1"])');
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    // store to element for cleanup
    container.__wai_focus_handler = function (e) {
      if (e.key !== 'Tab') return;
      if (focusable.length === 0) { e.preventDefault(); return; }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    container.addEventListener('keydown', container.__wai_focus_handler);
    // set initial focus
    (first || container).focus();
  }

  _releaseFocus(container) {
    if (!container || !container.__wai_focus_handler) return;
    container.removeEventListener('keydown', container.__wai_focus_handler);
    delete container.__wai_focus_handler;
  }

  

  /* ===========================
     Lazy-loading images + retries
     =========================== */
  setupLazyLoading() {
    const imgs = Array.from(document.querySelectorAll(this.config.lazyImageSelector));
    if (!imgs.length) { this.log('No lazy images'); return; }

    // modern browsers: use native lazy attribute if available
    imgs.forEach(img => {
      img.setAttribute('loading', 'lazy');
    });

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries, obs) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const img = entry.target;
          obs.unobserve(img);
          this._loadImageWithRetry(img);
        });
      }, { rootMargin: '200px' });
      imgs.forEach(img => io.observe(img));
      this.state.observers.push(io);
    } else {
      // fallback: eager load after small delay
      setTimeout(() => imgs.forEach(img => this._loadImageWithRetry(img)), 500);
    }
  }

  _loadImageWithRetry(img) {
    const src = img.dataset.src || img.dataset.srcset;
    if (!src) return;

    const tryLoad = (attempt = 1) => {
      this.log(`Loading image ${src} attempt ${attempt}`);
      return new Promise((resolve, reject) => {
        const temp = new Image();
        const onLoad = () => {
          // apply to element (handle srcset too)
          if (img.dataset.srcset) img.srcset = img.dataset.srcset;
          if (img.dataset.src) img.src = img.dataset.src;
          img.removeAttribute('data-src');
          img.removeAttribute('data-srcset');
          img.classList.add('loaded');
          resolve(img);
        };
        const onError = (err) => {
          temp.onerror = temp.onload = null;
          reject(err || new Error('Image failed'));
        };
        temp.onload = onLoad;
        temp.onerror = onError;
        // set src to trigger
        if (img.dataset.srcset) temp.srcset = img.dataset.srcset;
        if (img.dataset.src) temp.src = img.dataset.src;
      }).catch((err) => {
        if (attempt < this.config.maxImageRetries) {
          const backoff = Math.pow(2, attempt) * 250;
          return new Promise(r => setTimeout(r, backoff)).then(() => tryLoad(attempt + 1));
        } else {
          this.warn('Image failed after retries:', img, err);
          img.classList.add('load-failed');
          return Promise.resolve(null);
        }
      });
    };

    tryLoad();
  }

  /* ===========================
     Reveal animations (on-scroll)
     =========================== */
  setupRevealObserver() {
    this.log('Setting up reveal observer. Reduced motion:', this.state.reducedMotion);
    const selector = this.config.revealSelector;
    const items = Array.from(document.querySelectorAll(selector));
    if (!items.length) return;

    if (this.state.reducedMotion || !('IntersectionObserver' in window)) {
      // simply reveal all without animation
      items.forEach(i => i.classList.add('revealed'));
      return;
    }

    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          const el = en.target;
          el.classList.add('revealed');
          obs.unobserve(el);
        }
      });
    }, { threshold: 0.12 });

    items.forEach(i => io.observe(i));
    this.state.observers.push(io);
  }

  revealAll() {
    document.querySelectorAll(this.config.revealSelector).forEach(e => e.classList.add('revealed'));
  }

  /* ===========================
     Performance & error hooks
     =========================== */
  setupPerformanceObservers() {
    // best-effort FCP / CLS capture
    try {
      if ('PerformanceObserver' in window) {
        try {
          const po = new PerformanceObserver((list) => {
            list.getEntries().forEach(entry => {
              this.log('Perf entry:', entry);
            });
          });
          po.observe({ type: 'paint', buffered: true });
          po.observe({ type: 'layout-shift', buffered: true });
          this.state.observers.push(po);
        } catch (e) {
          this.warn('PerformanceObserver not fully supported:', e);
        }
      }
    } catch (e) { /* ignore */ }
  }

  _onGlobalError(ev) {
    this.error('Global error captured:', ev.message || ev.error || ev);
    // ensure UI shows
    this.hideLoader(true);
  }

  _onUnhandledRejection(ev) {
    this.warn('Unhandled promise rejection:', ev.reason || ev);
    this.hideLoader(true);
  }

  /* ===========================
     Misc / Safety
     =========================== */
  _safetyEnsureAppVisible() {
    // final safeguard: ensure app shown after some time
    setTimeout(() => {
      if (this.dom.app && this.dom.app.hidden) {
        this.warn('Safety: Revealing app forcibly');
        this.hideLoader(true);
      }
    }, Math.max(3000, this.config.loaderFallbackMs + 200));
  }

  _onResize() {
    // respond to reduced-motion toggle if user changes system prefs (best-effort)
    try {
      const rm = window.matchMedia && window.matchMedia(this.config.prefersReducedMotionQuery).matches;
      if (rm !== this.state.reducedMotion) {
        this.state.reducedMotion = rm;
        this.log('Reduced motion changed:', rm);
        // if reducedMotion enabled, reveal all immediately
        if (rm) this.revealAll();
      }
    } catch (e) { /* ignore */ }
  }
}

/* ===========================
   Auto bootstrap with safe guard
   =========================== */
(function bootstrapWai() {
  // expose debug toggle via window.WAI_DEBUG = true before include to enable logs
  const debug = !!(window.WAI_DEBUG);
  const app = new WaiAdvanced({ debug });
  // expose for debugging / manual control
  window.WaiAdvancedApp = app;
  // ensure loader hides when fully loaded (images/fonts done)
  window.addEventListener('load', () => {
    // small delay for final paint
    setTimeout(() => app.hideLoader(), 250);
  });
})();

// ================= Reveal Animation ==================
function revealElementsOnScroll() {
    const elements = document.querySelectorAll("[data-reveal]");

    const reveal = () => {
        elements.forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.top < window.innerHeight - 100) {
                el.classList.add("revealed");
            }
        });
    };

    reveal();

    window.addEventListener("scroll", reveal);
}
