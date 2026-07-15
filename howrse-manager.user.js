// ==UserScript==
// @name         Howrse Manager
// @namespace    https://github.com/less-exe/HowrseManager
// @version      0.1.4
// @description  Умный менеджер-ассистент для Лоwади / Howrse. MVP «Глаза»: анализ лошади и красивый интерфейс (без действий).
// @author       less-exe
// @match        https://www.lowadi.com/*
// @match        http://www.lowadi.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    /* ===== КОНСТАНТЫ ===== */
    const APP = {
        id: 'howrse-manager',
        name: 'Howrse Manager',
        version: '0.1.4',
        storagePrefix: 'hm:',
        subscription: {
            active: true,
            plan: 'Демо-версия',
            expires: '2099-01-01',
        },
        speedModes: {
            normal:  { label: '⚡ Обычный',   base: 1200, spread: 800,  thinkChance: 0.15, thinkTime: [1500, 4000],  desc: 'Быстро. Подходит для небольших табунов.' },
            safe:    { label: '🛡️ Безопасный', base: 3000, spread: 2500, thinkChance: 0.35, thinkTime: [3000, 9000],  desc: 'Медленнее, но максимально похоже на живого игрока. Рекомендуется.' },
            night:   { label: '🌙 Ночной',    base: 6000, spread: 5000, thinkChance: 0.5,  thinkTime: [5000, 20000], desc: 'Очень медленно, с большими паузами. Для работы в фоне.' },
        },
    };

    const PageType = Object.freeze({ HORSE: 'horse', HORSE_LIST: 'horse_list', EC: 'ec', COMPETITIONS: 'competitions', UNKNOWN: 'unknown' });
    const AppStatus = Object.freeze({ IDLE: 'idle', RUNNING: 'running', PAUSED: 'paused', STOPPED: 'stopped', DONE: 'done', ERROR: 'error' });
    const PageLabels = {
        [PageType.HORSE]: 'Страница лошади', [PageType.HORSE_LIST]: 'Список лошадей',
        [PageType.EC]: 'КСК', [PageType.COMPETITIONS]: 'Соревнования', [PageType.UNKNOWN]: 'Неизвестная страница',
    };

    const MENU = [
        { id: 'home',      icon: '🏠', label: 'Главная',      ready: true },
        { id: 'run',       icon: '🐴', label: 'Прогон',        ready: true },
        { id: 'ksk',       icon: '🏡', label: 'КСК',           ready: false },
        { id: 'breeding',  icon: '💕', label: 'Разведение',    ready: false },
        { id: 'training',  icon: '🏇', label: 'Тренировки',    ready: false },
        { id: 'profiles',  icon: '📁', label: 'Профили',       ready: false },
        { id: 'stats',     icon: '📊', label: 'Статистика',    ready: true },
        { id: 'settings',  icon: '⚙️', label: 'Настройки',     ready: true },
        { id: 'about',     icon: 'ℹ️', label: 'О проекте',     ready: true },
        { id: 'developer', icon: '🧑‍💻', label: 'Разработчик',  ready: true, dev: true },
    ];

    const settingsSchema = [
        {
            id: 'speed',
            title: '⏱️ Скорость и безопасность',
            description: 'Как быстро приложение работает. Чем медленнее — тем безопаснее для аккаунта.',
            fields: [
                {
                    id: 'mode', label: 'Режим скорости', type: 'select',
                    options: [
                        { value: 'normal', label: APP.speedModes.normal.label },
                        { value: 'safe',   label: APP.speedModes.safe.label },
                        { value: 'night',  label: APP.speedModes.night.label },
                    ],
                    default: 'safe',
                },
            ],
        },
        {
            id: 'appearance',
            title: '🎨 Внешний вид',
            description: 'Тема оформления окна.',
            fields: [
                { id: 'theme', type: 'select', label: 'Тема', default: 'dark', options: [
                    { value: 'dark', label: 'Тёмная' }, { value: 'light', label: 'Светлая' } ] },
            ],
        },
        {
            id: 'advanced',
            title: '🧑‍💻 Для продвинутых',
            description: 'Дополнительные возможности. Обычным игрокам не нужны.',
            fields: [
                { id: 'devMode', type: 'checkbox', label: 'Показать раздел «Разработчик»', default: false },
            ],
        },
    ];
        /* ===== ШИНА СОБЫТИЙ ===== */
    class EventBus {
        constructor() { this.map = {}; }
        on(evt, cb) { (this.map[evt] ||= []).push(cb); return () => this.off(evt, cb); }
        off(evt, cb) { if (this.map[evt]) this.map[evt] = this.map[evt].filter(f => f !== cb); }
        emit(evt, data) { (this.map[evt] || []).forEach(cb => { try { cb(data); } catch (e) { console.error('[HM] bus', e); } }); }
    }

    /* ===== ХРАНИЛИЩЕ (localStorage) ===== */
    class Storage {
        constructor(prefix) { this.prefix = prefix; }
        get(key, fallback = null) {
            try { const v = localStorage.getItem(this.prefix + key); return v === null ? fallback : JSON.parse(v); }
            catch { return fallback; }
        }
        set(key, value) {
            try { localStorage.setItem(this.prefix + key, JSON.stringify(value)); return true; }
            catch { return false; }
        }
        remove(key) { try { localStorage.removeItem(this.prefix + key); } catch {} }
    }

    /* ===== ЛОГГЕР ===== */
    class Logger {
        constructor(bus, max = 200) { this.bus = bus; this.max = max; this.items = []; }
        _add(type, msg) {
            const entry = { type, msg, time: new Date().toLocaleTimeString() };
            this.items.push(entry);
            if (this.items.length > this.max) this.items.shift();
            this.bus.emit('log', entry);
            const tag = { info: 'ℹ️', ok: '✅', warn: '⚠️', err: '❌', dev: '🔧' }[type] || '•';
            console.log(`[HM ${tag}] ${msg}`);
        }
        info(m) { this._add('info', m); }
        ok(m)   { this._add('ok', m); }
        warn(m) { this._add('warn', m); }
        err(m)  { this._add('err', m); }
        dev(m)  { this._add('dev', m); }
        clear() { this.items = []; this.bus.emit('log:clear'); }
    }

    /* ===== НАСТРОЙКИ ===== */
    class Settings {
        constructor(storage, schema, bus) {
            this.storage = storage; this.schema = schema; this.bus = bus;
            this.values = this._load();
        }
        _defaults() {
            const d = {};
            this.schema.forEach(g => g.fields.forEach(f => { d[f.id] = f.default; }));
            return d;
        }
        _load() {
            const saved = this.storage.get('settings', {});
            return { ...this._defaults(), ...saved };
        }
        get(id) { return this.values[id]; }
        set(id, value) {
            this.values[id] = value;
            this.storage.set('settings', this.values);
            this.bus.emit('settings:change', { id, value });
        }
        all() { return { ...this.values }; }
    }

    /* ===== СОСТОЯНИЕ ПРИЛОЖЕНИЯ ===== */
    class AppState {
        constructor(bus) {
            this.bus = bus;
            this.status = AppStatus.IDLE;
            this.stats = { total: 0, done: 0, current: null };
        }
        setStatus(s) { this.status = s; this.bus.emit('status:change', s); }
        setStats(patch) { Object.assign(this.stats, patch); this.bus.emit('stats:change', this.stats); }
        reset() { this.stats = { total: 0, done: 0, current: null }; this.bus.emit('stats:change', this.stats); }
    }

    /* ===== «МОЗГ» СКОРОСТИ — человекоподобные паузы ===== */
    class HumanizedDelay {
        constructor(settings) { this.settings = settings; }
        _mode() { return APP.speedModes[this.settings.get('mode')] || APP.speedModes.safe; }
        // случайное число в диапазоне [min, max]
        random(min, max) { return Math.floor(min + Math.random() * (max - min)); }
        // пауза-обещание на заданное число мс
        sleep(ms) { return new Promise(res => setTimeout(res, ms)); }
        // основная «человеческая» пауза между действиями
        async wait() {
            const m = this._mode();
            let ms = m.base + this.random(0, m.spread);
            if (Math.random() < m.thinkChance) {
                ms += this.random(m.thinkTime[0], m.thinkTime[1]);
            }
            await this.sleep(ms);
            return ms;
        }
    }
        /* ===== ГЛАЗА: определение типа страницы ===== */
    class PageDetector {
        detect() {
            const url = location.href;
            const path = location.pathname;
            if (/\/elevage\/chevaux\/cheval/i.test(url) || document.querySelector('#horseName, .horseName')) return PageType.HORSE;
            if (/\/elevage\/chevaux/i.test(url)) return PageType.HORSE_LIST;
            if (/\/elevage\/centre/i.test(url)) return PageType.EC;
            if (/\/concours|competitions/i.test(url)) return PageType.COMPETITIONS;
            return PageType.UNKNOWN;
        }
    }

    /* ===== ГЛАЗА: чтение данных лошади ===== */
    class HorseParser {
        constructor(logger) { this.logger = logger; }

        _text(sel) {
            const el = document.querySelector(sel);
            return el ? el.textContent.trim() : null;
        }
        _num(str) {
            if (!str) return null;
            const m = str.replace(/\s/g, '').match(/-?\d+/);
            return m ? parseInt(m[0], 10) : null;
        }

        // читает базовую информацию о лошади со страницы
        parse() {
            const data = {
                name: null,
                age: null,
                energy: null,
                health: null,
                hasNextButton: false,
                actions: [],
            };

            // имя
            data.name = this._text('#horseName') || this._text('.horseName') || this._text('h1');

            // возраст (примерный поиск по тексту)
            const ageText = this._text('.horseAge') || this._findByLabel(/возраст|âge|age/i);
            data.age = ageText;

            // энергия / здоровье — ищем полоски-показатели
            data.energy = this._readGauge(/энерг|energie|energy/i);
            data.health = this._readGauge(/здоров|santé|health/i);

            // кнопка «следующая лошадь»
            const nextBtn = document.querySelector('#nav-next, .nav-next, [rel="next"]');
            data.hasNextButton = !!nextBtn;

            // доступные действия (кнопки на странице лошади)
            data.actions = this._collectActions();

            return data;
        }

        // ищет значение рядом с подписью по ключевому слову
        _findByLabel(regex) {
            const nodes = document.querySelectorAll('td, span, div, li, dt, dd');
            for (const n of nodes) {
                if (regex.test(n.textContent) && n.textContent.length < 60) {
                    return n.textContent.trim();
                }
            }
            return null;
        }

        // читает полоску-индикатор (энергия/здоровье) в процентах
        _readGauge(regex) {
            const bars = document.querySelectorAll('[class*="gauge"], [class*="jauge"], .progress, [class*="bar"]');
            for (const b of bars) {
                const around = (b.parentElement?.textContent || '') + b.className;
                if (regex.test(around)) {
                    const w = b.style.width;
                    if (w && w.includes('%')) return parseInt(w, 10);
                    const num = this._num(b.textContent);
                    if (num !== null) return num;
                }
            }
            return null;
        }

        // собирает список видимых кнопок действий
        _collectActions() {
            const actions = [];
            const keywords = [
                { re: /кормить|nourrir|feed/i,        key: 'feed',   label: '🥕 Покормить' },
                { re: /поить|abreuver|water|drink/i,  key: 'water',  label: '💧 Напоить' },
                { re: /гладить|caresser|stroke|pet/i, key: 'pet',    label: '🤚 Погладить' },
                { re: /чистить|brosser|groom|brush/i, key: 'groom',  label: '🧽 Почистить' },
                { re: /тренир|entraîner|train/i,      key: 'train',  label: '🏇 Тренировать' },
            ];
            const btns = document.querySelectorAll('a, button, input[type="button"], input[type="submit"]');
            btns.forEach(btn => {
                const label = (btn.textContent || btn.value || btn.title || '').trim();
                if (!label || label.length > 40) return;
                for (const k of keywords) {
                    if (k.re.test(label) && !actions.find(a => a.key === k.key)) {
                        actions.push({ key: k.key, label: k.label, found: label });
                        break;
                    }
                }
            });
            return actions;
        }
    }
        /* ===== СТИЛИ ===== */
    const CSS = `
    #${APP.id}-root, #${APP.id}-root * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; }
    #${APP.id}-root {
        position: fixed; z-index: 999999; top: 80px; left: 20px;
        width: 460px; max-width: 95vw;
        border-radius: 16px; overflow: hidden;
        box-shadow: 0 12px 40px rgba(0,0,0,.4);
        font-size: 14px; color: var(--hm-text);
        --hm-bg: #1e2233; --hm-bg2: #262b40; --hm-text: #e8ebf5;
        --hm-muted: #9aa3bd; --hm-accent: #6c8cff; --hm-accent2: #4a67e0;
        --hm-ok: #4ade80; --hm-warn: #fbbf24; --hm-err: #f87171; --hm-line: rgba(255,255,255,.08);
    }
    #${APP.id}-root.hm-light {
        --hm-bg: #ffffff; --hm-bg2: #f2f4fb; --hm-text: #1e2233;
        --hm-muted: #6b7280; --hm-line: rgba(0,0,0,.08);
    }
    .hm-header {
        background: linear-gradient(135deg, var(--hm-accent), var(--hm-accent2));
        color: #fff; padding: 12px 14px; cursor: grab; user-select: none;
        display: flex; align-items: center; gap: 10px;
    }
    .hm-header.dragging { cursor: grabbing; }
    .hm-title { font-weight: 700; font-size: 15px; }
    .hm-ver { font-size: 11px; opacity: .8; background: rgba(255,255,255,.2); padding: 1px 7px; border-radius: 20px; }
    .hm-header-spacer { flex: 1; }
    .hm-icon-btn {
        background: rgba(255,255,255,.15); border: none; color: #fff; cursor: pointer;
        width: 26px; height: 26px; border-radius: 8px; font-size: 14px; line-height: 1;
        display: flex; align-items: center; justify-content: center; transition: .15s;
    }
    .hm-icon-btn:hover { background: rgba(255,255,255,.3); }

    .hm-body { display: flex; background: var(--hm-bg); min-height: 340px; }
    #${APP.id}-root.hm-collapsed .hm-body { display: none; }

    .hm-nav {
        width: 130px; background: var(--hm-bg2); padding: 8px 6px;
        display: flex; flex-direction: column; gap: 2px; border-right: 1px solid var(--hm-line);
    }
    .hm-nav-item {
        display: flex; align-items: center; gap: 8px; padding: 8px 9px; border-radius: 9px;
        cursor: pointer; color: var(--hm-muted); transition: .15s; font-size: 13px; white-space: nowrap;
    }
    .hm-nav-item:hover { background: var(--hm-line); color: var(--hm-text); }
    .hm-nav-item.active { background: var(--hm-accent); color: #fff; }
    .hm-nav-item.locked { opacity: .45; cursor: default; }
    .hm-nav-item .hm-soon { margin-left: auto; font-size: 9px; background: var(--hm-warn); color: #000; padding: 1px 5px; border-radius: 10px; }

    .hm-content { flex: 1; padding: 14px; overflow-y: auto; max-height: 70vh; }
    .hm-content::-webkit-scrollbar { width: 8px; }
    .hm-content::-webkit-scrollbar-thumb { background: var(--hm-line); border-radius: 8px; }

    .hm-h { font-size: 16px; font-weight: 700; margin: 0 0 4px; }
    .hm-sub { color: var(--hm-muted); font-size: 12px; margin: 0 0 14px; }
    .hm-card { background: var(--hm-bg2); border: 1px solid var(--hm-line); border-radius: 12px; padding: 12px; margin-bottom: 12px; }
    .hm-card h4 { margin: 0 0 8px; font-size: 13px; }
    .hm-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 13px; border-bottom: 1px dashed var(--hm-line); }
    .hm-row:last-child { border-bottom: none; }
    .hm-row .k { color: var(--hm-muted); }
    .hm-row .v { font-weight: 600; }

    .hm-badge { display: inline-block; padding: 2px 9px; border-radius: 20px; font-size: 11px; font-weight: 600; }
    .hm-badge.ok { background: rgba(74,222,128,.15); color: var(--hm-ok); }
    .hm-badge.warn { background: rgba(251,191,36,.15); color: var(--hm-warn); }
    .hm-badge.err { background: rgba(248,113,113,.15); color: var(--hm-err); }
    .hm-badge.muted { background: var(--hm-line); color: var(--hm-muted); }

    .hm-btn {
        border: none; border-radius: 10px; padding: 9px 14px; font-size: 13px; font-weight: 600;
        cursor: pointer; transition: .15s; color: #fff; background: var(--hm-accent);
    }
    .hm-btn:hover { filter: brightness(1.1); }
    .hm-btn:disabled { opacity: .4; cursor: not-allowed; }
    .hm-btn.ghost { background: var(--hm-line); color: var(--hm-text); }
    .hm-btn.ok { background: var(--hm-ok); color: #05240f; }
    .hm-btn.err { background: var(--hm-err); }
    .hm-btn-row { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }

    /* красивые блоки прогресса (перенос из 0.2.1) */
    .hm-stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; }
    .hm-stat-box { background: var(--hm-bg2); border: 1px solid var(--hm-line); border-radius: 12px; padding: 10px; text-align: center; }
    .hm-stat-box .num { font-size: 22px; font-weight: 800; }
    .hm-stat-box .lbl { font-size: 11px; color: var(--hm-muted); margin-top: 2px; }
    .hm-stat-box.left .num { color: var(--hm-accent); }
    .hm-stat-box.done .num { color: var(--hm-ok); }
    .hm-stat-box.proc .num { color: var(--hm-warn); }

    .hm-select, .hm-input {
        width: 100%; padding: 8px 10px; border-radius: 9px; border: 1px solid var(--hm-line);
        background: var(--hm-bg); color: var(--hm-text); font-size: 13px;
    }
    .hm-field { margin-bottom: 12px; }
    .hm-field label { display: block; font-size: 12px; color: var(--hm-muted); margin-bottom: 5px; }
    .hm-check { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .hm-check input { width: 16px; height: 16px; }

    .hm-log { background: #0d1020; border-radius: 10px; padding: 8px; font-family: monospace; font-size: 11px; max-height: 180px; overflow-y: auto; }
    .hm-log-line { padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,.04); }
    .hm-log-line .t { color: var(--hm-muted); }
    .hm-log-line.ok { color: var(--hm-ok); }
    .hm-log-line.warn { color: var(--hm-warn); }
    .hm-log-line.err { color: var(--hm-err); }
    .hm-log-line.dev { color: var(--hm-accent); }

    .hm-status-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
    .hm-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--hm-muted); }
    .hm-dot.running { background: var(--hm-ok); animation: hm-pulse 1s infinite; }
    .hm-dot.paused { background: var(--hm-warn); }
    .hm-dot.error { background: var(--hm-err); }
    @keyframes hm-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
    `;
        /* ===== ИНТЕРФЕЙС ===== */
    class UI {
        constructor(ctx) {
            this.ctx = ctx; // { bus, storage, logger, settings, state, detector, parser, delay }
            this.root = null;
            this.activeTab = 'home';
            this._injectStyles();
            this._build();
            this._bindEvents();
            this.show('home');
        }

        _injectStyles() {
            const s = document.createElement('style');
            s.id = APP.id + '-style';
            s.textContent = CSS;
            document.head.appendChild(s);
        }

        _build() {
            const root = document.createElement('div');
            root.id = APP.id + '-root';
            if (this.ctx.settings.get('theme') === 'light') root.classList.add('hm-light');

            root.innerHTML = `
                <div class="hm-header">
                    <span>🐴</span>
                    <span class="hm-title">${APP.name}</span>
                    <span class="hm-ver">v${APP.version}</span>
                    <span class="hm-header-spacer"></span>
                    <button class="hm-icon-btn" data-act="collapse" title="Свернуть">▁</button>
                    <button class="hm-icon-btn" data-act="close" title="Скрыть">✕</button>
                </div>
                <div class="hm-body">
                    <nav class="hm-nav"></nav>
                    <div class="hm-content"></div>
                </div>
            `;
            document.body.appendChild(root);
            this.root = root;
            this.nav = root.querySelector('.hm-nav');
            this.content = root.querySelector('.hm-content');

            this._renderNav();
            this._restorePosition();
            this._enableDrag();
        }

        _renderNav() {
            const devOn = this.ctx.settings.get('devMode');
            this.nav.innerHTML = '';
            MENU.forEach(item => {
                if (item.dev && !devOn) return;
                const el = document.createElement('div');
                el.className = 'hm-nav-item' + (item.ready ? '' : ' locked') + (item.id === this.activeTab ? ' active' : '');
                el.dataset.tab = item.id;
                el.innerHTML = `<span>${item.icon}</span><span>${item.label}</span>` + (item.ready ? '' : '<span class="hm-soon">скоро</span>');
                if (item.ready) el.addEventListener('click', () => this.show(item.id));
                this.nav.appendChild(el);
            });
        }

        show(tab) {
            this.activeTab = tab;
            this.nav.querySelectorAll('.hm-nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === tab));
            const render = this['_screen_' + tab];
            this.content.innerHTML = render ? render.call(this) : '<p class="hm-sub">Экран в разработке.</p>';
            const after = this['_after_' + tab];
            if (after) after.call(this);
        }

        /* --- Экран: Главная --- */
        _screen_home() {
            const pt = this.ctx.detector.detect();
            const sub = APP.subscription;
            return `
                <h3 class="hm-h">Привет! 👋</h3>
                <p class="hm-sub">Я твой помощник по лошадкам. Сейчас работаю в режиме «Глаза»: смотрю и анализирую, но ничего не нажимаю сам.</p>
                <div class="hm-card">
                    <h4>📍 Где мы находимся</h4>
                    <div class="hm-row"><span class="k">Тип страницы</span><span class="v">${PageLabels[pt]}</span></div>
                    <div class="hm-row"><span class="k">Подписка</span><span class="v"><span class="hm-badge ${sub.active ? 'ok' : 'err'}">${sub.active ? sub.plan : 'неактивна'}</span></span></div>
                </div>
                <div class="hm-card">
                    <h4>🚀 С чего начать</h4>
                    <p class="hm-sub" style="margin:0">Открой страницу лошади и зайди в раздел <b>🐴 Прогон</b> — я покажу, что вижу.</p>
                    <div class="hm-btn-row">
                        <button class="hm-btn" data-goto="run">🐴 Открыть Прогон</button>
                        <button class="hm-btn ghost" data-goto="about">ℹ️ О проекте</button>
                    </div>
                </div>
            `;
        }
        _after_home() {
            this.content.querySelectorAll('[data-goto]').forEach(b =>
                b.addEventListener('click', () => this.show(b.dataset.goto)));
        }

        /* --- Экран: Прогон --- */
        _screen_run() {
            const pt = this.ctx.detector.detect();
            const onHorse = pt === PageType.HORSE;
            const st = this.ctx.state.stats;
            return `
                <h3 class="hm-h">🐴 Прогон лошадей</h3>
                <p class="hm-sub">Здесь будет автоматический обход табуна. Пока — режим анализа: смотрим текущую лошадь.</p>

                <div class="hm-stats-grid">
                    <div class="hm-stat-box left"><div class="num" id="hm-st-left">${Math.max(0, st.total - st.done)}</div><div class="lbl">Осталось</div></div>
                    <div class="hm-stat-box done"><div class="num" id="hm-st-done">${st.done}</div><div class="lbl">Выполнено</div></div>
                    <div class="hm-stat-box proc"><div class="num" id="hm-st-proc">${this.ctx.state.status === AppStatus.RUNNING ? 1 : 0}</div><div class="lbl">В процессе</div></div>
                </div>

                <div class="hm-card" id="hm-horse-card">
                    <h4>👀 Что я вижу</h4>
                    ${onHorse ? '<p class="hm-sub" id="hm-horse-info">Нажми «Проанализировать».</p>' :
                        '<p class="hm-sub">Ты не на странице лошади. Открой конкретную лошадь, чтобы я мог её прочитать.</p>'}
                </div>

                <div class="hm-btn-row">
                    <button class="hm-btn" data-act="analyze" ${onHorse ? '' : 'disabled'}>🔍 Проанализировать</button>
                    <button class="hm-btn ghost" data-act="clearlog">🧹 Очистить лог</button>
                </div>

                <div class="hm-card" style="margin-top:12px">
                    <h4>📜 Журнал <span class="hm-status-pill"><span class="hm-dot" id="hm-dot"></span><span id="hm-status-text">простой</span></span></h4>
                    <div class="hm-log" id="hm-log"></div>
                </div>
            `;
        }
        _after_run() {
            this._refreshLog();
            this._refreshStatus();
            this.content.querySelector('[data-act="analyze"]')?.addEventListener('click', () => this._doAnalyze());
            this.content.querySelector('[data-act="clearlog"]')?.addEventListener('click', () => this.ctx.logger.clear());
        }

        _doAnalyze() {
            this.ctx.logger.info('Начинаю анализ лошади...');
            const d = this.ctx.parser.parse();
            const box = this.content.querySelector('#hm-horse-info');
            if (box) {
                box.innerHTML = `
                    <div class="hm-row"><span class="k">Имя</span><span class="v">${d.name || '—'}</span></div>
                    <div class="hm-row"><span class="k">Возраст</span><span class="v">${d.age || '—'}</span></div>
                    <div class="hm-row"><span class="k">Энергия</span><span class="v">${d.energy ?? '—'}${d.energy != null ? '%' : ''}</span></div>
                    <div class="hm-row"><span class="k">Здоровье</span><span class="v">${d.health ?? '—'}${d.health != null ? '%' : ''}</span></div>
                    <div class="hm-row"><span class="k">Кнопка «след.»</span><span class="v">${d.hasNextButton ? '✅ есть' : '❌ нет'}</span></div>
                    <div class="hm-row"><span class="k">Действий найдено</span><span class="v">${d.actions.length}</span></div>
                `;
            }
            this.ctx.logger.ok(`Прочитана лошадь: ${d.name || 'без имени'}. Действий: ${d.actions.length}.`);
            if (d.actions.length) this.ctx.logger.dev('Действия: ' + d.actions.map(a => a.label).join(', '));
        }

        /* --- Экран: Статистика --- */
        _screen_stats() {
            const st = this.ctx.state.stats;
            return `
                <h3 class="hm-h">📊 Статистика</h3>
                <p class="hm-sub">Сводка за текущую сессию.</p>
                <div class="hm-stats-grid">
                    <div class="hm-stat-box left"><div class="num">${st.total}</div><div class="lbl">Всего</div></div>
                    <div class="hm-stat-box done"><div class="num">${st.done}</div><div class="lbl">Обработано</div></div>
                    <div class="hm-stat-box proc"><div class="num">${Math.max(0, st.total - st.done)}</div><div class="lbl">Осталось</div></div>
                </div>
                <div class="hm-card"><p class="hm-sub" style="margin:0">Подробная статистика появится, когда добавим автоматические действия. 🌱</p></div>
            `;
        }

        /* --- Экран: Настройки --- */
        _screen_settings() {
            let html = '<h3 class="hm-h">⚙️ Настройки</h3><p class="hm-sub">Настрой приложение под себя.</p>';
            this.ctx.settings.schema.forEach(group => {
                html += `<div class="hm-card"><h4>${group.title}</h4><p class="hm-sub" style="margin:-4px 0 10px">${group.description}</p>`;
                group.fields.forEach(f => {
                    const val = this.ctx.settings.get(f.id);
                    if (f.type === 'select') {
                        html += `<div class="hm-field"><label>${f.label}</label><select class="hm-select" data-set="${f.id}">` +
                            f.options.map(o => `<option value="${o.value}" ${o.value === val ? 'selected' : ''}>${o.label}</option>`).join('') +
                            `</select></div>`;
                        if (f.id === 'mode') html += `<p class="hm-sub" id="hm-mode-desc" style="margin:-6px 0 0">${APP.speedModes[val].desc}</p>`;
                    } else if (f.type === 'checkbox') {
                        html += `<label class="hm-check hm-field"><input type="checkbox" data-set="${f.id}" ${val ? 'checked' : ''}><span>${f.label}</span></label>`;
                    }
                });
                html += `</div>`;
            });
            return html;
        }
        _after_settings() {
            this.content.querySelectorAll('[data-set]').forEach(el => {
                const id = el.dataset.set;
                const evt = el.type === 'checkbox' ? 'change' : 'change';
                el.addEventListener(evt, () => {
                    const value = el.type === 'checkbox' ? el.checked : el.value;
                    this.ctx.settings.set(id, value);
                    this.ctx.logger.dev(`Настройка «${id}» → ${value}`);
                    if (id === 'theme') this.root.classList.toggle('hm-light', value === 'light');
                    if (id === 'devMode') this._renderNav();
                    if (id === 'mode') {
                        const desc = this.content.querySelector('#hm-mode-desc');
                        if (desc) desc.textContent = APP.speedModes[value].desc;
                    }
                });
            });
        }

        /* --- Экран: О проекте --- */
        _screen_about() {
            return `
                <h3 class="hm-h">ℹ️ О проекте</h3>
                <div class="hm-card">
                    <div class="hm-row"><span class="k">Название</span><span class="v">${APP.name}</span></div>
                    <div class="hm-row"><span class="k">Версия</span><span class="v">${APP.version}</span></div>
                    <div class="hm-row"><span class="k">Автор</span><span class="v">${APP.author || 'less-exe'}</span></div>
                    <div class="hm-row"><span class="k">Этап</span><span class="v">MVP «Глаза» 👀</span></div>
                </div>
                <div class="hm-card">
                    <h4>💡 Идея</h4>
                    <p class="hm-sub" style="margin:0">Умный ассистент для ухода за лошадьми. Работает аккуратно, по-человечески, чтобы не навредить аккаунту. Сейчас учится «видеть» — дальше научим «действовать». 🌱</p>
                </div>
            `;
        }

        /* --- Экран: Разработчик --- */
        _screen_developer() {
            const pt = this.ctx.detector.detect();
            return `
                <h3 class="hm-h">🧑‍💻 Разработчик</h3>
                <p class="hm-sub">Технические данные для отладки. Помоги мне понять, что видит скрипт на реальной странице!</p>
                <div class="hm-card">
                    <h4>Страница</h4>
                    <div class="hm-row"><span class="k">Тип</span><span class="v">${pt}</span></div>
                    <div class="hm-row"><span class="k">URL</span><span class="v" style="font-size:10px;word-break:break-all">${location.pathname}</span></div>
                </div>
                <div class="hm-btn-row">
                    <button class="hm-btn" data-act="dump">🔬 Сделать дамп страницы</button>
                    <button class="hm-btn ghost" data-act="resetpos">📍 Сбросить позицию окна</button>
                </div>
                <div class="hm-card" style="margin-top:12px">
                    <h4>Вывод</h4>
                    <div class="hm-log" id="hm-dev-log"><div class="hm-log-line t">Нажми «Сделать дамп»...</div></div>
                </div>
            `;
        }
        _after_developer() {
            this.content.querySelector('[data-act="dump"]')?.addEventListener('click', () => this._devDump());
            this.content.querySelector('[data-act="resetpos"]')?.addEventListener('click', () => {
                this.ctx.storage.remove('pos');
                this.root.style.top = '80px'; this.root.style.left = '20px';
                this.ctx.logger.dev('Позиция окна сброшена.');
            });
        }
        _devDump() {
            const out = this.content.querySelector('#hm-dev-log');
            const d = this.ctx.parser.parse();
            const lines = [
                `Имя: ${d.name}`, `Возраст: ${d.age}`, `Энергия: ${d.energy}`,
                `Здоровье: ${d.health}`, `Кнопка "след.": ${d.hasNextButton}`,
                `Действий: ${d.actions.length}`,
                ...d.actions.map(a => `  • ${a.key} ← "${a.found}"`),
            ];
            out.innerHTML = lines.map(l => `<div class="hm-log-line dev">${l}</div>`).join('');
            this.ctx.logger.dev('Дамп страницы выполнен.');
        }

        /* --- Лог и статус (общие) --- */
        _refreshLog() {
            const box = this.content.querySelector('#hm-log');
            if (!box) return;
            box.innerHTML = this.ctx.logger.items.map(i =>
                `<div class="hm-log-line ${i.type}"><span class="t">${i.time}</span> ${i.msg}</div>`).join('');
            box.scrollTop = box.scrollHeight;
        }
        _refreshStatus() {
            const dot = this.content.querySelector('#hm-dot');
            const txt = this.content.querySelector('#hm-status-text');
            if (!dot) return;
            const map = {
                [AppStatus.IDLE]: ['', 'простой'], [AppStatus.RUNNING]: ['running', 'работаю'],
                [AppStatus.PAUSED]: ['paused', 'пауза'], [AppStatus.ERROR]: ['error', 'ошибка'],
                [AppStatus.DONE]: ['', 'готово'], [AppStatus.STOPPED]: ['', 'остановлено'],
            };
            const [cls, label] = map[this.ctx.state.status] || ['', '—'];
            dot.className = 'hm-dot ' + cls;
            txt.textContent = label;
        }

        /* --- Служебное: сворачивание, закрытие, перетаскивание --- */
        _bindEvents() {
            this.root.querySelector('[data-act="collapse"]').addEventListener('click', () =>
                this.root.classList.toggle('hm-collapsed'));
            this.root.querySelector('[data-act="close"]').addEventListener('click', () => {
                this.root.style.display = 'none';
                this.ctx.logger.info('Окно скрыто. Обнови страницу, чтобы вернуть.');
            });
            this.ctx.bus.on('log', () => this._refreshLog());
            this.ctx.bus.on('log:clear', () => this._refreshLog());
            this.ctx.bus.on('status:change', () => this._refreshStatus());
            this.ctx.bus.on('stats:change', (s) => {
                const l = this.content.querySelector('#hm-st-left');
                const dn = this.content.querySelector('#hm-st-done');
                if (l) l.textContent = Math.max(0, s.total - s.done);
                if (dn) dn.textContent = s.done;
            });
        }

        // перенос из 0.2.1: запоминание позиции окна
        _restorePosition() {
            const pos = this.ctx.storage.get('pos');
            if (pos && typeof pos.top === 'number') {
                this.root.style.top = pos.top + 'px';
                this.root.style.left = pos.left + 'px';
            }
        }
        _enableDrag() {
            const header = this.root.querySelector('.hm-header');
            let sx, sy, st, sl, dragging = false;
            header.addEventListener('mousedown', (e) => {
                if (e.target.closest('.hm-icon-btn')) return;
                dragging = true; header.classList.add('dragging');
                sx = e.clientX; sy = e.clientY;
                const r = this.root.getBoundingClientRect();
                st = r.top; sl = r.left;
                e.preventDefault();
            });
            document.addEventListener('mousemove', (e) => {
                if (!dragging) return;
                this.root.style.top = (st + e.clientY - sy) + 'px';
                this.root.style.left = (sl + e.clientX - sx) + 'px';
            });
            document.addEventListener('mouseup', () => {
                if (!dragging) return;
                dragging = false; header.classList.remove('dragging');
                const r = this.root.getBoundingClientRect();
                this.ctx.storage.set('pos', { top: r.top, left: r.left }); // запоминаем!
            });
        }
    }
        /* ===== СБОРКА ВСЕГО ВМЕСТЕ ===== */
    class App {
        constructor() {
            this.bus      = new EventBus();
            this.storage  = new Storage(APP.id + ':');
            this.logger   = new Logger(this.bus);
            this.settings = new Settings(this.storage, SETTINGS_SCHEMA, this.bus);
            this.state    = new AppState(this.bus);
            this.detector = new PageDetector();
            this.parser   = new HorseParser(this.logger);
            this.delay    = new HumanizedDelay(this.settings);
        }

        start() {
            // защита: не запускаться дважды
            if (document.getElementById(APP.id + '-root')) {
                console.warn('[HM] уже запущен');
                return;
            }

            this.ui = new UI({
                bus: this.bus,
                storage: this.storage,
                logger: this.logger,
                settings: this.settings,
                state: this.state,
                detector: this.detector,
                parser: this.parser,
                delay: this.delay,
            });

            const pt = this.detector.detect();
            this.logger.ok(`${APP.name} v${APP.version} запущен!`);
            this.logger.info(`Тип страницы: ${PageLabels[pt]}`);
            this.logger.info('Режим: «Глаза» 👀 — смотрю, но пока ничего не нажимаю.');
        }
    }

    /* ===== ТОЧКА ВХОДА ===== */
    function boot() {
        try {
            const app = new App();
            app.start();
            // делаем доступным из консоли для отладки
            window.__HM = app;
        } catch (e) {
            console.error('[HM] Критическая ошибка запуска:', e);
            alert('🐴 Помощник не смог запуститься. Открой консоль (F12) и пришли мне ошибку.');
        }
    }

    // ждём, пока страница будет готова
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        // небольшая задержка, чтобы сайт успел прогрузить свой интерфейс
        setTimeout(boot, 800);
    }

})();
