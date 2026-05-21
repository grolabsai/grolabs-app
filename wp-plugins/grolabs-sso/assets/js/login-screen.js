/**
 * GroLabs SSO — login screen client
 *
 * Exposes window.GroLabsSSO.init({ root, lang, config, ... })
 *
 * Has no framework dependencies. Safe to drop into a WordPress login page,
 * a standalone HTML demo, or any other host.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Provider catalog
  // ---------------------------------------------------------------------

  var PROVIDERS = {
    google:    { name: 'Google' },
    facebook:  { name: 'Facebook' },
    apple:     { name: 'Apple', platforms: ['ios', 'ipados', 'macos'] },
    microsoft: { name: 'Microsoft' },
    x:         { name: 'X' },
    linkedin:  { name: 'LinkedIn' },
    github:    { name: 'GitHub' },
    tiktok:    { name: 'TikTok' },
    discord:   { name: 'Discord' },
    twitch:    { name: 'Twitch' },
    yahoo:     { name: 'Yahoo' },
    amazon:    { name: 'Amazon' }
  };

  var DEFAULT_ORDER = [
    'google', 'facebook', 'apple',
    'microsoft', 'x', 'linkedin', 'github', 'tiktok',
    'discord', 'twitch', 'yahoo', 'amazon'
  ];

  var TIER_A_SIZE = 3;
  var TIER_B_SIZE = 5;

  // ---------------------------------------------------------------------
  // Translations
  // ---------------------------------------------------------------------

  var TRANSLATIONS = {
    en: {
      'cta.continue_with':   'Continue with {provider}',
      'cta.sign_in_passkey': 'Sign in with a passkey',
      'cta.more_options':    'More',
      'cta.email_password':  'Sign in with email and password',
      'cta.sign_in':         'Sign in',
      'cta.forgot_password': 'Forgot password?',
      'cta.create_account':  'Create account',
      'placeholder.email':   'Email address',
      'placeholder.password':'Password',
      'divider.or':          'or',
      'pill.last_used':      'Last used',
      'inapp.title':         "You're in the {app} app",
      'inapp.body':          'For sign-in to work, please open this page in your browser.',
      'inapp.open_browser':  'Open in browser',
      'inapp.continue_anyway': 'Continue anyway',
      'error.password':      'Email or password is incorrect.'
    },
    es: {
      'cta.continue_with':   'Continuar con {provider}',
      'cta.sign_in_passkey': 'Iniciar sesión con clave de acceso',
      'cta.more_options':    'Más',
      'cta.email_password':  'Iniciar sesión con correo y contraseña',
      'cta.sign_in':         'Iniciar sesión',
      'cta.forgot_password': '¿Olvidaste tu contraseña?',
      'cta.create_account':  'Crear cuenta',
      'placeholder.email':   'Correo electrónico',
      'placeholder.password':'Contraseña',
      'divider.or':          'o',
      'pill.last_used':      'Última usada',
      'inapp.title':         'Estás en la app de {app}',
      'inapp.body':          'Para iniciar sesión, abre esta página en tu navegador.',
      'inapp.open_browser':  'Abrir en el navegador',
      'inapp.continue_anyway': 'Continuar de todos modos',
      'error.password':      'El correo o la contraseña son incorrectos.'
    }
  };

  function t(key, params, lang) {
    var dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
    var str = dict[key] || TRANSLATIONS.en[key] || key;
    if (params) {
      Object.keys(params).forEach(function (k) {
        str = str.replace('{' + k + '}', params[k]);
      });
    }
    return str;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------------------------------------------------------------------
  // Detection
  // ---------------------------------------------------------------------

  function detectPlatform() {
    var ua = navigator.userAgent;
    if (/iPhone|iPod/.test(ua)) return 'ios';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ipados';
    if (/Macintosh/.test(ua)) return 'macos';
    if (/Android/.test(ua)) return 'android';
    if (/Windows/.test(ua)) return 'windows';
    if (/Linux/.test(ua)) return 'linux';
    return 'other';
  }

  function detectInAppBrowser() {
    var ua = navigator.userAgent;
    if (/FBAN|FBAV/.test(ua)) return 'facebook';
    if (/Instagram/.test(ua)) return 'instagram';
    if (/BytedanceWebview|musical_ly/.test(ua)) return 'tiktok';
    if (/LinkedInApp/.test(ua)) return 'linkedin';
    if (/Snapchat/.test(ua)) return 'snapchat';
    return null;
  }

  function detectReferrerProvider() {
    var params = new URLSearchParams(window.location.search);
    var utm = (params.get('utm_source') || '').toLowerCase();
    var utmMap = {
      google: 'google', google_ads: 'google', gads: 'google', youtube: 'google', yt: 'google',
      facebook: 'facebook', fb: 'facebook', meta: 'facebook',
      instagram: 'facebook', ig: 'facebook',
      apple: 'apple',
      microsoft: 'microsoft', bing: 'microsoft', outlook: 'microsoft',
      twitter: 'x', x: 'x',
      linkedin: 'linkedin', li: 'linkedin',
      github: 'github',
      tiktok: 'tiktok',
      discord: 'discord',
      twitch: 'twitch',
      yahoo: 'yahoo',
      amazon: 'amazon'
    };
    if (utmMap[utm]) return utmMap[utm];

    var ref = document.referrer;
    if (!ref) return null;
    try {
      var host = new URL(ref).hostname.toLowerCase();
      if (/(^|\.)google\./.test(host) || /(^|\.)youtube\.com$/.test(host)) return 'google';
      if (/(^|\.)facebook\.com$/.test(host) || /(^|\.)instagram\.com$/.test(host)) return 'facebook';
      if (/(^|\.)(bing|outlook|office|microsoft|live)\.com$/.test(host)) return 'microsoft';
      if (host === 't.co' || /(^|\.)x\.com$/.test(host) || /(^|\.)twitter\.com$/.test(host)) return 'x';
      if (/(^|\.)linkedin\.com$/.test(host) || host === 'lnkd.in') return 'linkedin';
      if (/(^|\.)github\.com$/.test(host)) return 'github';
      if (/(^|\.)tiktok\.com$/.test(host)) return 'tiktok';
      if (/(^|\.)discord/.test(host)) return 'discord';
      if (/(^|\.)twitch\.tv$/.test(host)) return 'twitch';
      if (/yahoo\./.test(host)) return 'yahoo';
      if (/amazon\./.test(host)) return 'amazon';
    } catch (e) { /* malformed referrer */ }
    return null;
  }

  function getLastUsed() {
    try {
      var v = localStorage.getItem('grolabs_sso_last_provider');
      if (v) return v;
    } catch (e) { /* private mode */ }
    var m = document.cookie.match(/(?:^|;\s*)grolabs_sso_last_provider=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function setLastUsed(id) {
    try { localStorage.setItem('grolabs_sso_last_provider', id); } catch (e) {}
    var expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = 'grolabs_sso_last_provider=' + encodeURIComponent(id) +
      '; expires=' + expires + '; path=/; SameSite=Lax';
  }

  function clearLastUsed() {
    try { localStorage.removeItem('grolabs_sso_last_provider'); } catch (e) {}
    document.cookie = 'grolabs_sso_last_provider=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  }

  // ---------------------------------------------------------------------
  // Ordering — base order + runtime overlays
  // ---------------------------------------------------------------------

  function applyOrdering(baseOrder, options) {
    var platform = options.platform || detectPlatform();
    var applyEverywhere = options.applyEverywhere || [];

    // 1. Filter by enabled set + platform rules
    var order = baseOrder.filter(function (id) {
      var p = PROVIDERS[id];
      if (!p) return false;
      if (p.platforms && applyEverywhere.indexOf(id) === -1) {
        return p.platforms.indexOf(platform) !== -1;
      }
      return true;
    });

    // 2. Last-used wins over referrer
    var lastUsed = options.disableLastUsed ? null : getLastUsed();
    if (lastUsed && order.indexOf(lastUsed) !== -1) {
      order = [lastUsed].concat(order.filter(function (id) { return id !== lastUsed; }));
    } else {
      var refProvider = options.disableReferrer ? null : detectReferrerProvider();
      if (refProvider && order.indexOf(refProvider) !== -1) {
        order = [refProvider].concat(order.filter(function (id) { return id !== refProvider; }));
      }
    }

    return { order: order, lastUsed: lastUsed };
  }

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  function logoSymbol(id) {
    // External symbol sprite reference
    return '<svg aria-hidden="true"><use href="#logo-' + id + '" /></svg>';
  }

  function render(root, options) {
    var lang = options.lang || 'en';
    var baseOrder = (options.config && options.config.order) || DEFAULT_ORDER;
    var ordered = applyOrdering(baseOrder, options);
    var order = ordered.order;
    var lastUsed = ordered.lastUsed;

    var tierA = order.slice(0, TIER_A_SIZE);
    var tierB = order.slice(TIER_A_SIZE, TIER_A_SIZE + TIER_B_SIZE);
    var tierC = order.slice(TIER_A_SIZE + TIER_B_SIZE);

    var inApp = detectInAppBrowser();
    var parts = [];

    // In-app rescue banner
    if (inApp) {
      var appName = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn', snapchat: 'Snapchat' }[inApp];
      parts.push(
        '<div class="gl-inapp-banner" role="alert">' +
          '<div class="gl-inapp-banner__title">' + escapeHtml(t('inapp.title', { app: appName }, lang)) + '</div>' +
          '<div class="gl-inapp-banner__body">' + escapeHtml(t('inapp.body', null, lang)) + '</div>' +
          '<button type="button" class="gl-inapp-banner__button" data-action="open-browser">' +
            escapeHtml(t('inapp.open_browser', null, lang)) +
          '</button>' +
          '<button type="button" class="gl-inapp-banner__continue" data-action="continue-anyway">' +
            escapeHtml(t('inapp.continue_anyway', null, lang)) +
          '</button>' +
        '</div>'
      );
    }

    // Tier A
    parts.push('<div class="gl-tier-a">');
    tierA.forEach(function (id) {
      var p = PROVIDERS[id];
      var label = t('cta.continue_with', { provider: p.name }, lang);
      var pill = id === lastUsed
        ? '<span class="gl-button-a__pill">' + escapeHtml(t('pill.last_used', null, lang)) + '</span>'
        : '';
      parts.push(
        '<button type="button" class="gl-button-a" data-provider="' + id + '" data-action="signin">' +
          '<svg class="gl-button-a__logo" aria-hidden="true"><use href="#logo-' + id + '" /></svg>' +
          '<span class="gl-button-a__label">' + escapeHtml(label) + '</span>' +
          pill +
        '</button>'
      );
    });
    parts.push('</div>');

    // Tier B
    if (tierB.length > 0) {
      parts.push('<div class="gl-tier-b">');
      tierB.forEach(function (id) {
        var p = PROVIDERS[id];
        var label = t('cta.continue_with', { provider: p.name }, lang);
        parts.push(
          '<button type="button" class="gl-button-b" data-provider="' + id + '" data-action="signin" ' +
            'aria-label="' + escapeHtml(label) + '" title="' + escapeHtml(p.name) + '">' +
            '<svg class="gl-button-b__logo" aria-hidden="true"><use href="#logo-' + id + '" /></svg>' +
          '</button>'
        );
      });
      parts.push('</div>');
    }

    // Tier C
    if (tierC.length > 0) {
      var previewCount = Math.min(4, tierC.length);
      var previews = tierC.slice(0, previewCount).map(function (id) {
        return '<svg aria-hidden="true"><use href="#logo-' + id + '" /></svg>';
      }).join('');
      var extraCount = tierC.length - previewCount;

      parts.push(
        '<div class="gl-tier-c">' +
          '<button type="button" class="gl-tier-c__trigger" data-action="toggle-more" aria-expanded="false">' +
            '<span class="gl-tier-c__previews">' + previews + '</span>' +
            (extraCount > 0 ? '<span class="gl-tier-c__count">+' + extraCount + '</span>' : '') +
            '<span class="gl-tier-c__label">' + escapeHtml(t('cta.more_options', null, lang)) + '</span>' +
            '<svg class="gl-tier-c__chevron" aria-hidden="true"><use href="#icon-chevron-down" /></svg>' +
          '</button>' +
          '<div class="gl-tier-c__list" role="menu">' +
            tierC.map(function (id) {
              var p = PROVIDERS[id];
              return '<button type="button" class="gl-tier-c__item" data-provider="' + id + '" data-action="signin" role="menuitem">' +
                       '<svg aria-hidden="true"><use href="#logo-' + id + '" /></svg>' +
                       '<span>' + escapeHtml(t('cta.continue_with', { provider: p.name }, lang)) + '</span>' +
                     '</button>';
            }).join('') +
          '</div>' +
        '</div>'
      );
    }

    // Divider
    parts.push('<div class="gl-divider"><span>' + escapeHtml(t('divider.or', null, lang)) + '</span></div>');

    // Tier D — email/password (fixed-height container)
    var forgotUrl   = options.forgotUrl   || '#';
    var registerUrl = options.registerUrl || '#';
    parts.push(
      '<div class="gl-tier-d">' +
        '<button type="button" class="gl-tier-d__toggle" data-action="expand-email">' +
          '<svg aria-hidden="true"><use href="#icon-email" /></svg>' +
          '<span class="gl-tier-d__toggle-label">' + escapeHtml(t('cta.email_password', null, lang)) + '</span>' +
        '</button>' +
        '<form class="gl-tier-d__form" data-action="signin-password" novalidate>' +
          '<input class="gl-tier-d__input" type="email" name="email" autocomplete="username webauthn" required ' +
            'placeholder="' + escapeHtml(t('placeholder.email', null, lang)) + '">' +
          '<input class="gl-tier-d__input" type="password" name="password" autocomplete="current-password" required ' +
            'placeholder="' + escapeHtml(t('placeholder.password', null, lang)) + '">' +
          '<button type="submit" class="gl-tier-d__submit">' + escapeHtml(t('cta.sign_in', null, lang)) + '</button>' +
          '<div class="gl-tier-d__links">' +
            '<a href="' + escapeHtml(forgotUrl) + '" data-action="forgot">' + escapeHtml(t('cta.forgot_password', null, lang)) + '</a>' +
            '<a href="' + escapeHtml(registerUrl) + '" data-action="register">' + escapeHtml(t('cta.create_account', null, lang)) + '</a>' +
          '</div>' +
        '</form>' +
      '</div>'
    );

    root.innerHTML = parts.join('');

    return { tierA: tierA, tierB: tierB, tierC: tierC, lastUsed: lastUsed };
  }

  // ---------------------------------------------------------------------
  // Behavior — clicks, keyboard, dropdown, form submit
  // ---------------------------------------------------------------------

  function toast(message) {
    var existing = document.querySelector('.gl-toast');
    if (existing) existing.remove();
    var el = document.createElement('div');
    el.className = 'gl-toast';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3500);
  }

  function openInBrowser() {
    var url = window.location.href;
    var ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) {
      window.location.href = url.replace(/^https?:\/\//, 'x-safari-https://');
    } else if (/Android/.test(ua)) {
      window.location.href = 'intent://' + url.replace(/^https?:\/\//, '') +
        '#Intent;scheme=https;package=com.android.chrome;end';
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () {
        toast('Link copied — paste in your browser');
      });
    }
  }

  function bindBehavior(root, options) {
    root.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn || !root.contains(btn)) return;
      var action = btn.dataset.action;
      var provider = btn.dataset.provider;

      switch (action) {
        case 'signin':
          handleProviderSignIn(provider, btn, options);
          break;
        case 'toggle-more':
          var tierC = btn.closest('.gl-tier-c');
          tierC.classList.toggle('is-open');
          btn.setAttribute('aria-expanded', tierC.classList.contains('is-open'));
          break;
        case 'expand-email':
          btn.closest('.gl-tier-d').classList.add('is-expanded');
          setTimeout(function () {
            var emailInput = root.querySelector('input[type="email"]');
            if (emailInput) emailInput.focus();
          }, 50);
          break;
        case 'open-browser':
          openInBrowser();
          break;
        case 'continue-anyway':
          var banner = btn.closest('.gl-inapp-banner');
          if (banner) banner.remove();
          break;
      }
    });

    // Password form submit
    var form = root.querySelector('.gl-tier-d__form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var email = form.email.value.trim();
        var password = form.password.value;
        if (!email || !password) return;

        var submitBtn = form.querySelector('.gl-tier-d__submit');
        submitBtn.disabled = true;

        var done = function (errKey) {
          submitBtn.disabled = false;
          if (errKey) {
            var existing = root.querySelector('.gl-error');
            if (existing) existing.remove();
            var err = document.createElement('div');
            err.className = 'gl-error';
            err.textContent = t(errKey, null, options.lang || 'en');
            form.parentNode.insertBefore(err, form);
          }
        };

        if (typeof options.onPasswordSubmit === 'function') {
          var maybePromise = options.onPasswordSubmit({ email: email, password: password, done: done });
          if (maybePromise && typeof maybePromise.then === 'function') {
            maybePromise.then(function (result) {
              if (result && result.error) done(result.error);
              else done();
            }).catch(function () { done('error.password'); });
          }
        } else {
          // Default: post to the host page's action (WP default) or fall back to toast
          if (options.passwordPostUrl) {
            var formData = new URLSearchParams();
            formData.set('log', email);
            formData.set('pwd', password);
            if (options.redirectTo) formData.set('redirect_to', options.redirectTo);
            if (options.passwordNonce) formData.set('_wpnonce', options.passwordNonce);
            // Build a real form and submit so WP handles redirects/cookies natively
            var realForm = document.createElement('form');
            realForm.method = 'post';
            realForm.action = options.passwordPostUrl;
            formData.forEach(function (v, k) {
              var inp = document.createElement('input');
              inp.type = 'hidden';
              inp.name = k;
              inp.value = v;
              realForm.appendChild(inp);
            });
            document.body.appendChild(realForm);
            realForm.submit();
          } else {
            toast('Demo: would sign in as ' + email);
            done();
          }
        }
      });
    }

    // Mobile keyboard handling — shift viewport when inputs focus
    root.querySelectorAll('input').forEach(function (input) {
      input.addEventListener('focus', function () {
        document.body.classList.add('gl-keyboard-visible');
      });
      input.addEventListener('blur', function () {
        setTimeout(function () {
          if (!document.querySelector('.gl-login-root input:focus')) {
            document.body.classList.remove('gl-keyboard-visible');
          }
        }, 100);
      });
    });
  }

  function handleProviderSignIn(providerId, btn, options) {
    btn.classList.add('is-loading');

    // Custom handler override
    if (typeof options.onProviderSignIn === 'function') {
      var result = options.onProviderSignIn(providerId, btn);
      if (result && typeof result.then === 'function') {
        result.finally(function () { btn.classList.remove('is-loading'); });
      } else {
        setTimeout(function () { btn.classList.remove('is-loading'); }, 1000);
      }
      return;
    }

    // Built-in provider handlers
    if (providerId === 'google' && options.googleClientId) {
      startGoogleOAuth(options);
      return;
    }

    // No handler configured — demo toast
    setTimeout(function () {
      btn.classList.remove('is-loading');
      toast('Demo: would redirect to ' + (PROVIDERS[providerId]?.name || providerId) + ' OAuth');
    }, 500);
  }

  // ---------------------------------------------------------------------
  // Google OAuth (implicit redirect flow, frontend-only)
  // ---------------------------------------------------------------------

  function startGoogleOAuth(options) {
    var clientId = options.googleClientId;
    var redirectUri = options.googleRedirectUri || (window.location.origin + window.location.pathname);
    var nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { sessionStorage.setItem('grolabs_sso_google_nonce', nonce); } catch (e) {}

    setLastUsed('google');

    var params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'id_token token',
      scope: 'openid email profile',
      nonce: nonce,
      prompt: 'select_account'
    });
    window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
  }

  function handleGoogleReturn(options) {
    if (!window.location.hash || window.location.hash.length < 2) return null;
    var hash = new URLSearchParams(window.location.hash.slice(1));
    var idToken = hash.get('id_token');
    if (!idToken) return null;

    try {
      var payloadJson = atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'));
      var payload = JSON.parse(decodeURIComponent(escape(payloadJson)));
      // Clear the hash so a refresh doesn't re-process
      history.replaceState(null, '', window.location.pathname + window.location.search);

      if (typeof options.onGoogleCredential === 'function') {
        options.onGoogleCredential({ id_token: idToken, payload: payload });
      } else if (options.googleVerifyUrl) {
        // POST the id_token to the host's verification endpoint and let it
        // set the auth cookie + redirect.
        fetch(options.googleVerifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ id_token: idToken, redirect_to: options.redirectTo || null })
        }).then(function (r) { return r.json(); })
          .then(function (res) {
            if (res && res.ok && res.redirect_to) {
              window.location.href = res.redirect_to;
            } else {
              toast((res && res.message) || 'Sign-in failed');
            }
          })
          .catch(function () { toast('Sign-in failed'); });
      } else {
        toast('Demo: signed in as ' + payload.email);
      }
      return payload;
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------------
  // Passkey conditional UI
  // ---------------------------------------------------------------------

  async function setupPasskeyConditionalUI(root, options) {
    if (!window.PublicKeyCredential || !PublicKeyCredential.isConditionalMediationAvailable) return;
    try {
      var available = await PublicKeyCredential.isConditionalMediationAvailable();
      if (!available) return;
      // Conditional UI is wired via autocomplete="username webauthn" on the email input.
      // The native autofill surface shows any passkey registered for this RP.
      // No additional DOM is needed at this layer.
    } catch (e) { /* not supported */ }
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  function init(opts) {
    opts = opts || {};
    var root = typeof opts.root === 'string' ? document.querySelector(opts.root) : opts.root;
    if (!root) throw new Error('GroLabsSSO: root element not found');
    root.classList.add('gl-login-root');

    render(root, opts);
    bindBehavior(root, opts);
    setupPasskeyConditionalUI(root, opts);
    handleGoogleReturn(opts);
  }

  window.GroLabsSSO = {
    init: init,
    clearLastUsed: clearLastUsed,
    _internal: {
      applyOrdering: applyOrdering,
      detectPlatform: detectPlatform,
      detectInAppBrowser: detectInAppBrowser,
      detectReferrerProvider: detectReferrerProvider,
      PROVIDERS: PROVIDERS,
      DEFAULT_ORDER: DEFAULT_ORDER,
      TRANSLATIONS: TRANSLATIONS
    }
  };
})();
