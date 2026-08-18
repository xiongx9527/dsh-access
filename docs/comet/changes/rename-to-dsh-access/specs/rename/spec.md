# dsh-access 全量重命名规格

## Canonical identifiers

| 位置 | 目标值 |
|---|---|
| npm package | `dsh-access` |
| version | `1.0.0` |
| CLI | `dsh-access` |
| plugin name | `dsh-access` |
| settings section id | `dsh-access` |
| UI label | `访问管理` / `Access management` |
| API prefix | `/api/dsh-access/` |
| env file variable | `DSH_ACCESS_ENV_FILE` |
| GitHub repository | `xiongx9527/dsh-access` |

## Package and plugin

- `package.json.name` is `dsh-access` and `version` is `1.0.0`.
- `bin`, `main`, `types`, exports, package files and package scripts use the new package identity.
- repository/homepage/bugs point to `https://github.com/xiongx9527/dsh-access`.
- `src/plugin.ts` exports `name = 'dsh-access'`.
- Client settings section, account, mobile, chat and token ids use `dsh-access` prefixes.
- Runtime env lookup uses `DSH_ACCESS_ENV_FILE`; no `DSH_PASSWORDS_ENV_FILE` fallback remains.
- Runtime log labels use `[dsh-access]` where the label is user-visible in the console.

## API and client

- Every active client request changes from `/api/dsh-passwords/...` to `/api/dsh-access/...`.
- Gateway exact-route registration, remote-access authentication, request policy checks and tests use the new prefix.
- No old API alias is registered.
- Existing response models, authentication, permissions and database records remain unchanged.

## UI and docs

- Settings section label remains `访问管理`.
- Page title and error/login copy use `访问管理` / `Access management`.
- Account tab remains `账号权限`; remote tab remains `远程访问`.
- Active README and installation docs use the new package/repository/CLI names and do not present `dsh-passwords` as an installable identity.
- Technical historical archive text may retain provenance only if it is not shipped as active package documentation; shipped files and active source must not expose the old name.

## Repository migration

- Create a new public non-fork repository `xiongx9527/dsh-access`.
- Push the verified local `main` to the new repository's `main`.
- Verify `isFork=false`, default branch `main`, and remote HEAD equals local HEAD.
- Leave `xiongx9527/dsh-passwords-ext` untouched for the user to delete manually.

## Compatibility and data

- Do not rename SQLite files, tables, database fields, SETUP_KEY-derived values, or gateway port configuration.
- Do not change remote access behavior, QR generation, tunnel behavior, mobile layout, account behavior or password policy.
- The old package/API/env identifiers are intentionally not supported after this change.

## Verification

- `git grep -n -i 'dsh-passwords\|dsh-passwords-ext\|DSH_PASSWORDS_ENV_FILE' -- active source/tests/docs` returns no active identity hits, excluding Git history and explicitly retained provenance artifacts.
- `npm test` passes.
- `npm run build` passes.
- `npm pack --dry-run` lists `dsh-access-1.0.0.tgz`.
- New package installs and starts DSH with the existing database.
- New standalone GitHub repository contains the verified main commit.
