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
    globalThis.defineScene = defineScene;
})();
