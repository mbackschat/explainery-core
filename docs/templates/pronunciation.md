# Pronunciation and voice direction

Copy this template to the chosen glossary owner and replace the placeholders. Follow the shared [pronunciation and voice guidance](../authoring.md#pronunciation-and-voice-direction); update that link for the destination. Keep canonical script wording in the film's `story.yaml`.

Store the narration language in `voice.lang` when it is not implied by the configured Kokoro voice (for example `de` for German). **English technical terms retain English pronunciation in every narration language.** Inventory every such term; use shared dictionary coverage or explicit `{text, lang}` pronunciation entries, and export with `explainery narration --json`. Native-language abbreviations such as German KI remain explicit. These choices affect voice input, not canonical captions or labels. Confirm adapter support and listening quality separately.

## Voice decisions

| Decision | Value | Status and basis |
| --- | --- | --- |
| Narration language and locale | LANGUAGE / LOCALE | Proposed or confirmed · source and date |
| Narrator or synthetic voice | NARRATOR, or ENGINE / VERSION / VOICE | Proposed or confirmed · source and date |
| Delivery | TONE / PACE / EMPHASIS / PAUSES | Proposed or confirmed · reason and date |
| Glossary owner | AUTHORITATIVE FILE OR SOURCE | Link to the owner; keep only local overrides here if shared |
| Applied voice-input mechanism | STORY PRONUNCIATIONS, SUPPORTED ENGINE MECHANISM, or HUMAN DIRECTION | State what is actually applied and where; otherwise write “not applied” |

## Term glossary

Confirmed means the intended reading is settled; it does not mean generated or recorded audio has been heard. Keep one row per term and link authoritative sources where available.

| Canonical spelling | Spoken form and relevant context | Pronunciation language | Decision status | Basis and date | Listening evidence |
| --- | --- | --- | --- | --- | --- |
| `TERM` | READING · letters, numbers or punctuation if relevant | LANGUAGE, independent of narrator | Proposed | RECOMMENDATION, REASON, SOURCE and DATE | Not checked, or link to a reviewed sample and finding |

## Listening check

- Sample: link to a short recording that uses the difficult terms in sentences.
- Voice and settings: record the actual narrator or engine/version/voice, pronunciation mechanism, locale and pace.
- Review: record date, reviewer, terms checked, findings and any unresolved reading. Distinguish listening from text or phoneme inspection.
- Next action: name any correction or approval required by the project. After audio changes, realign timing and inspect affected beats, holds and joins before delivery.
