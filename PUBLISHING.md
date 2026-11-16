# Publishing

The repository and the VS Code Marketplace are separate distribution channels. Making the source public is not required to publish a VSIX, and does not publish the extension automatically.

## Review before making the repository public

1. Run `npm ci --ignore-scripts` with Node.js 22 or later.
2. Run `npm run check`, `npm test`, `npm run verify:privacy`, and `npm run verify:history` from a full clone with all intended public refs fetched.
3. Run `npm audit` and review any alerts, including development tooling.
4. Run `npm run verify:distribution` and `npm run package`. The package command preserves dependency notices and independently verifies the finished VSIX.
5. Review [REVIEW_REPORT.md](REVIEW_REPORT.md), [LICENSE_REVIEW.md](LICENSE_REVIEW.md), [LICENSE](LICENSE), and [PRIVACY.md](PRIVACY.md).
6. Check that only intended branches/tags and public account metadata will be exposed. Do not upload local VS Code storage, provider profiles, `.env` files, histories, or private test artifacts. A pattern scan cannot guarantee absence of every kind of secret.

## Marketplace

1. Follow the [official publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) to create a publisher owned by the intended account holder and review the applicable Marketplace agreement.
2. Set `publisher` in `package.json` to that exact publisher ID. `local-development` is a placeholder. Changing it changes the extension identifier and storage location; existing development history is not automatically migrated.
3. Select a new release version, update the lockfile and changelog, and rerun all checks and packaging.
4. Inspect the generated VSIX before publishing. It must contain LICENSE, THIRD_PARTY_NOTICES.md, DEPENDENCY-LICENSES.json, and the original license texts under licenses/.
5. Upload the reviewed VSIX through the publisher management page, or use the official CLI with narrowly scoped credentials supplied outside this repository. Never commit a Marketplace token or put one in an npm script, README, or issue.

Claude Code is a separately installed extension dependency; each user must authenticate under their own applicable provider agreement. Codex and Ollama executables and model weights are not included. Review provider terms if this integration or distribution model changes.
