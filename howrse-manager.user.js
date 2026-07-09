// ==UserScript==
// @name         Howrse Manager
// @namespace    https://github.com/less-exe/HowrseManager
// @version      0.1.0
// @description  Умный менеджер табуна для Ловади / Howrse. v0.1: каркас приложения, интерфейс, настройки, лог.
// @author       less-exe
// @match        https://www.lowadi.com/*
// @match        http://www.lowadi.com/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const APP = {
        id: 'howrse-manager',
        name: 'Howrse Manager',
        version: '0.1.0',
        storagePrefix: 'hm:v0.1',
    };

    const PageType = Object.freeze({
        HORSE: 'horse',
        HORSE_LIST: 'horse_list',
        UNKNOWN: 'unknown',
    });

    const AppStatus = Object.freeze({
        IDLE: 'idle',
        RUNNING: 'running',
        PAUSED: 'paused',
        STOPPED: 'stopped',
        ERROR: 'error',
    });

    const settingsSchema = [
        {
            id: 'appearance',
            title: 'Внешний вид',
            description: 'Тема и поведение окна приложения.',
            fields: [
                {
                    id: 'theme',
                    type: 'select',
                    label: 'Тема',
                    default: 'auto',
                    options: [
                        { value: 'auto', label: 'Авто' },
                        { value: 'light', label: 'Светлая' },
                        { value: 'dark', label: 'Тёмная' },
                    ],
                },
                {
                    id: 'compactMode',
                    type: 'checkbox',
                    label: 'Компактный режим',
                    default: false,
                },
            ],
        },
        {
            id: 'run',
            title: 'Прогон',
            description: 'Базовые настройки будущего прогона табуна.',
            fields: [
                {
                    id: 'stopAfterCurrentHorse',
                    type: 'checkbox',
                    label: 'Мягкая остановка после текущей лошади',
                    default: false,
                },
                {
                    id: 'energyLimit',
                    type: 'number',
                    label: 'Остаток энергии для активности, %',
                    default: 20,
                    min: 0,
                    max: 100,
                    step: 1,
                },
            ],
        },
        {
            id: 'developer',
            title: 'Разработчик',
            description: 'Помогает тестировать поиск страниц и будущих игровых элементов.',
            fields: [
                {
                    id: 'enabled',
                    type: 'checkbox',
                    label: 'Включить режим разработчика',
                    default: true,
                },
            ],
        },
    ];

    class EventBus {
        constructor() {
            this.listeners = new Map();
        }

        on(eventName, callback) {
            if (!this.listeners.has(eventName)) {
                this.listeners.set(eventName, new Set());
            }

            this.listeners.get(eventName).add(callback);

            return () => this.off(eventName, callback);
        }

        off(eventName, callback) {
            const callbacks = this.listeners.get(eventName);
            if (!callbacks) return;
            callbacks.delete(callback);
        }

        emit(eventName, payload) {
            const callbacks = this.listeners.get(eventName);
            if (!callbacks) return;

            callbacks.forEach((callback) => {
                try {
                    callback(payload);
                } catch (error) {
                    console.error(`[${APP.name}] Event handler error`, error);
                }
            });
        }
    }

    class Storage {
        constructor(prefix) {
            this.prefix = prefix;
        }

        key(name) {
            return `${this.prefix}:${name}`;
        }

        get(name, fallback = null) {
            try {
                const value = window.localStorage.getItem(this.key(name));
                return value === null ? fallback : JSON.parse(value);
            } catch (error) {
                console.warn(`[${APP.name}] Failed to read storage key: ${name}`, error);
                return fallback;
            }
        }

        set(name, value) {
            try {
                window.localStorage.setItem(this.key(name), JSON.stringify(value));
            } catch (error) {
                console.warn(`[${APP.name}] Failed to write storage key: ${name}`, error);
            }
        }

        remove(name) {
            window.localStorage.removeItem(this.key(name));
        }
    }

    class Logger {
        constructor(eventBus, storage) {
            this.eventBus = eventBus;
            this.storage = storage;
            this.maxItems = 250;
            this.items = this.storage.get('log', []);
        }

        add(level, message, details = null) {
            const item = {
                id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                level,
                message,
                details,
            };

            this.items.unshift(item);
            this.items = this.items.slice(0, this.maxItems);
            this.storage.set('log', this.items);
            this.eventBus.emit('log:changed', this.items);
        }

        info(message, details = null) {
            this.add('info', message, details);
        }

        success(message, details = null) {
            this.add('success', message, details);
        }

        warn(message, details = null) {
            this.add('warn', message, details);
        }

        error(message, details = null) {
            this.add('error', message, details);
        }

        clear() {
            this.items = [];
            this.storage.set('log', this.items);
            this.eventBus.emit('log:changed', this.items);
        }

        all() {
            return [...this.items];
        }
    }

    class SettingsManager {
        constructor(eventBus, storage, schema) {
            this.eventBus = eventBus;
            this.storage = storage;
            this.schema = schema;
            this.defaults = this.createDefaults(schema);
            this.settings = this.load();
        }

        createDefaults(schema) {
            const defaults = { version: 1 };

            schema.forEach((section) => {
                defaults[section.id] = {};
                section.fields.forEach((field) => {
                    defaults[section.id][field.id] = field.default;
                });
            });

            return defaults;
        }

        load() {
            const saved = this.storage.get('settings', {});
            return this.mergeDeep(this.defaults, saved);
        }

        mergeDeep(base, override) {
            const output = Array.isArray(base) ? [...base] : { ...base };

            Object.keys(override || {}).forEach((key) => {
                if (override[key] && typeof override[key] === 'object' && !Array.isArray(override[key])) {
                    output[key] = this.mergeDeep(output[key] || {}, override[key]);
                } else {
                    output[key] = override[key];
                }
            });

            return output;
        }

        get(sectionId, fieldId = null) {
            if (!fieldId) return this.settings[sectionId];
            return this.settings?.[sectionId]?.[fieldId];
        }

        set(sectionId, fieldId, value) {
            if (!this.settings[sectionId]) {
                this.settings[sectionId] = {};
            }

            this.settings[sectionId][fieldId] = value;
            this.storage.set('settings', this.settings);
            this.eventBus.emit('settings:changed', this.settings);
        }

        reset() {
            this.settings = this.createDefaults(this.schema);
            this.storage.set('settings', this.settings);
            this.eventBus.emit('settings:changed', this.settings);
        }

        all() {
            return this.settings;
        }
    }

    class StateManager {
        constructor(eventBus, storage) {
            this.eventBus = eventBus;
            this.storage = storage;
            this.state = this.storage.get('state', this.createInitialState());
        }

        createInitialState() {
            return {
                status: AppStatus.IDLE,
                currentHorseId: null,
                currentHorseName: '—',
                currentOperation: 'Ожидание',
                progress: {
                    current: 0,
                    total: 0,
                },
                startedAt: null,
                lastActionAt: null,
                pageType: PageType.UNKNOWN,
            };
        }

        get() {
            return { ...this.state, progress: { ...this.state.progress } };
        }

        patch(partial) {
            this.state = {
                ...this.state,
                ...partial,
                progress: {
                    ...this.state.progress,
                    ...(partial.progress || {}),
                },
            };

            this.storage.set('state', this.state);
            this.eventBus.emit('state:changed', this.get());
        }

        start() {
            this.patch({
                status: AppStatus.RUNNING,
                currentOperation: 'Запуск приложения',
                startedAt: this.state.startedAt || Date.now(),
                lastActionAt: Date.now(),
            });
        }

        pause() {
            this.patch({
                status: AppStatus.PAUSED,
                currentOperation: 'Пауза',
                lastActionAt: Date.now(),
            });
        }

        stop() {
            this.patch({
                status: AppStatus.STOPPED,
                currentOperation: 'Остановлено',
                lastActionAt: Date.now(),
            });
        }
    }

    class DelayManager {
        constructor(settingsManager) {
            this.settingsManager = settingsManager;
        }

        wait(ms) {
            return new Promise((resolve) => window.setTimeout(resolve, ms));
        }

        random(min = 300, max = 900) {
            const duration = Math.floor(Math.random() * (max - min + 1)) + min;
            return this.wait(duration);
        }
    }

    class RouteManager {
        getCurrentPageType() {
            const path = window.location.pathname;
            const href = window.location.href;

            if (/chevaux|elevage|horse|fiche|fichecheval/i.test(path) || /id=\d+/i.test(href)) {
                return PageType.HORSE;
            }

            if (/elevage|chevaux|liste|horse-list|my-horses/i.test(path)) {
                return PageType.HORSE_LIST;
            }

            return PageType.UNKNOWN;
        }
    }

    class GameAdapter {
        constructor(routeManager) {
            this.routeManager = routeManager;
        }

        getName() {
            return 'BaseAdapter';
        }

        isSupported() {
            return false;
        }

        getPageInfo() {
            return {
                hostname: window.location.hostname,
                url: window.location.href,
                pageType: this.routeManager.getCurrentPageType(),
                adapter: this.getName(),
                supported: this.isSupported(),
            };
        }
    }

    class LowadiAdapter extends GameAdapter {
        getName() {
            return 'LowadiAdapter';
        }

        isSupported() {
            return window.location.hostname === 'www.lowadi.com';
        }
    }

    class AdapterFactory {
        static create(routeManager) {
            const hostname = window.location.hostname;

            if (hostname === 'www.lowadi.com') {
                return new LowadiAdapter(routeManager);
            }

            return new GameAdapter(routeManager);
        }
    }

    class UIManager {
        constructor({ eventBus, logger, settingsManager, stateManager, adapter }) {
            this.eventBus = eventBus;
            this.logger = logger;
            this.settingsManager = settingsManager;
            this.stateManager = stateManager;
            this.adapter = adapter;
            this.activePage = 'home';
            this.host = null;
            this.root = null;
            this.drag = null;
            this.pages = [
                { id: 'home', icon: '🏠', label: 'Главная' },
                { id: 'run', icon: '🐴', label: 'Прогон' },
                { id: 'activity', icon: '🏇', label: 'Активность' },
                { id: 'ec', icon: '🏡', label: 'КСК' },
                { id: 'blacklist', icon: '🚫', label: 'Чёрный список' },
                { id: 'stats', icon: '📊', label: 'Статистика' },
                { id: 'developer', icon: '🧪', label: 'Разработчик' },
                { id: 'settings', icon: '⚙', label: 'Настройки' },
            ];
        }

        mount() {
            if (document.getElementById(`${APP.id}-root`)) return;

            this.host = document.createElement('div');
            this.host.id = `${APP.id}-root`;
            document.documentElement.appendChild(this.host);
            this.root = this.host.attachShadow({ mode: 'open' });
            this.render();
            this.bindEvents();

            this.eventBus.on('state:changed', () => this.render());
            this.eventBus.on('settings:changed', () => this.render());
            this.eventBus.on('log:changed', () => this.render());
        }

        getTheme() {
            const theme = this.settingsManager.get('appearance', 'theme');
            if (theme !== 'auto') return theme;

            const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            return prefersDark ? 'dark' : 'light';
        }

        render() {
            const settings = this.settingsManager.all();
            const compactClass = settings.appearance.compactMode ? 'hm-compact' : '';
            const savedUi = this.settingsManager.storage.get('ui', { x: null, y: null, minimized: false });
            const positionStyle = savedUi.x !== null && savedUi.y !== null
                ? `left: ${savedUi.x}px; top: ${savedUi.y}px; right: auto; bottom: auto;`
                : '';

            this.root.innerHTML = `
                <style>${this.styles()}</style>
                <div class="hm-app hm-theme-${this.getTheme()} ${compactClass} ${savedUi.minimized ? 'hm-minimized' : ''}" style="${positionStyle}">
                    <div class="hm-shell">
                        <aside class="hm-sidebar">
                            <div class="hm-brand hm-drag-handle" title="Можно перетащить окно">
                                <div class="hm-brand-icon">🐴</div>
                                <div>
                                    <div class="hm-brand-title">Howrse Manager</div>
                                    <div class="hm-brand-subtitle">v${APP.version}</div>
                                </div>
                            </div>
                            <nav class="hm-nav">
                                ${this.pages.map((page) => this.renderNavItem(page)).join('')}
                            </nav>
                        </aside>
                        <main class="hm-content">
                            <header class="hm-header hm-drag-handle">
                                <div>
                                    <div class="hm-kicker">Tampermonkey application</div>
                                    <h1>${this.getActivePageTitle()}</h1>
                                </div>
                                <div class="hm-window-actions">
                                    <button class="hm-icon-button" data-action="toggle-theme" title="Сменить тему">${this.getTheme() === 'dark' ? '🌙' : '☀'}</button>
                                    <button class="hm-icon-button" data-action="toggle-minimize" title="Свернуть">${savedUi.minimized ? '□' : '—'}</button>
                                </div>
                            </header>
                            <section class="hm-page">
                                ${this.renderPage()}
                            </section>
                        </main>
                    </div>
                </div>
            `;

            this.bindDynamicEvents();
        }

        renderNavItem(page) {
            return `
                <button class="hm-nav-item ${this.activePage === page.id ? 'hm-active' : ''}" data-page="${page.id}">
                    <span>${page.icon}</span>
                    <span>${page.label}</span>
                </button>
            `;
        }

        getActivePageTitle() {
            const page = this.pages.find((item) => item.id === this.activePage);
            return page ? `${page.icon} ${page.label}` : APP.name;
        }

        renderPage() {
            const renderers = {
                home: () => this.renderHomePage(),
                run: () => this.renderRunPage(),
                activity: () => this.renderActivityPage(),
                ec: () => this.renderEcPage(),
                blacklist: () => this.renderBlacklistPage(),
                stats: () => this.renderStatsPage(),
                developer: () => this.renderDeveloperPage(),
                settings: () => this.renderSettingsPage(),
            };

            return (renderers[this.activePage] || renderers.home)();
        }

        renderHomePage() {
            const state = this.stateManager.get();
            const runtime = state.startedAt ? this.formatDuration(Date.now() - state.startedAt) : '00:00';

            return `
                <div class="hm-grid hm-grid-2">
                    <div class="hm-card">
                        <div class="hm-card-title">Состояние</div>
                        <div class="hm-status-row">
                            <span class="hm-status hm-status-${state.status}">${this.statusLabel(state.status)}</span>
                            <span class="hm-muted">Время: ${runtime}</span>
                        </div>
                        <div class="hm-info-list">
                            <div><span>Текущая лошадь</span><strong>${this.escapeHtml(state.currentHorseName || '—')}</strong></div>
                            <div><span>Операция</span><strong>${this.escapeHtml(state.currentOperation || '—')}</strong></div>
                            <div><span>Прогресс</span><strong>${state.progress.current} / ${state.progress.total}</strong></div>
                        </div>
                        <div class="hm-actions">
                            <button class="hm-button hm-primary" data-action="start">Старт</button>
                            <button class="hm-button" data-action="pause">Пауза</button>
                            <button class="hm-button hm-danger" data-action="stop">Стоп</button>
                        </div>
                    </div>
                    <div class="hm-card hm-card-accent">
                        <div class="hm-card-title">v0.1 готовит фундамент</div>
                        <p>Эта версия пока не кликает по игре. Она проверяет интерфейс, сохранение настроек, лог и базовую архитектуру.</p>
                        <p class="hm-muted">Следующий этап: анализ страницы и текущей лошади.</p>
                    </div>
                </div>
                ${this.renderLogPanel()}
            `;
        }

        renderRunPage() {
            return `
                <div class="hm-card">
                    <div class="hm-card-title">Прогон табуна</div>
                    <p>Будущий гибридный режим: текущая лошадь → обработка → кнопка следующей лошади.</p>
                    <div class="hm-note">В v0.1 это только страница настроек. Игровые действия появятся в следующих версиях.</div>
                    ${this.renderSettingsSection('run')}
                </div>
            `;
        }

        renderActivityPage() {
            return `
                <div class="hm-card">
                    <div class="hm-card-title">Активность</div>
                    <p>Здесь позже появятся тренировки, прогулки, соревнования и умный режим выбора действия.</p>
                    <div class="hm-empty">Пока модуль в режиме заготовки.</div>
                </div>
            `;
        }

        renderEcPage() {
            return `
                <div class="hm-card">
                    <div class="hm-card-title">КСК</div>
                    <p>Здесь позже будет автоматическая запись в конноспортивный центр с умным поиском.</p>
                    <div class="hm-empty">Модуль будет добавлен после базового прогона.</div>
                </div>
            `;
        }

        renderBlacklistPage() {
            return `
                <div class="hm-card">
                    <div class="hm-card-title">Чёрный список</div>
                    <p>Здесь будут правила пропуска: жеребята, беременные, VIP, лошади в продаже и другие исключения.</p>
                    <div class="hm-empty">Правила появятся вместе с анализом лошади.</div>
                </div>
            `;
        }

        renderStatsPage() {
            const logItems = this.logger.all();
            const errors = logItems.filter((item) => item.level === 'error').length;

            return `
                <div class="hm-grid hm-grid-3">
                    <div class="hm-stat"><span>Обработано</span><strong>0</strong></div>
                    <div class="hm-stat"><span>Действий</span><strong>0</strong></div>
                    <div class="hm-stat"><span>Ошибок</span><strong>${errors}</strong></div>
                </div>
                <div class="hm-card">
                    <div class="hm-card-title">Статистика</div>
                    <p>В v0.1 статистика показывает только базовые данные. После подключения действий здесь появятся тренировки, КСК, ошибки и время работы.</p>
                </div>
            `;
        }

        renderDeveloperPage() {
            const pageInfo = this.adapter.getPageInfo();
            const developerEnabled = this.settingsManager.get('developer', 'enabled');

            return `
                <div class="hm-card">
                    <div class="hm-card-title">Режим разработчика</div>
                    ${this.renderSettingsSection('developer')}
                    ${developerEnabled ? `
                        <div class="hm-dev-grid">
                            <div><span>Домен</span><strong>${this.escapeHtml(pageInfo.hostname)}</strong></div>
                            <div><span>URL</span><strong>${this.escapeHtml(pageInfo.url)}</strong></div>
                            <div><span>Тип страницы</span><strong>${this.escapeHtml(pageInfo.pageType)}</strong></div>
                            <div><span>Адаптер</span><strong>${this.escapeHtml(pageInfo.adapter)}</strong></div>
                            <div><span>Поддерживается</span><strong>${pageInfo.supported ? 'Да' : 'Нет'}</strong></div>
                        </div>
                    ` : '<div class="hm-empty">Режим разработчика выключен.</div>'}
                </div>
            `;
        }

        renderSettingsPage() {
            return `
                <div class="hm-card">
                    <div class="hm-card-title">Настройки</div>
                    ${this.renderSettingsSection('appearance')}
                    <div class="hm-actions hm-actions-left">
                        <button class="hm-button hm-danger" data-action="reset-settings">Сбросить настройки</button>
                        <button class="hm-button" data-action="clear-log">Очистить лог</button>
                    </div>
                </div>
            `;
        }

        renderSettingsSection(sectionId) {
            const section = settingsSchema.find((item) => item.id === sectionId);
            if (!section) return '';

            return `
                <div class="hm-settings-section">
                    <div class="hm-section-title">${section.title}</div>
                    <p class="hm-muted">${section.description}</p>
                    ${section.fields.map((field) => this.renderField(section.id, field)).join('')}
                </div>
            `;
        }

        renderField(sectionId, field) {
            const value = this.settingsManager.get(sectionId, field.id);
            const fieldId = `hm-field-${sectionId}-${field.id}`;

            if (field.type === 'checkbox') {
                return `
                    <label class="hm-field hm-field-checkbox" for="${fieldId}">
                        <input id="${fieldId}" type="checkbox" data-setting-section="${sectionId}" data-setting-field="${field.id}" ${value ? 'checked' : ''}>
                        <span>${field.label}</span>
                    </label>
                `;
            }

            if (field.type === 'select') {
                return `
                    <label class="hm-field" for="${fieldId}">
                        <span>${field.label}</span>
                        <select id="${fieldId}" data-setting-section="${sectionId}" data-setting-field="${field.id}">
                            ${field.options.map((option) => `<option value="${option.value}" ${option.value === value ? 'selected' : ''}>${option.label}</option>`).join('')}
                        </select>
                    </label>
                `;
            }

            if (field.type === 'number') {
                return `
                    <label class="hm-field" for="${fieldId}">
                        <span>${field.label}</span>
                        <input id="${fieldId}" type="number" value="${value}" min="${field.min}" max="${field.max}" step="${field.step || 1}" data-setting-section="${sectionId}" data-setting-field="${field.id}">
                    </label>
                `;
            }

            return '';
        }

        renderLogPanel() {
            const items = this.logger.all().slice(0, 12);

            return `
                <div class="hm-card hm-log-card">
                    <div class="hm-card-header">
                        <div class="hm-card-title">Лог</div>
                        <button class="hm-small-button" data-action="clear-log">Очистить</button>
                    </div>
                    <div class="hm-log-list">
                        ${items.length ? items.map((item) => `
                            <div class="hm-log-item hm-log-${item.level}">
                                <span>${item.time}</span>
                                <strong>${this.escapeHtml(item.message)}</strong>
                            </div>
                        `).join('') : '<div class="hm-empty">Лог пока пуст.</div>'}
                    </div>
                </div>
            `;
        }

        bindEvents() {
            window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
                if (this.settingsManager.get('appearance', 'theme') === 'auto') {
                    this.render();
                }
            });
        }

        bindDynamicEvents() {
            this.root.querySelectorAll('[data-page]').forEach((button) => {
                button.addEventListener('click', () => {
                    this.activePage = button.dataset.page;
                    this.render();
                });
            });

            this.root.querySelectorAll('[data-action]').forEach((button) => {
                button.addEventListener('click', () => this.handleAction(button.dataset.action));
            });

            this.root.querySelectorAll('[data-setting-section]').forEach((input) => {
                input.addEventListener('change', () => {
                    const sectionId = input.dataset.settingSection;
                    const fieldId = input.dataset.settingField;
                    const value = input.type === 'checkbox'
                        ? input.checked
                        : input.type === 'number'
                            ? Number(input.value)
                            : input.value;

                    this.settingsManager.set(sectionId, fieldId, value);
                    this.logger.info(`Настройка сохранена: ${fieldId}`);
                });
            });

            this.bindDragEvents();
        }

        bindDragEvents() {
            const app = this.root.querySelector('.hm-app');
            const handles = this.root.querySelectorAll('.hm-drag-handle');
            if (!app || !handles.length) return;

            handles.forEach((handle) => {
                handle.addEventListener('mousedown', (event) => {
                    if (event.target.closest('button')) return;
                    const rect = app.getBoundingClientRect();
                    this.drag = {
                        offsetX: event.clientX - rect.left,
                        offsetY: event.clientY - rect.top,
                    };
                    event.preventDefault();
                });
            });

            const onMouseMove = (event) => {
                if (!this.drag) return;
                const x = Math.max(12, Math.min(window.innerWidth - 120, event.clientX - this.drag.offsetX));
                const y = Math.max(12, Math.min(window.innerHeight - 60, event.clientY - this.drag.offsetY));
                app.style.left = `${x}px`;
                app.style.top = `${y}px`;
                app.style.right = 'auto';
                app.style.bottom = 'auto';
            };

            const onMouseUp = () => {
                if (!this.drag) return;
                const rect = app.getBoundingClientRect();
                const ui = this.settingsManager.storage.get('ui', {});
                this.settingsManager.storage.set('ui', { ...ui, x: Math.round(rect.left), y: Math.round(rect.top) });
                this.drag = null;
            };

            document.removeEventListener('mousemove', this._onMouseMove);
            document.removeEventListener('mouseup', this._onMouseUp);
            this._onMouseMove = onMouseMove;
            this._onMouseUp = onMouseUp;
            document.addEventListener('mousemove', this._onMouseMove);
            document.addEventListener('mouseup', this._onMouseUp);
        }

        handleAction(action) {
            const ui = this.settingsManager.storage.get('ui', { minimized: false });

            if (action === 'start') {
                this.stateManager.start();
                this.logger.success('Скрипт запущен');
                return;
            }

            if (action === 'pause') {
                this.stateManager.pause();
                this.logger.warn('Пауза');
                return;
            }

            if (action === 'stop') {
                this.stateManager.stop();
                this.logger.warn('Скрипт остановлен');
                return;
            }

            if (action === 'clear-log') {
                this.logger.clear();
                this.logger.info('Лог очищен');
                return;
            }

            if (action === 'reset-settings') {
                this.settingsManager.reset();
                this.logger.warn('Настройки сброшены');
                return;
            }

            if (action === 'toggle-theme') {
                const current = this.settingsManager.get('appearance', 'theme');
                const next = current === 'dark' ? 'light' : 'dark';
                this.settingsManager.set('appearance', 'theme', next);
                this.logger.info(`Тема изменена: ${next === 'dark' ? 'тёмная' : 'светлая'}`);
                return;
            }

            if (action === 'toggle-minimize') {
                this.settingsManager.storage.set('ui', { ...ui, minimized: !ui.minimized });
                this.render();
            }
        }

        statusLabel(status) {
            const labels = {
                [AppStatus.IDLE]: 'Ожидание',
                [AppStatus.RUNNING]: 'Работает',
                [AppStatus.PAUSED]: 'Пауза',
                [AppStatus.STOPPED]: 'Остановлено',
                [AppStatus.ERROR]: 'Ошибка',
            };

            return labels[status] || status;
        }

        formatDuration(ms) {
            const totalSeconds = Math.floor(ms / 1000);
            const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
            const seconds = (totalSeconds % 60).toString().padStart(2, '0');
            return `${minutes}:${seconds}`;
        }

        escapeHtml(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        styles() {
            return `
                :host {
                    all: initial;
                    color-scheme: light dark;
                    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                }

                * {
                    box-sizing: border-box;
                }

                .hm-app {
                    --hm-bg: rgba(248, 250, 252, 0.98);
                    --hm-panel: #ffffff;
                    --hm-panel-soft: #f8fafc;
                    --hm-text: #172033;
                    --hm-muted: #64748b;
                    --hm-border: rgba(148, 163, 184, 0.25);
                    --hm-primary: #7c3aed;
                    --hm-primary-soft: rgba(124, 58, 237, 0.12);
                    --hm-danger: #e11d48;
                    --hm-success: #059669;
                    --hm-warn: #d97706;
                    --hm-shadow: 0 24px 80px rgba(15, 23, 42, 0.22);
                    position: fixed;
                    right: 24px;
                    bottom: 24px;
                    width: 880px;
                    max-width: calc(100vw - 32px);
                    height: 620px;
                    max-height: calc(100vh - 32px);
                    z-index: 2147483647;
                    color: var(--hm-text);
                    font-size: 14px;
                    line-height: 1.45;
                }

                .hm-theme-dark {
                    --hm-bg: rgba(15, 23, 42, 0.98);
                    --hm-panel: #111827;
                    --hm-panel-soft: #0f172a;
                    --hm-text: #e5e7eb;
                    --hm-muted: #94a3b8;
                    --hm-border: rgba(148, 163, 184, 0.22);
                    --hm-primary: #a78bfa;
                    --hm-primary-soft: rgba(167, 139, 250, 0.16);
                    --hm-danger: #fb7185;
                    --hm-success: #34d399;
                    --hm-warn: #fbbf24;
                    --hm-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
                }

                .hm-shell {
                    display: grid;
                    grid-template-columns: 220px 1fr;
                    width: 100%;
                    height: 100%;
                    overflow: hidden;
                    background: var(--hm-bg);
                    border: 1px solid var(--hm-border);
                    border-radius: 24px;
                    box-shadow: var(--hm-shadow);
                    backdrop-filter: blur(18px);
                }

                .hm-minimized {
                    width: 310px;
                    height: 76px;
                }

                .hm-minimized .hm-sidebar,
                .hm-minimized .hm-page,
                .hm-minimized .hm-kicker {
                    display: none;
                }

                .hm-minimized .hm-shell {
                    display: block;
                    border-radius: 20px;
                }

                .hm-minimized .hm-content,
                .hm-minimized .hm-header {
                    height: 100%;
                }

                .hm-sidebar {
                    padding: 18px;
                    border-right: 1px solid var(--hm-border);
                    background: linear-gradient(180deg, var(--hm-primary-soft), transparent 55%);
                }

                .hm-brand {
                    display: flex;
                    gap: 12px;
                    align-items: center;
                    margin-bottom: 20px;
                    cursor: move;
                    user-select: none;
                }

                .hm-brand-icon {
                    display: grid;
                    place-items: center;
                    width: 42px;
                    height: 42px;
                    border-radius: 14px;
                    background: var(--hm-primary-soft);
                    font-size: 22px;
                }

                .hm-brand-title {
                    font-weight: 800;
                    letter-spacing: -0.03em;
                }

                .hm-brand-subtitle,
                .hm-kicker,
                .hm-muted {
                    color: var(--hm-muted);
                    font-size: 12px;
                }

                .hm-nav {
                    display: grid;
                    gap: 6px;
                }

                .hm-nav-item,
                .hm-button,
                .hm-icon-button,
                .hm-small-button {
                    border: 0;
                    font: inherit;
                    color: inherit;
                    cursor: pointer;
                }

                .hm-nav-item {
                    display: flex;
                    gap: 10px;
                    align-items: center;
                    width: 100%;
                    padding: 10px 12px;
                    border-radius: 14px;
                    background: transparent;
                    color: var(--hm-muted);
                    text-align: left;
                    transition: 0.18s ease;
                }

                .hm-nav-item:hover,
                .hm-nav-item.hm-active {
                    color: var(--hm-text);
                    background: var(--hm-primary-soft);
                }

                .hm-content {
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                }

                .hm-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 16px;
                    padding: 18px 22px;
                    border-bottom: 1px solid var(--hm-border);
                    cursor: move;
                    user-select: none;
                }

                .hm-header h1 {
                    margin: 2px 0 0;
                    font-size: 22px;
                    line-height: 1.1;
                    letter-spacing: -0.04em;
                }

                .hm-window-actions,
                .hm-actions {
                    display: flex;
                    gap: 8px;
                    align-items: center;
                }

                .hm-page {
                    flex: 1;
                    overflow: auto;
                    padding: 20px 22px;
                }

                .hm-grid {
                    display: grid;
                    gap: 14px;
                    margin-bottom: 14px;
                }

                .hm-grid-2 {
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                }

                .hm-grid-3 {
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                }

                .hm-card,
                .hm-stat {
                    padding: 16px;
                    border: 1px solid var(--hm-border);
                    border-radius: 20px;
                    background: var(--hm-panel);
                }

                .hm-card-accent {
                    background: linear-gradient(135deg, var(--hm-primary-soft), var(--hm-panel));
                }

                .hm-card-title,
                .hm-section-title {
                    margin-bottom: 10px;
                    font-weight: 800;
                    letter-spacing: -0.02em;
                }

                .hm-card-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 8px;
                }

                .hm-status-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 12px;
                    margin-bottom: 14px;
                }

                .hm-status {
                    display: inline-flex;
                    align-items: center;
                    padding: 6px 10px;
                    border-radius: 999px;
                    background: var(--hm-primary-soft);
                    font-weight: 700;
                }

                .hm-status-running,
                .hm-log-success {
                    color: var(--hm-success);
                }

                .hm-status-paused,
                .hm-log-warn {
                    color: var(--hm-warn);
                }

                .hm-status-error,
                .hm-log-error {
                    color: var(--hm-danger);
                }

                .hm-info-list,
                .hm-dev-grid {
                    display: grid;
                    gap: 8px;
                    margin: 12px 0 16px;
                }

                .hm-info-list div,
                .hm-dev-grid div {
                    display: flex;
                    justify-content: space-between;
                    gap: 12px;
                    padding: 9px 0;
                    border-bottom: 1px solid var(--hm-border);
                }

                .hm-dev-grid div {
                    display: grid;
                    grid-template-columns: 150px 1fr;
                }

                .hm-dev-grid strong {
                    overflow-wrap: anywhere;
                }

                .hm-info-list span,
                .hm-dev-grid span,
                .hm-stat span {
                    color: var(--hm-muted);
                }

                .hm-actions {
                    justify-content: flex-end;
                    margin-top: 12px;
                }

                .hm-actions-left {
                    justify-content: flex-start;
                }

                .hm-button,
                .hm-icon-button,
                .hm-small-button {
                    border-radius: 12px;
                    background: var(--hm-panel-soft);
                    transition: 0.18s ease;
                }

                .hm-button {
                    padding: 9px 13px;
                    font-weight: 700;
                }

                .hm-small-button {
                    padding: 6px 10px;
                    color: var(--hm-muted);
                    font-size: 12px;
                }

                .hm-icon-button {
                    display: grid;
                    place-items: center;
                    width: 36px;
                    height: 36px;
                }

                .hm-button:hover,
                .hm-icon-button:hover,
                .hm-small-button:hover {
                    transform: translateY(-1px);
                    filter: brightness(1.04);
                }

                .hm-primary {
                    background: var(--hm-primary);
                    color: white;
                }

                .hm-danger {
                    background: rgba(225, 29, 72, 0.12);
                    color: var(--hm-danger);
                }

                .hm-note,
                .hm-empty {
                    margin-top: 12px;
                    padding: 12px;
                    border-radius: 14px;
                    background: var(--hm-panel-soft);
                    color: var(--hm-muted);
                }

                .hm-settings-section {
                    margin-top: 14px;
                    padding-top: 14px;
                    border-top: 1px solid var(--hm-border);
                }

                .hm-field {
                    display: grid;
                    grid-template-columns: 1fr minmax(150px, 210px);
                    align-items: center;
                    gap: 12px;
                    margin: 10px 0;
                }

                .hm-field-checkbox {
                    display: flex;
                    justify-content: flex-start;
                }

                .hm-field input,
                .hm-field select {
                    width: 100%;
                    padding: 8px 10px;
                    border: 1px solid var(--hm-border);
                    border-radius: 12px;
                    background: var(--hm-panel-soft);
                    color: var(--hm-text);
                    font: inherit;
                }

                .hm-field-checkbox input {
                    width: auto;
                    accent-color: var(--hm-primary);
                }

                .hm-log-list {
                    display: grid;
                    gap: 7px;
                    max-height: 190px;
                    overflow: auto;
                }

                .hm-log-item {
                    display: grid;
                    grid-template-columns: 72px 1fr;
                    gap: 10px;
                    padding: 8px 10px;
                    border-radius: 12px;
                    background: var(--hm-panel-soft);
                }

                .hm-log-item span {
                    color: var(--hm-muted);
                    font-size: 12px;
                }

                .hm-stat {
                    display: grid;
                    gap: 4px;
                }

                .hm-stat strong {
                    font-size: 28px;
                    letter-spacing: -0.05em;
                }

                .hm-compact .hm-sidebar {
                    padding: 14px;
                }

                .hm-compact .hm-page {
                    padding: 14px;
                }

                @media (max-width: 760px) {
                    .hm-app {
                        left: 12px !important;
                        right: 12px !important;
                        bottom: 12px;
                        width: auto;
                        height: min(680px, calc(100vh - 24px));
                    }

                    .hm-shell {
                        grid-template-columns: 1fr;
                    }

                    .hm-sidebar {
                        border-right: 0;
                        border-bottom: 1px solid var(--hm-border);
                    }

                    .hm-nav {
                        grid-template-columns: repeat(2, minmax(0, 1fr));
                    }

                    .hm-grid-2,
                    .hm-grid-3 {
                        grid-template-columns: 1fr;
                    }
                }
            `;
        }
    }

    class Application {
        constructor() {
            this.eventBus = new EventBus();
            this.storage = new Storage(APP.storagePrefix);
            this.settingsManager = new SettingsManager(this.eventBus, this.storage, settingsSchema);
            this.logger = new Logger(this.eventBus, this.storage);
            this.stateManager = new StateManager(this.eventBus, this.storage);
            this.delayManager = new DelayManager(this.settingsManager);
            this.routeManager = new RouteManager();
            this.adapter = AdapterFactory.create(this.routeManager);
            this.ui = new UIManager({
                eventBus: this.eventBus,
                logger: this.logger,
                settingsManager: this.settingsManager,
                stateManager: this.stateManager,
                adapter: this.adapter,
            });
        }

        start() {
            const pageInfo = this.adapter.getPageInfo();
            this.stateManager.patch({ pageType: pageInfo.pageType });
            this.ui.mount();
            this.logger.info('Howrse Manager загружен');
            this.logger.info(`Адаптер: ${pageInfo.adapter}`);
        }
    }

    function bootstrap() {
        const app = new Application();
        app.start();
        window.HowrseManager = app;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
    } else {
        bootstrap();
    }
}());
