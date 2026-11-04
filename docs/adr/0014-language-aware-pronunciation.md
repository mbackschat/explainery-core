# 0014 Language-aware pronunciation

Accepted on 4 November 2026. Extends [production provenance](0009-production-provenance.md).

The monolingual pronunciation defaults below were refined by [ADR 0015](0015-english-terms-in-non-english-narration.md) after the German audition was rejected. English technical terms now retain English pronunciation inside every non-English narration; German KI remains German. Per-term language runs supersede applying one language to the complete voice-input string.

## Decision

`voice.lang` in `story.yaml` selects the narration's pronunciation language, including preparation for a human or external voice. It defaults to the configured Kokoro voice prefix, then `en-us`. The schema lists supported language identifiers; use `de` for German. This setting does not establish synthesis support.

The shared narration resolver supplies English or German common acronym readings, then applies story overrides. Other languages receive no English defaults. Existing English substitutions and their input hashes remain unchanged. The English article/pronoun guards for `A` and `I` apply only to English. Canonical script text, labels and captions remain unchanged; spoken alignment uses the same substitutions and projects recognized speech back onto canonical words.

German defaults spell common acronyms using German letter names; they do not choose a universal reading for product names or ambiguous terms. eSpeak phoneme inspection on 4 November 2026 produced `ˈɑːpˈeːˈiː` for `A-P-I` and `kˈɑːˈiː` for `K-I`. This settles the frontend spelling mechanism, not listening quality or an author's preferred reading. Story glossaries retain overrides and listening evidence under the [voice guidance](../authoring.md#pronunciation-and-voice-direction).

Transient voice options may change dialect within the stored primary language. A change to another primary language requires storing `voice.lang` first, so subsequent narration export, alignment and production checks can reconstruct the same substitutions. Production records additionally retain the primary pronunciation language: changing it invalidates review even when the text contains no substituted terms. Legacy records without that field are treated as English; non-English legacy recordings require review and a fresh record. This preserves English records and text hashes without claiming evidence for an unstored language.

## German synthesis boundary

The pinned HyperFrames adapter does not support German weights. Preparing German pronunciation input is supported; asking that adapter for German synthesis fails explicitly. A German runtime must use matching model weights, voice data and phoneme preprocessing. Model downloads and listening approval are separate from this contract. See [German voice preparation](../german-voice.md) for the Martin candidate and shared-cache recommendation.
