// ==UserScript==
// @name         Howrse Manager
// @namespace    https://github.com/less-exe/HowrseManager
// @version      0.3.1
// @description  Умный менеджер табуна для Ловади / Howrse. v0.3.1: улучшения табунного режима и интерфейса.
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
        version: '0.3.1',
        storagePrefix: 'hm:v0.1',
    };

    const PageType = Object.freeze({
        HORSE: 'horse',
        HORSE_LIST: 'horse_list',
        EC: 'ec',
        COMPETITIONS: 'competitions',
        UNKNOWN: 'unknown',
    });

    const AppStatus = Object.freeze({
        IDLE: 'idle',
        RUNNING: 'running',
        PAUSED: 'paused',
        STOPPED: 'stopped',
        ERROR: 'error',
    });

    const PageLabels = {
        [PageType.HORSE]: 'Страница лошади',
        [PageType.HORSE_LIST]: 'Список лошадей',
        [PageType.EC]: 'КСК',
        [PageType.COMPETITIONS]: 'Соревнования',
        [PageType.UNKNOWN]: 'Неизвестная страница',
    };

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
            description: 'Гибридный режим: текущая лошадь → анализ → следующая лошадь.',
            fields: [
                {
                    id: 'limitMode',
                    type: 'select',
                    label: 'Максимум лошадей за запуск',
                    default: 'manual',
                    options: [
                        { value: 'manual', label: 'Ручной лимит' },
                        { value: 'auto', label: 'Авто — до конца завода' },
                    ],
                },
                {
                    id: 'maxHorsesPerRun',
                    type: 'number',
                    label: 'Лимит при ручном режиме',
                    default: 25,
                    min: 1,
                    max: 5000,
                    step: 1,
                },
                {
                    id: 'stopAfterCurrentHorse',
                    type: 'checkbox',
                    label: 'Мягкая остановка после текущей лошади',
                    default: false,
                },
                {
                    id: 'energyLimit',
                    type: 'number',
                    label: 'Будущий остаток энергии для активности, %',
                    default: 20,
                    min: 0,
                    max: 100,
                    step: 1,
                },
            ],
        },
        {
            id: 'delays',
            title: 'Задержки',
            description: 'Пауза перед переходом к следующей лошади.',
            fields: [
                {
                    id: 'mode',
                    type: 'select',
                    label: 'Режим задержек',
                    default: 'medium',
                    options: [
                        { value: 'fast', label: 'Быстро' },
                        { value: 'medium', label: 'Средне' },
                        { value: 'slow', label: 'Медленно' },
                    ],
                },
            ],
        },
        {
            id: 'developer',
            title: 'Разработчик',
            description: 'Помогает тестировать поиск страниц, данных и кнопок.',
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
            if (!this.listeners.has(eventName)) this.listeners.set(eventName, new Set());
            this.listeners.get(eventName).add(callback);
            return () => this.off(eventName, callback);
        }

        off(eventName, callback) {
            this.listeners.get(eventName)?.delete(callback);
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
    }

    class Logger {
        constructor(eventBus, storage) {
            this.eventBus = eventBus;
            this.storage = storage;
            this.maxItems = 300;
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

        info(message, details = null) { this.add('info', message, details); }
        success(message, details = null) { this.add('success', message, details); }
        warn(message, details = null) { this.add('warn', message, details); }
        error(message, details = null) { this.add('error', message, details); }

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
            const defaults = { version: 4 };
            schema.forEach((section) => {
                defaults[section.id] = {};
                section.fields.forEach((field) => {
                    defaults[section.id][field.id] = field.default;
                });
            });
            return defaults;
        }

        load() {
            return this.mergeDeep(this.defaults, this.storage.get('settings', {}));
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
            if (!this.settings[sectionId]) this.settings[sectionId] = {};
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
            this.state = this.mergeState(this.createInitialState(), this.storage.get('state', {}));
        }

        createInitialState() {
            return {
                status: AppStatus.IDLE,
                mode: null,
                currentHorseId: null,
                currentHorseName: '—',
                currentOperation: 'Ожидание',
                progress: { current: 0, total: 0 },
                startedAt: null,
                finishedAt: null,
                lastActionAt: null,
                pageType: PageType.UNKNOWN,
                currentHorse: null,
                run: {
                    processedIds: [],
                    softStopRequested: false,
                    lastError: null,
                    limitMode: 'manual',
                },
            };
        }

        mergeState(base, saved) {
            return {
                ...base,
                ...saved,
                progress: { ...base.progress, ...(saved.progress || {}) },
                run: { ...base.run, ...(saved.run || {}) },
            };
        }

        get() {
            return JSON.parse(JSON.stringify(this.state));
        }

        patch(partial) {
            this.state = this.mergeState(this.state, partial);
            this.storage.set('state', this.state);
            this.eventBus.emit('state:changed', this.get());
        }

        start(total = 0, limitMode = 'manual') {
            this.patch({
                status: AppStatus.RUNNING,
                mode: 'hybrid-herd',
                currentOperation: 'Запуск табунного режима',
                progress: { current: 0, total },
                startedAt: Date.now(),
                finishedAt: null,
                lastActionAt: Date.now(),
                run: {
                    processedIds: [],
                    softStopRequested: false,
                    lastError: null,
                    limitMode,
                },
            });
        }

        pause() {
            this.patch({ status: AppStatus.PAUSED, currentOperation: 'Пауза', lastActionAt: Date.now() });
        }

        resume() {
            this.patch({ status: AppStatus.RUNNING, currentOperation: 'Продолжение работы', lastActionAt: Date.now(), finishedAt: null });
        }

        stop(operation = 'Остановлено') {
            this.patch({ status: AppStatus.STOPPED, mode: null, currentOperation: operation, finishedAt: Date.now(), lastActionAt: Date.now() });
        }

        error(message) {
            this.patch({
                status: AppStatus.ERROR,
                currentOperation: 'Ошибка',
                finishedAt: Date.now(),
                lastActionAt: Date.now(),
                run: { ...this.state.run, lastError: message },
            });
        }

        requestSoftStop() {
            this.patch({
                run: { ...this.state.run, softStopRequested: true },
                currentOperation: 'Мягкая остановка после текущей лошади',
            });
        }

        markHorseProcessed(horse) {
            const id = horse?.id || `unknown-${Date.now()}`;
            const processedIds = [...new Set([...(this.state.run.processedIds || []), id])];
            this.patch({
                currentHorseId: id,
                currentHorseName: horse?.name || '—',
                currentHorse: horse,
                progress: { current: processedIds.length },
                run: { ...this.state.run, processedIds },
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

        getRange() {
            const mode = this.settingsManager.get('delays', 'mode');
            const ranges = {
                fast: [900, 1800],
                medium: [1800, 3600],
                slow: [3600, 7000],
            };
            return ranges[mode] || ranges.medium;
        }

        random(min = null, max = null) {
            const range = this.getRange();
            const from = min ?? range[0];
            const to = max ?? range[1];
            const duration = Math.floor(Math.random() * (to - from + 1)) + from;
            return this.wait(duration);
        }
    }

    class RouteManager {
        getCurrentPageType() {
            const path = window.location.pathname;
            const href = window.location.href;
            if (/\/elevage\/chevaux\/cheval/i.test(path) || /[?&]id=\d+/i.test(href)) return PageType.HORSE;
            if (/centre|centre-equestre|centreEquestre|ecuri/i.test(path)) return PageType.EC;
            if (/competition|competitions|course/i.test(path)) return PageType.COMPETITIONS;
            if (/\/elevage\/chevaux\/?$/i.test(path) || /\/elevage\/chevaux/i.test(path)) return PageType.HORSE_LIST;
            return PageType.UNKNOWN;
        }
    }

    class SelectorManager {
        constructor(selectors) {
            this.selectors = selectors;
            this.lastMatches = {};
        }

        find(key, root = document) {
            const variants = this.selectors[key] || [];
            for (const selector of variants) {
                const element = root.querySelector(selector);
                if (element) {
                    this.lastMatches[key] = selector;
                    return element;
                }
            }
            this.lastMatches[key] = null;
            return null;
        }

        getLastMatches() {
            return { ...this.lastMatches };
        }
    }

    class HorseParser {
        constructor(selectorManager) {
            this.selectorManager = selectorManager;
        }

        parse() {
            const text = this.normalize(document.body?.innerText || '');
            const id = this.getHorseId();
            const name = this.getHorseName(text);
            const energy = this.getPercentNearLabel(text, 'Энергия');
            const health = this.getPercentNearLabel(text, 'Здоровье');
            const mood = this.getPercentNearLabel(text, 'Настроение') ?? this.getPercentNearLabel(text, 'Мораль');
            const age = this.getAge(text);
            const sex = this.getSex(text, name);
            const nextButton = this.findNextHorseButton();

            return {
                id,
                name,
                energy,
                health,
                mood,
                age,
                sex,
                hasNextHorseButton: Boolean(nextButton),
                nextHorseButtonSelector: this.describeElement(nextButton),
                pageTextSample: text.slice(0, 700),
                selectors: this.selectorManager.getLastMatches(),
            };
        }

        normalize(value) {
            return String(value || '').replace(/\s+/g, ' ').trim();
        }

        getHorseId() {
            const params = new URLSearchParams(window.location.search);
            return params.get('id') || null;
        }

        getHorseName(text) {
            const title = document.title
                .replace(/\s*-\s*Ловади\s*$/i, '')
                .replace(/\s*-\s*Howrse\s*$/i, '')
                .trim();
            if (title && !/^(lowadi|howrse|ловади)$/i.test(title)) return title;

            const nameSelectors = ['#characteristics-body-content h1', '.horse-name', '[class*="horse"] h1', 'h1', 'h2'];
            for (const selector of nameSelectors) {
                const element = document.querySelector(selector);
                const candidate = this.normalize(element?.textContent || '');
                if (candidate && candidate.length <= 80) return candidate;
            }

            const byTabun = text.match(/(?:Табун\s+[^\s]+\s+)?((?:жен|муж)\s+[0-9.,]+)/i);
            if (byTabun) return byTabun[1];
            return '—';
        }

        getPercentNearLabel(text, label) {
            const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const direct = text.match(new RegExp(`${escaped}\\s*(\\d{1,3})\\s*%`, 'i'));
            if (direct) return Math.min(100, Number(direct[1]));
            const reversed = text.match(new RegExp(`(\\d{1,3})\\s*%\\s*${escaped}`, 'i'));
            if (reversed) return Math.min(100, Number(reversed[1]));
            return null;
        }

        getAge(text) {
            const candidates = [
                text.match(/Возраст\s*:?\s*([^|]{1,35}?)(?= Пол| Энергия| Здоровье| Настроение|$)/i),
                text.match(/(\d+\s*(?:год|года|лет)\s*(?:и\s*)?\d*\s*(?:месяц|месяца|месяцев)?)/i),
                text.match(/(\d+\s*(?:месяц|месяца|месяцев))/i),
            ];
            for (const match of candidates) {
                const value = this.normalize(match?.[1] || '');
                if (value && !/смотреть страницу профиля|обучив/i.test(value)) return value;
            }
            return null;
        }

        getSex(text, name) {
            const source = `${name} ${text}`.toLowerCase();
            if (/\bжен\b|кобыла|кобылиц/.test(source)) return 'Женский';
            if (/\bмуж\b|жеребец|мерин/.test(source)) return 'Мужской';
            return null;
        }

        findNextHorseButton() {
            const candidates = [
                ...document.querySelectorAll('a[href*="go=next"], button[onclick*="go=next"], input[onclick*="go=next"]'),
                ...document.querySelectorAll('a[href*="sens=suivant"], a[href*="next"], button[title*="след" i], a[title*="след" i]'),
                ...document.querySelectorAll('button, a'),
            ];
            const byHref = candidates.find((element) => /go=next|sens=suivant/i.test(element.getAttribute('href') || element.getAttribute('onclick') || ''));
            if (byHref) return byHref;
            const byText = candidates.find((element) => /следующ|suivant|next/i.test(this.normalize(element.textContent || element.title || element.getAttribute('aria-label') || '')));
            if (byText) return byText;

            const rightArrowLinks = [...document.querySelectorAll('a')].filter((element) => {
                const rect = element.getBoundingClientRect();
                const text = this.normalize(element.textContent || element.title || '');
                const href = element.getAttribute('href') || '';
                const looksLikeArrow = text === '›' || text === '>' || text === '→' || /arrow|next|suivant/i.test(element.className || '');
                return looksLikeArrow || /go=next/i.test(href) || (rect.width >= 20 && rect.height >= 20 && rect.left > window.innerWidth * 0.45 && rect.top > window.innerHeight * 0.45);
            });
            return rightArrowLinks[rightArrowLinks.length - 1] || null;
        }

        describeElement(element) {
            if (!element) return null;
            if (element.id) return `#${element.id}`;
            const href = element.getAttribute('href');
            if (href) return `a[href="${href.slice(0, 90)}${href.length > 90 ? '…' : ''}"]`;
            const title = element.getAttribute('title') || element.getAttribute('aria-label');
            if (title) return `${element.tagName.toLowerCase()}[title="${title}"]`;
            return element.tagName.toLowerCase();
        }
    }

    class GameAdapter {
        constructor(routeManager) {
            this.routeManager = routeManager;
            this.selectorManager = new SelectorManager({});
            this.horseParser = new HorseParser(this.selectorManager);
        }

        getName() { return 'BaseAdapter'; }
        isSupported() { return false; }

        getPageInfo() {
            const pageType = this.routeManager.getCurrentPageType();
            return {
                hostname: window.location.hostname,
                url: window.location.href,
                pageType,
                pageTypeLabel: PageLabels[pageType] || PageLabels[PageType.UNKNOWN],
                adapter: this.getName(),
                supported: this.isSupported(),
            };
        }

        analyzeHorse() { return this.horseParser.parse(); }
        findNextHorseButton() { return this.horseParser.findNextHorseButton(); }
    }

    class LowadiAdapter extends GameAdapter {
        getName() { return 'LowadiAdapter'; }
        isSupported() { return window.location.hostname === 'www.lowadi.com'; }
    }

    class AdapterFactory {
        static create(routeManager) {
            if (window.location.hostname === 'www.lowadi.com') return new LowadiAdapter(routeManager);
            return new GameAdapter(routeManager);
        }
    }

    class HerdRunner {
        constructor({ adapter, stateManager, settingsManager, logger, delayManager }) {
            this.adapter = adapter;
            this.stateManager = stateManager;
            this.settingsManager = settingsManager;
            this.logger = logger;
            this.delayManager = delayManager;
            this.timer = null;
            this.isExecuting = false;
        }

        isAutoLimit() {
            return this.settingsManager.get('run', 'limitMode') === 'auto';
        }

        async start() {
            const pageInfo = this.adapter.getPageInfo();
            const autoLimit = this.isAutoLimit();
            const max = Number(this.settingsManager.get('run', 'maxHorsesPerRun') || 25);

            if (pageInfo.pageType !== PageType.HORSE) {
                this.logger.warn('Откройте страницу лошади для запуска табунного режима');
                this.stateManager.patch({ pageType: pageInfo.pageType, currentOperation: 'Нужна страница лошади' });
                return;
            }

            this.stateManager.start(autoLimit ? 0 : max, autoLimit ? 'auto' : 'manual');
            this.logger.success(autoLimit ? 'Табунный режим запущен: Авто до конца завода' : `Табунный режим запущен: лимит ${max}`);
            await this.processCurrentHorseAndGoNext();
        }

        pause() {
            this.clearTimer();
            this.stateManager.pause();
            this.logger.warn('Пауза. Продолжение сохранено.');
        }

        async resume() {
            const state = this.stateManager.get();
            if (state.status !== AppStatus.PAUSED) return;
            this.stateManager.resume();
            this.logger.success('Продолжаю с текущей страницы');
            await this.processCurrentHorseAndGoNext();
        }

        stop() {
            this.clearTimer();
            this.stateManager.stop('Остановлено');
            this.logger.warn('Табунный режим остановлен');
        }

        softStop() {
            this.stateManager.requestSoftStop();
            this.logger.warn('Включена мягкая остановка после текущей лошади');
        }

        scheduleAutoResume() {
            const state = this.stateManager.get();
            if (state.status !== AppStatus.RUNNING || state.mode !== 'hybrid-herd') return;
            this.clearTimer();
            this.timer = window.setTimeout(() => this.processCurrentHorseAndGoNext(), 1200);
        }

        clearTimer() {
            if (this.timer) {
                window.clearTimeout(this.timer);
                this.timer = null;
            }
        }

        async processCurrentHorseAndGoNext() {
            if (this.isExecuting) return;
            this.isExecuting = true;

            try {
                const state = this.stateManager.get();
                const pageInfo = this.adapter.getPageInfo();
                if (state.status !== AppStatus.RUNNING) return;

                if (pageInfo.pageType !== PageType.HORSE) {
                    this.logger.warn('Текущая страница не является страницей лошади. Останавливаюсь.');
                    this.stateManager.error('Не страница лошади');
                    return;
                }

                const horse = this.adapter.analyzeHorse();
                const id = horse.id || window.location.href;
                const processedIds = state.run.processedIds || [];

                if (processedIds.includes(id)) {
                    if (state.run.limitMode === 'auto') {
                        this.logger.success('Авто-режим завершён: похоже, все лошади в заводе пройдены');
                        this.stateManager.stop('Завод пройден');
                    } else {
                        this.logger.warn('Похоже, табун пошёл по кругу. Работа остановлена.');
                        this.stateManager.stop('Остановлено: круг табуна');
                    }
                    return;
                }

                this.stateManager.patch({ currentOperation: 'Анализ текущей лошади', pageType: pageInfo.pageType });
                this.stateManager.markHorseProcessed(horse);
                this.logger.success(`Лошадь отмечена: ${horse.name || id}`);

                const freshState = this.stateManager.get();
                const manualLimit = freshState.run.limitMode !== 'auto';
                const max = freshState.progress.total || Number(this.settingsManager.get('run', 'maxHorsesPerRun') || 25);
                const stopAfterCurrent = this.settingsManager.get('run', 'stopAfterCurrentHorse') || freshState.run.softStopRequested;

                if (manualLimit && freshState.progress.current >= max) {
                    this.logger.success(`Достигнут лимит запуска: ${max}`);
                    this.stateManager.stop('Достигнут лимит');
                    return;
                }

                if (stopAfterCurrent) {
                    this.logger.success('Мягкая остановка выполнена после текущей лошади');
                    this.stateManager.stop('Мягкая остановка');
                    return;
                }

                const nextButton = this.adapter.findNextHorseButton();
                if (!nextButton) {
                    this.logger.error('Кнопка следующей лошади не найдена');
                    this.stateManager.error('Нет кнопки следующей лошади');
                    return;
                }

                this.stateManager.patch({ currentOperation: 'Переход к следующей лошади' });
                await this.delayManager.random();
                await this.safeClick(nextButton, 'следующая лошадь');
            } catch (error) {
                console.error(error);
                this.logger.error(`Ошибка табунного режима: ${error.message}`);
                this.stateManager.error(error.message);
            } finally {
                this.isExecuting = false;
            }
        }

        async safeClick(element, label) {
            if (!element) throw new Error(`Не найден элемент: ${label}`);
            element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            await this.delayManager.random(250, 650);
            this.logger.info(`Нажимаю: ${label}`);
            element.click();
        }
    }

    class UIManager {
        constructor({ eventBus, logger, settingsManager, stateManager, adapter, runner }) {
            this.eventBus = eventBus;
            this.logger = logger;
            this.settingsManager = settingsManager;
            this.stateManager = stateManager;
            this.adapter = adapter;
            this.runner = runner;
            this.host = null;
            this.root = null;
            this.drag = null;
            this.runtimeTimer = null;
            this.latestAnalysis = this.storageGetAnalysis();
            this.activePage = this.settingsManager.storage.get('ui', {})?.activePage || 'home';
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
            this.startRuntimeTimer();
            this.eventBus.on('state:changed', () => this.render());
            this.eventBus.on('settings:changed', () => this.render());
            this.eventBus.on('log:changed', () => this.render());
        }

        storageGetAnalysis() {
            return this.settingsManager.storage.get('latestAnalysis', null);
        }

        storageSetAnalysis(analysis) {
            this.latestAnalysis = analysis;
            this.settingsManager.storage.set('latestAnalysis', analysis);
        }

        getTheme() {
            const theme = this.settingsManager.get('appearance', 'theme');
            if (theme !== 'auto') return theme;
            return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }

        getRuntimeText() {
            const state = this.stateManager.get();
            if (!state.startedAt) return '00:00';
            const end = state.status === AppStatus.RUNNING || state.status === AppStatus.PAUSED
                ? Date.now()
                : state.finishedAt || state.lastActionAt || Date.now();
            return this.formatDuration(Math.max(0, end - state.startedAt));
        }

        startRuntimeTimer() {
            if (this.runtimeTimer) window.clearInterval(this.runtimeTimer);
            this.runtimeTimer = window.setInterval(() => this.updateRuntimeNodes(), 1000);
            this.updateRuntimeNodes();
        }

        updateRuntimeNodes() {
            if (!this.root) return;
            const text = this.getRuntimeText();
            this.root.querySelectorAll('[data-runtime]').forEach((node) => {
                node.textContent = text;
            });
        }

        getPositionStyle(savedUi) {
            if (savedUi.x === null || savedUi.x === undefined || savedUi.y === null || savedUi.y === undefined) return '';
            const x = Math.max(12, Math.min(window.innerWidth - 180, Number(savedUi.x)));
            const y = Math.max(12, Math.min(window.innerHeight - 120, Number(savedUi.y)));
            return `left: ${x}px; top: ${y}px; right: auto; bottom: auto; height: min(720px, calc(100vh - ${y + 16}px)); max-height: calc(100vh - ${y + 16}px);`;
        }

        render() {
            const settings = this.settingsManager.all();
            const compactClass = settings.appearance.compactMode ? 'hm-compact' : '';
            const savedUi = this.settingsManager.storage.get('ui', { x: null, y: null, minimized: false, activePage: 'home' });
            const positionStyle = this.getPositionStyle(savedUi);

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
                            <nav class="hm-nav">${this.pages.map((page) => this.renderNavItem(page)).join('')}</nav>
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
                            <section class="hm-page">${this.renderPage()}</section>
                        </main>
                    </div>
                </div>
            `;
            this.bindDynamicEvents();
            this.updateRuntimeNodes();
        }

        renderNavItem(page) {
            return `<button class="hm-nav-item ${this.activePage === page.id ? 'hm-active' : ''}" data-page="${page.id}"><span>${page.icon}</span><span>${page.label}</span></button>`;
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
            const horse = state.currentHorse;
            return `
                <div class="hm-grid hm-grid-2">
                    <div class="hm-card">
                        <div class="hm-card-title">Состояние</div>
                        <div class="hm-status-row">
                            <span class="hm-status hm-status-${state.status}">${this.statusLabel(state.status)}</span>
                            <span class="hm-muted">Время: <span data-runtime>${this.getRuntimeText()}</span></span>
                        </div>
                        <div class="hm-info-list">
                            <div><span>Текущая лошадь</span><strong>${this.escapeHtml(state.currentHorseName || '—')}</strong></div>
                            <div><span>Операция</span><strong>${this.escapeHtml(state.currentOperation || '—')}</strong></div>
                            <div><span>Прогресс</span><strong>${state.progress.current} / ${this.formatTotal(state)}</strong></div>
                        </div>
                        <div class="hm-actions">
                            <button class="hm-button hm-primary" data-action="start">Старт</button>
                            <button class="hm-button" data-action="pause">Пауза</button>
                            <button class="hm-button" data-action="resume">Продолжить</button>
                            <button class="hm-button hm-danger" data-action="stop">Стоп</button>
                        </div>
                        <div class="hm-actions hm-actions-left">
                            <button class="hm-small-button" data-action="soft-stop">Остановить после текущей</button>
                            <button class="hm-small-button" data-action="analyze">Анализ</button>
                        </div>
                    </div>
                    <div class="hm-card hm-card-accent">
                        <div class="hm-card-title">v0.3.1: правки интерфейса</div>
                        <p>Добавлены прокрутка внутри окна, режим лимита «Авто», запоминание открытого раздела и живое время работы.</p>
                        <p class="hm-muted">Уход и тренировки появятся следующими этапами.</p>
                        ${horse ? this.renderHorseMini(horse) : ''}
                    </div>
                </div>
                ${this.renderLogPanel()}
            `;
        }

        renderHorseMini(horse) {
            return `<div class="hm-mini-horse"><div><span>Энергия</span><strong>${this.valueOrDash(horse.energy, '%')}</strong></div><div><span>Здоровье</span><strong>${this.valueOrDash(horse.health, '%')}</strong></div><div><span>Настроение</span><strong>${this.valueOrDash(horse.mood, '%')}</strong></div></div>`;
        }

        renderRunPage() {
            const state = this.stateManager.get();
            return `
                <div class="hm-grid hm-grid-2">
                    <div class="hm-card">
                        <div class="hm-card-title">Гибридный прогон табуна</div>
                        <p>Текущая версия делает безопасный маршрут: текущая лошадь → анализ → следующая лошадь.</p>
                        <div class="hm-note">Режим «Авто» останавливается, когда скрипт снова встречает уже обработанную лошадь — это признак, что завод пройден по кругу.</div>
                        ${this.renderSettingsSection('run')}
                        ${this.renderSettingsSection('delays')}
                    </div>
                    <div class="hm-card">
                        <div class="hm-card-title">Текущий запуск</div>
                        <div class="hm-info-list">
                            <div><span>Статус</span><strong>${this.statusLabel(state.status)}</strong></div>
                            <div><span>Время</span><strong data-runtime>${this.getRuntimeText()}</strong></div>
                            <div><span>Обработано</span><strong>${state.progress.current}</strong></div>
                            <div><span>Лимит</span><strong>${this.formatTotal(state)}</strong></div>
                            <div><span>Мягкая остановка</span><strong>${state.run.softStopRequested ? 'да' : 'нет'}</strong></div>
                        </div>
                        <div class="hm-actions">
                            <button class="hm-button hm-primary" data-action="start">Старт</button>
                            <button class="hm-button" data-action="pause">Пауза</button>
                            <button class="hm-button" data-action="resume">Продолжить</button>
                            <button class="hm-button hm-danger" data-action="stop">Стоп</button>
                        </div>
                    </div>
                </div>
            `;
        }

        renderActivityPage() {
            return `<div class="hm-card"><div class="hm-card-title">Активность</div><p>Здесь позже появятся тренировки, прогулки, соревнования и умный режим выбора действия.</p><div class="hm-empty">Следующий большой этап после маршрута табуна — базовый уход и активность на остаток энергии.</div></div>`;
        }

        renderEcPage() {
            return `<div class="hm-card"><div class="hm-card-title">КСК</div><p>Здесь позже будет автоматическая запись в конноспортивный центр с умным поиском.</p><div class="hm-empty">Модуль будет добавлен после базового ухода.</div></div>`;
        }

        renderBlacklistPage() {
            return `<div class="hm-card"><div class="hm-card-title">Чёрный список</div><p>Здесь будут правила пропуска: жеребята, беременные, VIP, лошади в продаже и другие исключения.</p><div class="hm-empty">Правила появятся вместе с полноценным табунным режимом.</div></div>`;
        }

        renderStatsPage() {
            const state = this.stateManager.get();
            const logItems = this.logger.all();
            const errors = logItems.filter((item) => item.level === 'error').length;
            return `
                <div class="hm-grid hm-grid-3">
                    <div class="hm-stat"><span>Обработано</span><strong>${state.progress.current}</strong></div>
                    <div class="hm-stat"><span>Переходов</span><strong>${Math.max(0, state.progress.current - 1)}</strong></div>
                    <div class="hm-stat"><span>Ошибок</span><strong>${errors}</strong></div>
                </div>
                <div class="hm-card"><div class="hm-card-title">Статистика</div><p>В v0.3.1 статистика считает обработанных лошадей в гибридном режиме. После подключения ухода здесь появятся чистки, уроки, тренировки, КСК и сон.</p></div>
            `;
        }

        renderDeveloperPage() {
            const pageInfo = this.adapter.getPageInfo();
            const developerEnabled = this.settingsManager.get('developer', 'enabled');
            const analysis = this.latestAnalysis || this.adapter.analyzeHorse();
            return `
                <div class="hm-grid hm-grid-2">
                    <div class="hm-card">
                        <div class="hm-card-title">Диагностика страницы</div>
                        ${this.renderSettingsSection('developer')}
                        ${developerEnabled ? `
                            <div class="hm-dev-grid">
                                <div><span>URL</span><strong>${this.escapeHtml(this.shorten(pageInfo.url, 95))}</strong></div>
                                <div><span>Домен</span><strong>${this.escapeHtml(pageInfo.hostname)}</strong></div>
                                <div><span>Тип страницы</span><strong>${this.escapeHtml(pageInfo.pageTypeLabel)}</strong></div>
                                <div><span>Адаптер</span><strong>${this.escapeHtml(pageInfo.adapter)}</strong></div>
                                <div><span>Страница лошади</span><strong>${pageInfo.pageType === PageType.HORSE ? 'да' : 'нет'}</strong></div>
                                <div><span>Список лошадей</span><strong>${pageInfo.pageType === PageType.HORSE_LIST ? 'да' : 'нет'}</strong></div>
                            </div>
                            <div class="hm-actions hm-actions-left"><button class="hm-button hm-primary" data-action="analyze">Обновить анализ</button></div>
                        ` : '<div class="hm-empty">Режим разработчика выключен.</div>'}
                    </div>
                    <div class="hm-card">
                        <div class="hm-card-title">Найденные данные</div>
                        ${this.renderAnalysis(analysis)}
                    </div>
                </div>
            `;
        }

        renderAnalysis(analysis) {
            if (!analysis) return '<div class="hm-empty">Пока нет анализа.</div>';
            return `
                <div class="hm-info-list">
                    <div><span>ID</span><strong>${this.escapeHtml(analysis.id || '—')}</strong></div>
                    <div><span>Имя</span><strong>${this.escapeHtml(analysis.name || '—')}</strong></div>
                    <div><span>Энергия</span><strong>${this.valueOrDash(analysis.energy, '%')}</strong></div>
                    <div><span>Здоровье</span><strong>${this.valueOrDash(analysis.health, '%')}</strong></div>
                    <div><span>Настроение</span><strong>${this.valueOrDash(analysis.mood, '%')}</strong></div>
                    <div><span>Возраст</span><strong>${this.escapeHtml(analysis.age || '—')}</strong></div>
                    <div><span>Пол</span><strong>${this.escapeHtml(analysis.sex || '—')}</strong></div>
                    <div><span>Кнопка следующей лошади</span><strong>${analysis.hasNextHorseButton ? 'найдена' : 'не найдена'}</strong></div>
                    <div><span>Селектор кнопки</span><strong>${this.escapeHtml(analysis.nextHorseButtonSelector || '—')}</strong></div>
                </div>
                <details class="hm-details"><summary>Сырой текст страницы</summary><pre>${this.escapeHtml(analysis.pageTextSample || '')}</pre></details>
            `;
        }

        renderSettingsPage() {
            return `<div class="hm-card"><div class="hm-card-title">Настройки</div>${this.renderSettingsSection('appearance')}${this.renderSettingsSection('delays')}<div class="hm-actions hm-actions-left"><button class="hm-button hm-danger" data-action="reset-settings">Сбросить настройки</button><button class="hm-button" data-action="clear-log">Очистить лог</button></div></div>`;
        }

        renderSettingsSection(sectionId) {
            const section = settingsSchema.find((item) => item.id === sectionId);
            if (!section) return '';
            return `<div class="hm-settings-section"><div class="hm-section-title">${section.title}</div><p class="hm-muted">${section.description}</p>${section.fields.map((field) => this.renderField(section.id, field)).join('')}</div>`;
        }

        renderField(sectionId, field) {
            const value = this.settingsManager.get(sectionId, field.id);
            const fieldId = `hm-field-${sectionId}-${field.id}`;
            if (field.type === 'checkbox') return `<label class="hm-field hm-field-checkbox" for="${fieldId}"><input id="${fieldId}" type="checkbox" data-setting-section="${sectionId}" data-setting-field="${field.id}" ${value ? 'checked' : ''}><span>${field.label}</span></label>`;
            if (field.type === 'select') return `<label class="hm-field" for="${fieldId}"><span>${field.label}</span><select id="${fieldId}" data-setting-section="${sectionId}" data-setting-field="${field.id}">${field.options.map((option) => `<option value="${option.value}" ${option.value === value ? 'selected' : ''}>${option.label}</option>`).join('')}</select></label>`;
            if (field.type === 'number') return `<label class="hm-field" for="${fieldId}"><span>${field.label}</span><input id="${fieldId}" type="number" value="${value}" min="${field.min}" max="${field.max}" step="${field.step || 1}" data-setting-section="${sectionId}" data-setting-field="${field.id}"></label>`;
            return '';
        }

        renderLogPanel() {
            const items = this.logger.all().slice(0, 14);
            return `<div class="hm-card hm-log-card"><div class="hm-card-header"><div class="hm-card-title">Лог</div><button class="hm-small-button" data-action="clear-log">Очистить</button></div><div class="hm-log-list">${items.length ? items.map((item) => `<div class="hm-log-item hm-log-${item.level}"><span>${item.time}</span><strong>${this.escapeHtml(item.message)}</strong></div>`).join('') : '<div class="hm-empty">Лог пока пуст.</div>'}</div></div>`;
        }

        bindEvents() {
            window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
                if (this.settingsManager.get('appearance', 'theme') === 'auto') this.render();
            });
        }

        bindDynamicEvents() {
            this.root.querySelectorAll('[data-page]').forEach((button) => {
                button.addEventListener('click', () => {
                    this.activePage = button.dataset.page;
                    const ui = this.settingsManager.storage.get('ui', {});
                    this.settingsManager.storage.set('ui', { ...ui, activePage: this.activePage });
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
                    const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
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
                    this.drag = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
                    event.preventDefault();
                });
            });

            const onMouseMove = (event) => {
                if (!this.drag) return;
                const x = Math.max(12, Math.min(window.innerWidth - 120, event.clientX - this.drag.offsetX));
                const y = Math.max(12, Math.min(window.innerHeight - 120, event.clientY - this.drag.offsetY));
                app.style.left = `${x}px`;
                app.style.top = `${y}px`;
                app.style.right = 'auto';
                app.style.bottom = 'auto';
                app.style.height = `min(720px, calc(100vh - ${y + 16}px))`;
                app.style.maxHeight = `calc(100vh - ${y + 16}px)`;
            };

            const onMouseUp = () => {
                if (!this.drag) return;
                const rect = app.getBoundingClientRect();
                const ui = this.settingsManager.storage.get('ui', {});
                this.settingsManager.storage.set('ui', { ...ui, x: Math.round(rect.left), y: Math.round(rect.top), activePage: this.activePage });
                this.drag = null;
            };

            document.removeEventListener('mousemove', this._onMouseMove);
            document.removeEventListener('mouseup', this._onMouseUp);
            this._onMouseMove = onMouseMove;
            this._onMouseUp = onMouseUp;
            document.addEventListener('mousemove', this._onMouseMove);
            document.addEventListener('mouseup', this._onMouseUp);
        }

        async handleAction(action) {
            const ui = this.settingsManager.storage.get('ui', { minimized: false });
            if (action === 'start') return this.runner.start();
            if (action === 'pause') return this.runner.pause();
            if (action === 'resume') return this.runner.resume();
            if (action === 'stop') return this.runner.stop();
            if (action === 'soft-stop') return this.runner.softStop();

            if (action === 'analyze') {
                const analysis = this.adapter.analyzeHorse();
                this.storageSetAnalysis(analysis);
                this.stateManager.patch({ currentHorse: analysis, currentHorseName: analysis.name || '—', currentHorseId: analysis.id || null, pageType: this.adapter.getPageInfo().pageType });
                this.logger.success('Анализ страницы обновлён');
                this.activePage = 'developer';
                this.settingsManager.storage.set('ui', { ...ui, activePage: this.activePage });
                this.render();
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
                this.settingsManager.storage.set('ui', { ...ui, minimized: !ui.minimized, activePage: this.activePage });
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

        formatTotal(state) {
            return state.run?.limitMode === 'auto' ? 'Авто' : (state.progress.total || this.settingsManager.get('run', 'maxHorsesPerRun'));
        }

        formatDuration(ms) {
            const totalSeconds = Math.floor(ms / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
            const seconds = (totalSeconds % 60).toString().padStart(2, '0');
            return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
        }

        valueOrDash(value, suffix = '') {
            return value === null || value === undefined || value === '' ? '—' : `${value}${suffix}`;
        }

        shorten(value, length) {
            const text = String(value || '');
            return text.length > length ? `${text.slice(0, length)}…` : text;
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
                :host { all: initial; color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
                * { box-sizing: border-box; }
                .hm-app { --hm-bg: rgba(248, 250, 252, 0.98); --hm-panel: #ffffff; --hm-panel-soft: #f8fafc; --hm-text: #172033; --hm-muted: #64748b; --hm-border: rgba(148, 163, 184, 0.25); --hm-primary: #7c3aed; --hm-primary-2: #a855f7; --hm-primary-soft: rgba(124, 58, 237, 0.12); --hm-danger: #e11d48; --hm-success: #059669; --hm-warn: #d97706; --hm-shadow: 0 24px 80px rgba(15, 23, 42, 0.22); position: fixed; right: 24px; bottom: 24px; width: 900px; max-width: calc(100vw - 32px); height: min(720px, calc(100vh - 32px)); max-height: calc(100vh - 32px); z-index: 2147483647; color: var(--hm-text); font-size: 14px; line-height: 1.45; }
                .hm-theme-dark { --hm-bg: rgba(15, 23, 42, 0.98); --hm-panel: #111827; --hm-panel-soft: #0f172a; --hm-text: #e5e7eb; --hm-muted: #94a3b8; --hm-border: rgba(148, 163, 184, 0.22); --hm-primary: #a78bfa; --hm-primary-2: #7c3aed; --hm-primary-soft: rgba(167, 139, 250, 0.16); --hm-danger: #fb7185; --hm-success: #34d399; --hm-warn: #fbbf24; --hm-shadow: 0 24px 80px rgba(0, 0, 0, 0.5); }
                .hm-shell { display: grid; grid-template-columns: 220px minmax(0, 1fr); width: 100%; height: 100%; min-height: 0; overflow: hidden; background: var(--hm-bg); border: 1px solid var(--hm-border); border-radius: 24px; box-shadow: var(--hm-shadow); backdrop-filter: blur(18px); }
                .hm-minimized { width: 310px; height: 76px !important; max-height: 76px !important; }
                .hm-minimized .hm-sidebar, .hm-minimized .hm-page, .hm-minimized .hm-kicker { display: none; }
                .hm-minimized .hm-shell { display: block; border-radius: 20px; }
                .hm-minimized .hm-content, .hm-minimized .hm-header { height: 100%; }
                .hm-sidebar { min-height: 0; overflow: auto; padding: 18px; border-right: 1px solid var(--hm-border); background: linear-gradient(180deg, var(--hm-primary-soft), transparent 55%); }
                .hm-brand { display: flex; gap: 12px; align-items: center; margin-bottom: 20px; cursor: move; user-select: none; }
                .hm-brand-icon { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 14px; background: var(--hm-primary-soft); font-size: 22px; }
                .hm-brand-title { font-weight: 800; letter-spacing: -0.03em; }
                .hm-brand-subtitle, .hm-kicker, .hm-muted { color: var(--hm-muted); font-size: 12px; }
                .hm-nav { display: grid; gap: 6px; }
                .hm-nav-item, .hm-button, .hm-icon-button, .hm-small-button { border: 0; font: inherit; color: inherit; cursor: pointer; }
                .hm-nav-item { display: flex; gap: 10px; align-items: center; width: 100%; padding: 10px 12px; border-radius: 14px; background: transparent; color: var(--hm-muted); text-align: left; transition: 0.18s ease; }
                .hm-nav-item:hover, .hm-nav-item.hm-active { color: var(--hm-text); background: var(--hm-primary-soft); }
                .hm-content { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
                .hm-header { flex: 0 0 auto; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 18px 22px; border-bottom: 1px solid var(--hm-border); cursor: move; user-select: none; }
                .hm-header h1 { margin: 2px 0 0; font-size: 22px; line-height: 1.1; letter-spacing: -0.04em; }
                .hm-window-actions, .hm-actions { display: flex; gap: 8px; align-items: center; }
                .hm-page { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; padding: 20px 22px; scrollbar-width: thin; scrollbar-color: var(--hm-primary) transparent; }
                .hm-page::-webkit-scrollbar, .hm-sidebar::-webkit-scrollbar, .hm-log-list::-webkit-scrollbar, .hm-details pre::-webkit-scrollbar { width: 10px; height: 10px; }
                .hm-page::-webkit-scrollbar-thumb, .hm-sidebar::-webkit-scrollbar-thumb, .hm-log-list::-webkit-scrollbar-thumb, .hm-details pre::-webkit-scrollbar-thumb { background: var(--hm-primary-soft); border-radius: 999px; border: 2px solid transparent; background-clip: padding-box; }
                .hm-grid { display: grid; gap: 14px; margin-bottom: 14px; }
                .hm-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                .hm-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
                .hm-card, .hm-stat { padding: 16px; border: 1px solid var(--hm-border); border-radius: 20px; background: var(--hm-panel); }
                .hm-card-accent { background: linear-gradient(135deg, var(--hm-primary-soft), var(--hm-panel)); }
                .hm-card-title, .hm-section-title { margin-bottom: 10px; font-weight: 800; letter-spacing: -0.02em; }
                .hm-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
                .hm-status-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; }
                .hm-status { display: inline-flex; align-items: center; padding: 6px 10px; border-radius: 999px; background: var(--hm-primary-soft); font-weight: 700; }
                .hm-status-running, .hm-log-success { color: var(--hm-success); }
                .hm-status-paused, .hm-log-warn { color: var(--hm-warn); }
                .hm-status-error, .hm-log-error { color: var(--hm-danger); }
                .hm-info-list, .hm-dev-grid, .hm-mini-horse { display: grid; gap: 8px; margin: 12px 0 16px; }
                .hm-info-list div, .hm-dev-grid div, .hm-mini-horse div { display: flex; justify-content: space-between; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--hm-border); }
                .hm-dev-grid div { display: grid; grid-template-columns: 130px minmax(0, 1fr); }
                .hm-dev-grid strong, .hm-info-list strong { overflow-wrap: anywhere; min-width: 0; }
                .hm-info-list span, .hm-dev-grid span, .hm-stat span, .hm-mini-horse span { color: var(--hm-muted); }
                .hm-actions { justify-content: flex-end; margin-top: 12px; flex-wrap: wrap; }
                .hm-actions-left { justify-content: flex-start; }
                .hm-button, .hm-icon-button, .hm-small-button { border-radius: 12px; background: var(--hm-panel-soft); transition: 0.18s ease; }
                .hm-button { padding: 9px 13px; font-weight: 700; }
                .hm-small-button { padding: 6px 10px; color: var(--hm-muted); font-size: 12px; }
                .hm-icon-button { display: grid; place-items: center; width: 36px; height: 36px; }
                .hm-button:hover, .hm-icon-button:hover, .hm-small-button:hover { transform: translateY(-1px); filter: brightness(1.04); }
                .hm-primary { background: linear-gradient(135deg, var(--hm-primary), var(--hm-primary-2)); color: white; }
                .hm-danger { background: rgba(225, 29, 72, 0.12); color: var(--hm-danger); }
                .hm-note, .hm-empty { margin-top: 12px; padding: 12px; border-radius: 14px; background: var(--hm-panel-soft); color: var(--hm-muted); }
                .hm-settings-section { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--hm-border); }
                .hm-field { display: grid; grid-template-columns: 1fr minmax(150px, 230px); align-items: center; gap: 12px; margin: 10px 0; }
                .hm-field-checkbox { display: flex; justify-content: flex-start; }
                .hm-field input, .hm-field select { width: 100%; padding: 8px 10px; border: 1px solid var(--hm-border); border-radius: 12px; background: var(--hm-panel-soft); color: var(--hm-text); font: inherit; }
                .hm-field-checkbox input { width: auto; accent-color: var(--hm-primary); }
                .hm-log-list { display: grid; gap: 7px; max-height: 210px; overflow: auto; }
                .hm-log-item { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 10px; padding: 8px 10px; border-radius: 12px; background: var(--hm-panel-soft); }
                .hm-log-item span { color: var(--hm-muted); font-size: 12px; }
                .hm-log-item strong { overflow-wrap: anywhere; }
                .hm-stat { display: grid; gap: 4px; }
                .hm-stat strong { font-size: 28px; letter-spacing: -0.05em; }
                .hm-details { margin-top: 12px; color: var(--hm-muted); }
                .hm-details pre { max-height: 150px; overflow: auto; white-space: pre-wrap; padding: 12px; border-radius: 14px; background: var(--hm-panel-soft); color: var(--hm-text); font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
                .hm-compact .hm-sidebar { padding: 14px; }
                .hm-compact .hm-page { padding: 14px; }
                @media (max-width: 760px) { .hm-app { left: 12px !important; right: 12px !important; bottom: 12px; width: auto; height: min(680px, calc(100vh - 24px)); max-height: calc(100vh - 24px); } .hm-shell { grid-template-columns: 1fr; } .hm-sidebar { border-right: 0; border-bottom: 1px solid var(--hm-border); max-height: 220px; } .hm-nav { grid-template-columns: repeat(2, minmax(0, 1fr)); } .hm-grid-2, .hm-grid-3 { grid-template-columns: 1fr; } }
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
            this.runner = new HerdRunner({
                adapter: this.adapter,
                stateManager: this.stateManager,
                settingsManager: this.settingsManager,
                logger: this.logger,
                delayManager: this.delayManager,
            });
            this.ui = new UIManager({
                eventBus: this.eventBus,
                logger: this.logger,
                settingsManager: this.settingsManager,
                stateManager: this.stateManager,
                adapter: this.adapter,
                runner: this.runner,
            });
        }

        start() {
            const pageInfo = this.adapter.getPageInfo();
            const analysis = pageInfo.pageType === PageType.HORSE ? this.adapter.analyzeHorse() : null;
            const currentState = this.stateManager.get();
            this.stateManager.patch({
                pageType: pageInfo.pageType,
                currentHorse: analysis,
                currentHorseName: analysis?.name || currentState.currentHorseName || '—',
                currentHorseId: analysis?.id || currentState.currentHorseId || null,
            });
            this.storage.set('latestAnalysis', analysis);
            this.ui.mount();
            this.logger.info('Howrse Manager загружен');
            this.logger.info(`Адаптер: ${pageInfo.adapter}`);
            this.runner.scheduleAutoResume();
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
