"use strict";
/*
 * Explainery scene runtime. Load once in the host page, after GSAP, as a classic script.
 *
 * Browsers load runtime/scene.js, which `pnpm build:runtime` generates from runtime/scene.ts; edit the .ts file and
 * rebuild, and a test fails while the two disagree.
 *
 * HyperFrames runs each sub-composition script with its own window, document, and gsap, scoped to that composition
 * (its getVariables() returns the instance's data-variable-values, and gsap selectors match only inside it). A global
 * function cannot see that scope, so a scene passes it in:
 *
 *   defineScene({ window, document, gsap }, 'library', (tl, { beat, duration }) => {
 *     tl.fromTo('#marker', { opacity: 0 }, { opacity: 1, duration: 0.4 }, beat('publish-book'));
 *   });
 */
/// <reference types="gsap" />
(function () {
    // Timing values come from float arithmetic; a microsecond is far below one frame.
    const EPSILON = 1e-6;
    const seconds = (value) => Number(value.toFixed(6)) + 's';
    function fillCopy(document, copy) {
        document.querySelectorAll('[data-copy]').forEach(function (element) {
            const text = copy[element.dataset.copy];
            if (typeof text === 'string')
                element.textContent = text;
            else
                element.remove();
        });
    }
    // The theme's copy entrance: accent rule, category, a left-to-right headline wipe, then the supporting line.
    const COPY_ENTRANCE = { headline: { at: .1, duration: .75 }, support: { at: .65, duration: .5 } };
    function copyEntrance(document, timeline) {
        const reveal = function (selector, from, to, at) {
            const element = document.querySelector('.copy ' + selector);
            if (element)
                timeline.fromTo(element, from, to, at);
        };
        return function (at, timing) {
            const headline = Object.assign({}, COPY_ENTRANCE.headline, timing && timing.headline);
            const support = Object.assign({}, COPY_ENTRANCE.support, timing && timing.support);
            reveal('.accent-rule', { opacity: 0 }, { opacity: 1, duration: .3 }, at);
            reveal('[data-copy="category"]', { opacity: 0 }, { opacity: 1, duration: .3 }, at + .05);
            reveal('[data-copy="headline"]', { clipPath: 'inset(0 100% 0 0)', opacity: 0 }, { clipPath: 'inset(0 0% 0 0)', opacity: 1, duration: headline.duration, ease: 'power1.out' }, at + headline.at);
            reveal('[data-copy="support"]', { opacity: 0 }, { opacity: 1, duration: support.duration }, at + support.at);
        };
    }
    /**
     * Builds and registers a scene's paused timeline from its composition variables (copy, beats, duration).
     *
     * Elements marked data-copy="<key>" receive the story's copy, or are removed when the story has none for that key.
     * The build can anchor tweens to beat('<id>') so their starts follow narration timing. Tween durations and offsets
     * remain authored seconds; the duration guard below rejects overruns rather than automatically retiming them.
     * enterCopy(at, { headline: { at, duration }, support: { at, duration } }) reveals the copy block from second `at`;
     * the nested offsets are relative to it, default to the theme's entrance, and slots without copy are skipped. A missing
     * beat, or a timeline that runs past the scene, throws instead of registering, so HyperFrames reports a script error.
     */
    const defineScene = function (scope, id, build) {
        const variables = scope.window.__hyperframes.getVariables();
        const duration = variables.duration;
        const beats = variables.beats || {};
        const copy = variables.copy || {};
        if (typeof duration !== 'number')
            throw new Error('scene "' + id + '" received no duration variable; its host needs data-variable-values');
        fillCopy(scope.document, copy);
        const beat = function (name) {
            if (!Object.prototype.hasOwnProperty.call(beats, name))
                throw new Error('scene "' + id + '" has no beat "' + name + '"');
            return beats[name];
        };
        const timeline = scope.gsap.timeline({ paused: true });
        build(timeline, { beat: beat, duration: duration, copy: copy, enterCopy: copyEntrance(scope.document, timeline) });
        if (timeline.duration() > duration + EPSILON) {
            throw new Error('scene "' + id + '" timeline ends at ' + seconds(timeline.duration()) + ', after its ' + seconds(duration));
        }
        scope.window.__timelines[id] = timeline;
        return timeline;
    };
    function append(parent, tag, className, text) {
        const child = parent.ownerDocument.createElement(tag);
        child.className = className;
        if (text !== undefined)
            child.textContent = text;
        parent.appendChild(child);
        return child;
    }
    const pad = (number) => String(number).padStart(2, '0');
    // A chapter card shows its scene's number, title and question beside the roadmap of all scenes; an agenda card
    // shows its headline above that roadmap. Text the story leaves out is not drawn.
    function drawCard(layer, slot, scenes, timeline) {
        const chapter = slot.kind === 'chapter';
        const card = append(layer, 'div', 'card ' + slot.kind);
        append(card, 'div', 'background');
        const main = append(card, 'div', 'card-main');
        append(main, 'div', 'accent-rule');
        if (slot.copy.category)
            append(main, 'p', 'category', slot.copy.category);
        if (chapter)
            append(append(main, 'p', 'card-number', pad(slot.scene + 1)), 'span', 'card-count', ' / ' + pad(scenes.length));
        const title = append(main, 'h1', 'card-title', chapter ? scenes[slot.scene] : slot.copy.headline);
        const question = chapter && slot.copy.headline ? append(main, 'p', 'card-question', slot.copy.headline) : undefined;
        if (slot.copy.support)
            append(main, 'p', 'support', slot.copy.support);
        const roadmap = append(card, 'ol', 'card-roadmap');
        scenes.forEach(function (name, index) {
            append(roadmap, 'li', index < slot.scene ? 'past' : index === slot.scene ? 'current' : 'next', pad(index + 1) + '  ' + name);
        });
        // Seconds on the layer clock. The lead line's wipe shrinks on a short card so nothing outlasts the card.
        const end = slot.start + slot.duration;
        const fadeIn = Math.max(slot.fadeIn, .01);
        const fadeOut = Math.max(slot.fadeOut, .01);
        const settle = Math.min(slot.fadeIn + .15, slot.duration * .3);
        const wipe = Math.max(Math.min(.6, slot.duration - slot.fadeOut - settle), .01);
        timeline.fromTo(card, { opacity: 0 }, { opacity: 1, duration: fadeIn }, slot.start);
        timeline.fromTo(question || title, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: wipe, ease: 'power1.out' }, slot.start + settle);
        // Not rendered at build time: the card must stay hidden until its fade-in.
        timeline.fromTo(card, { opacity: 1 }, { opacity: 0, duration: fadeOut, immediateRender: false }, end - fadeOut);
    }
    /**
     * Draws the story's cards into the card layer composition `id` and registers its timeline through defineScene.
     *
     * explainery assemble passes the cards, every scene title and the layer duration as composition variables. The
     * cards are built here rather than in a core composition file because HyperFrames 0.8.142 skips sub-compositions
     * reached through the node_modules link when it compiles a render, while this script loads like the rest of the
     * runtime. The theme styles them through the .card classes.
     */
    const defineCards = function (scope, id) {
        return defineScene(scope, id, function (timeline) {
            const variables = scope.window.__hyperframes.getVariables();
            const layer = scope.document.querySelector('[data-composition-id="' + id + '"]');
            if (!layer)
                throw new Error('card layer "' + id + '" has no element with its data-composition-id');
            (variables.cards || []).forEach(function (slot) { drawCard(layer, slot, variables.scenes || [], timeline); });
        });
    };
    globalThis.defineScene = defineScene;
    globalThis.defineCards = defineCards;
})();
