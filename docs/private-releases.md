# Publish a private film for download and playback

The standard publication route for a private film repository is one mutable GitHub release named `film-current`, holding one current standalone HTML attachment. Viewers with repository access download the file and open it locally in their browser. The film, audio, captions and player are embedded; no web host is required.

## Contract

- Keep the source repository private. Its film, previews and downloads inherit that privacy; never move them into a public companion repository.
- Keep generated HTML under ignored `renders/`, outside Git history and deployment branches.
- Retain only the current HTML attachment in `film-current`. Replace it on updates using the same filename; do not create a historical release or versioned attachment for each export.
- Keep the download URL stable: `https://github.com/OWNER/REPO/releases/download/film-current/FILENAME.html`.
- Record the current film source commit, core revision, byte size, SHA-256 and verification scope in the release notes. The stable release tag is a download anchor; its initial commit is not the authority for later replacement content.
- Publish explicitly after local verification. Do not regenerate narration or render MP4 as part of publication.

Release attachments live outside Git history. Replacing the attachment removes the previous downloadable copy, so retained release storage follows the size of the current film rather than the number of updates. This policy does not remove viewers' downloaded copies.

## First publication

Export the current film locally using its `export:file` command or the [single-file exporter](../README.md#export-a-single-file-to-send). Include the matching reviewed WebVTT file when captions are wanted. Verify playback, seeking, chapters, any subtitles and offline narration before uploading; retain the receipt under ignored `renders/`.

Run commands from the story repository. Check that the repository is private and release immutability is disabled; an immutable release cannot provide this replacement policy. If immutability is enforced, report the conflict rather than silently changing account policy or accumulating releases.

```bash
gh repo view --json isPrivate
gh api repos/OWNER/REPO/immutable-releases
shasum -a 256 renders/my-film.html
gh release create film-current renders/my-film.html --target SOURCE_COMMIT --title "Current film — download & play" --notes-file renders/film-release-notes.md
```

The notes must identify the actual verified file and explain that users download it and open it locally. Download the uploaded attachment into a temporary directory and compare its SHA-256 with the verified local export. Confirm that the repository is still private and the release contains exactly the intended HTML attachment.

## Replace the current delivery

Export and verify first, retaining the local file until upload and download verification succeed. Confirm the existing release is mutable and has only the expected attachment; do not delete unrelated assets.

```bash
gh release upload film-current renders/my-film.html --clobber
gh release edit film-current --notes-file renders/film-release-notes.md
```

The CLI deletes the same-named old attachment before uploading its replacement; an interrupted upload can temporarily leave the link without a file. Retry from the retained, verified local file and verify the downloaded checksum before reporting success. See [GitHub CLI upload semantics](https://cli.github.com/manual/gh_release_upload).

Use one publication at a time per repository. Keep the filename unchanged; if a deliberate rename is needed, update the README and remove only the superseded film attachment after verifying the new one.

## README and repository website

Use the [thumbnail treatment](github-pages.md#readme-link), with the private release download URL as the link and **Download & play** as the caption:

```html
<p>
  <a href="DOWNLOAD_URL"><img alt="Download the film — scene preview" src="docs/assets/film-preview.jpg" width="560"></a><br>
  <a href="DOWNLOAD_URL"><strong>▶ Download &amp; play</strong></a>
</p>
```

Add a short instruction to sign in with repository access, download the HTML and open it locally. Set the repository's website field to its `film-current` release page, where viewers can see the notes and attachment. Existing YouTube links may remain as separately identified deliveries; they do not authorize public distribution of a new private export.

This route uses [GitHub release permissions](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases), not public Pages. For public repositories, the separate [Pages workflow](github-pages.md) remains available.
