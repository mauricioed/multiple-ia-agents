# Public release review

Reviewed on November 16, 2026 for Multiple IA Agents 0.1.10.

## Scope and result

No recognized credentials, private account profiles, conversation histories, or personal machine paths were found in the working source tree, the reachable Git commit history, or the verified VSIX. The repository intentionally identifies the public GitHub owner and preserves required third-party author attribution. Commit email addresses use GitHub's noreply domain.

This is a technical review, not an absolute guarantee that every possible secret is absent or a legal opinion covering every provider agreement or future use.

## Credential and distribution checks

- `npm run verify:privacy` checks first-party files and notices for known token, private key, profile, binary, and personal path patterns.
- `npm run verify:history` checks every commit reachable from local Git refs, its file tree, blob contents, commit messages, and author/committer email metadata. GitHub noreply addresses are permitted in commit metadata; required dependency attribution is preserved.
- `npm run package` regenerates dependency notices and verifies the final ZIP contents and packaged source bytes. Test profiles, development dependencies, provider binaries, model weights, credentials, and build helpers are excluded.
- Runtime histories are stored in VS Code extension storage rather than this repository. No real account credentials are required for automated tests.
- Pattern scanning cannot determine whether a harmless-looking value is a secret or identify every kind of confidential text. Unreachable local Git objects and private runtime storage are outside the published reachable history and this report's credential scan.

## Current release recheck

The source baseline for this recheck is commit a34c6b5 (version 0.1.10). After fetching origin and tags, all 12 reachable commits and the 77 source/notice files passed the credential-pattern checks. The subsequent review-documentation commit is checked again before push. Required author attribution and public GitHub identity are intentionally retained.

The four combined dropdown SVGs are original geometric assets created in this project. They add no imported logo, font, or third-party icon license. Claude npm detection reads the installed package's executable metadata and runs that external CLI; it does not import the Anthropic SDK or copy the package into the VSIX. The separately installed Ollama application and existing model are outside this repository and the distributed package.

The runtime license inventory was regenerated and all seven dependency notice hashes were verified. No distribution-license conflict was identified in the reviewed project and runtime dependencies. The final VSIX is rebuilt and independently checked for matching sources, complete notices, unexpected packages, private profiles, binaries, and recognized credentials.

## License review

The original project MIT license and copyright notice remain unchanged. All seven redistributed JavaScript dependencies have their original license texts preserved under `licenses/` and SHA-256 hashes in `DEPENDENCY-LICENSES.json`:

| License | Packages |
| --- | --- |
| MIT | markdown-it, linkify-it, mdurl, punycode.js, uc.micro |
| BSD-2-Clause | entities |
| Python-2.0 | argparse |

These licenses permit redistribution subject to their notices and conditions; the dependency sources and notices are shipped without modification. Development tooling is not included in the VSIX.

Claude chat is launched through Anthropic's separately installed, unmodified official extension. Optional terminal sessions launch the separately installed official Claude CLI in the user's selected folder, without modifying its code or authentication. Users authenticate with their own accounts; this project does not resell access, handle Claude credentials, or restrict official authentication methods. Current Anthropic documentation also places conditions on embedding/running Claude Code and use of its name and logo. The project uses descriptive provider names and its own geometric icons, makes no endorsement claim, and does not bundle provider code. See the [official legal documentation](https://code.claude.com/docs/en/legal-and-compliance); the applicable user/commercial agreements still apply.

Codex and Ollama are separately installed external applications. No provider executable, GPU library, or model weight is redistributed. Ollama's MIT license does not license all models available through Ollama. Model terms must be reviewed individually before use or redistribution.

## Validation

- Syntax checks and 54 automated tests passed.
- A real isolated VS Code host verified two native editor terminals in separate folders, folder explorer selection, and closure synchronization in both directions, without running agents or sending prompts.
- The sidebar browser regression verifies initialization, chat rendering, folder expansion, and nested files.
- The chat browser check verifies the custom Codex UI without usage meters or API-key controls.
- The VSIX checks confirm complete license hashes and only reviewed runtime packages.
- `npm audit` reports zero known vulnerabilities across production and development dependencies at this review. Packaging tooling was upgraded to `@vscode/vsce` 4.1.1; its `minimatch` dependency is overridden to the patched 11.0.1 version. The resulting VSIX passes the independent content verifier. This is not a complete application vulnerability audit.

## Provider agreement limits

Anthropic's current documentation says that preinstalling or running Claude Code in a product requires agreement to its Commercial Terms unless otherwise agreed. It also requires an unmodified binary, unrestricted built-in authentication methods, direct end-user authentication/billing, and compliance with its name/logo restrictions. The technical integration preserves these operational boundaries, but this source review cannot establish whether the publisher has accepted the applicable agreement or has separate written permission. Do not treat the absence of bundled provider binaries as an exemption from provider terms.

No project license grants rights to redistribute arbitrary model weights or use a provider's trademarks as this project's own branding. Marketplace publication remains subject to the actual publisher's agreement and identity setup.

## Before Marketplace publication

- Create the real Marketplace publisher, replace `local-development`, and review the resulting extension/storage identifier change.
- Review and accept the Marketplace agreement and any applicable provider commercial terms as the actual account holder.
- Run the checks again after changing the publisher or dependencies, and build a new version.
- Repository visibility and Marketplace publication are separate actions. This review does not publish to the Marketplace or change repository visibility.

References: [publishing VS Code extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension), [Claude Code legal documentation](https://code.claude.com/docs/en/legal-and-compliance), [Ollama license](https://github.com/ollama/ollama/blob/main/LICENSE), [Codex license](https://github.com/openai/codex/blob/main/LICENSE), and the exact dependency notices shipped with this project.
