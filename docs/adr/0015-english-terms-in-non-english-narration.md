# 0015 English terms in non-English narration

Accepted on 4 November 2026. Refines [language-aware pronunciation](0014-language-aware-pronunciation.md) and [production provenance](0009-production-provenance.md).

## Golden rule

**English technical terms retain English pronunciation in every narration language.** The narrator's language controls surrounding prose, not the pronunciation of embedded English words or technical initialisms. English words such as Engine are spoken as words; English initialisms use English letter names. Native-language abbreviations remain explicit exceptions: German KI uses separate German K–I letter names. Canonical spelling in the script, labels and captions remains unchanged.

Pronunciation overrides must not silently substitute a German translation for a written English term. Mentioning a valid translation does not authorize using it in the voice. A translation belongs to an explicit script wording change; speech then follows that written term.

The rejected German Martin audition demonstrated the mechanism: converting an entire sentence with German G2P changed `Engine` to `ɛŋˈiːnə`, while English G2P produces `ˈɛnʤɪn`. Hyphenated letter spellings and German approximations of English words do not establish English pronunciation. Voice-input text alone cannot carry the required language choice.

## Contract

Story pronunciation entries accept either a legacy string or `{text, lang}`. The shared [English technical-term dictionary](../../data/english-technical-terms.json) supplies English readings for recognized terms in non-English narration. Legacy string overrides of recognized English terms retain English language; explicitly assigning those terms a non-English language fails validation. Story-local annotations cover product names and other terms outside the dictionary. The dictionary is finite and matching is whole-term and case-sensitive; listed case/plural variants are explicit. Reviewers must identify missing terms and annotate them before synthesis. Ambiguous words such as German “links” cannot safely be classified by a global dictionary.

One resolved plan retains canonical-to-spoken offsets and ordered `{text, lang}` runs. Alignment uses canonical spans; synthesis consumes the language runs. Runs can merge without merging canonical spans. `narration --json` preserves runs for every clip, including monolingual clips. Plain narration export refuses mixed-language plans because flattening them would discard required pronunciation information.

Voice adapters explicitly support mixed-language runs or fail before synthesis and cache reuse. Chunking and overflow retries retain the runs; a monolingual adapter never receives flattened mixed-language input. The Martin runner requires explicit runs and checks the joined spoken text against the shared dictionary, preventing a known English term split across runs from escaping the rule. It applies German or English G2P per run, combines the phonemes, and uses one voice inference per passage. Unknown languages and phonemes fail rather than falling back to German.

Resolved-input hashes include ordered language runs whenever they affect synthesis. Changing only a used term's language invalidates cached audio and production review even if text bytes are unchanged. Unchanged monolingual English inputs retain their historical serialization and hashes. Unused glossary changes do not invalidate audio.

## Evidence boundary

The policy applies to all non-English narration. The implemented Martin frontend supports German prose with `en-us` or `en-gb` runs; other adapters must explicitly support their required language combinations. Routing tests and phoneme evidence establish that the intended frontend was used, not that a particular model speaks it intelligibly. Keep representative listening review mandatory before full narration, and retain source text, runs and actual phonemes with the audition.
