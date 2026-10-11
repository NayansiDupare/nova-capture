# Nova Capture — Security

> Version 1.0 · 11 October 2026
> Scope: Windows desktop app (Electron) for **personal use**. Public distribution requires the proxy backend described in ARCHITECTURE §20.

---

## 1. What we protect

| Asset | Why it matters |
|---|---|
| **API keys** (STT, LLM) | Can be abused to run up costs |
| **Transcripts and notes** | May contain personal or sensitive content |
| **Raw audio (spool files)** | Same as above, plus larger exposure |
| **The user's machine** | A compromised renderer must not get Node or filesystem access |

---

## 2. Threat model

| Threat | Example | Mitigation |
|---|---|---|
| Malicious content in a renderer | XSS via transcript text or a crafted note | Sandbox, context isolation, CSP, React escaping, no `dangerouslySetInnerHTML` |
| Renderer escalation | Compromised renderer calls arbitrary IPC | Narrow preload API, channel allow-list, zod validation in main |
| Secret theft | Key read from renderer, logs or disk | safeStorage encryption, main-only decryption, write-only IPC, log redaction |
| Prompt injection via audio | Video says "ignore instructions and…" | Transcript is data, not instructions; structured output + schema validation; LLM has no tools |
| Malicious dependency | Compromised npm package | Pinned versions, lockfile, `pnpm audit` in CI, minimal deps |
| Data at rest exposure | Someone reads the notes DB | Stored in user profile; OS account protection; optional future encryption |
| Accidental recording | Capture runs unnoticed | Always-visible indicator in overlay and tray |
| Network interception | Provider traffic sniffed | HTTPS only; no certificate bypass |

**Out of scope for v1:** an attacker with full access to the user's Windows account, and malware already on the machine.

---

## 3. Electron hardening

### 3.1 Every BrowserWindow

```ts
new BrowserWindow({
  webPreferences: {
    preload: path.join(__dirname, '../preload/main-ui.js'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    spellcheck: false,
  },
});
```

### 3.2 Checklist

- [ ] `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` in **every** window
- [ ] No remote URLs loaded; only bundled local files
- [ ] `will-navigate` blocked; `setWindowOpenHandler` returns `{ action: 'deny' }`
- [ ] External links opened via `shell.openExternal` **only** for `https:` URLs after validation
- [ ] `session.setPermissionRequestHandler` denies everything except display-media for the Capture Host
- [ ] `setDisplayMediaRequestHandler` only answers requests from the Capture Host's webContents
- [ ] No `<webview>` tags; `will-attach-webview` blocked
- [ ] DevTools disabled in production builds
- [ ] Electron kept on a supported, current stable version
- [ ] Electron Fuses set in production: disable `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`; enable `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar` (verify fuse names for the pinned Electron version)

### 3.3 Content Security Policy

Set via meta tag in each renderer HTML and via response headers:

```
default-src 'self';
script-src 'self';
style-src 'self';
img-src 'self' data:;
font-src 'self';
connect-src 'self';
object-src 'none';
base-uri 'none';
form-action 'none';
frame-ancestors 'none';
```

- No `unsafe-eval`. No `unsafe-inline` for scripts.
- Fonts are bundled locally (no Google Fonts at runtime).
- Renderers make **no** network requests; all provider calls happen in main.
- The dev server may relax CSP for HMR **in dev only**.

---

## 4. IPC security

- The preload exposes **one function per channel** via `contextBridge`. Never expose `ipcRenderer` itself.
- Main validates every payload with the channel's zod schema; invalid payloads are rejected and logged.
- Main checks `event.senderFrame` belongs to an expected window for sensitive channels.
- No generic channels like `invoke(channel, ...args)` or `fs:read`.
- Renderers never receive file paths they can act on, SQL, or secrets.

---

## 5. Secrets

- API keys are stored with Electron **`safeStorage`** (DPAPI on Windows) and saved as encrypted blobs.
- Keys are decrypted **only in main**, only when making a provider call, and never cached in renderer memory.
- `secrets:set` is **write-only**. The UI shows "Key saved ✓" and the last 4 characters at most.
- If `safeStorage.isEncryptionAvailable()` is false, refuse to save and explain why. Never fall back to plain text.
- Keys are never logged, included in error messages, or written to diagnostics exports.
- No keys in source code, `.env` files in the repo, or CI logs. `.env*` is in `.gitignore`.

> ⚠️ A packaged desktop app cannot truly hide a key from its own user. This model is for **personal use only**.

---

## 6. Data privacy

| Data | Location | Retention |
|---|---|---|
| Notes, transcripts | SQLite in `%APPDATA%/Nova Capture/` | Until user deletes |
| Spool audio | Temp folder in app data | Deleted after note is saved (default); never before |
| Logs | Rotating files in app data | Size-capped; no transcript text by default |
| Usage log | SQLite | Until user clears |

- **No telemetry.** No data leaves the machine except audio chunks to the STT provider and transcript text to the LLM provider.
- Settings show which providers receive data.
- "Delete note" removes the note, segments, FTS entry and any remaining audio.
- Diagnostics export excludes transcripts and keys; the user sees what's included before saving.

---

## 7. AI and prompt safety

- Transcript text is treated as **untrusted data**, wrapped in clear delimiters in the prompt.
- The LLM has **no tools** and cannot trigger actions; its only output is a schema-validated note.
- Model output is rendered as plain text in React (escaped); Markdown rendering, if added, must sanitize and disallow raw HTML and links to non-`https` URLs.

---

## 8. Supply chain

- Lockfile committed; installs use `pnpm install --frozen-lockfile` in CI.
- `pnpm audit` runs in CI; high/critical issues block release.
- Prefer well-maintained packages with few transitive dependencies.
- Native modules (`better-sqlite3`, optional helper) built in CI, not downloaded from unknown sources.
- Review dependency updates; don't blindly accept major bumps.

---

## 9. Responsible use

- Capture is for **personal use** of content you have the right to access.
- The recording indicator is always visible; it cannot be hidden in settings.
- Recording laws and content terms vary by country and platform; users are responsible for complying.

---

## 10. PR security checklist

- [ ] No new IPC channel without a zod schema and preload wrapper
- [ ] No change to `webPreferences`, CSP or permission handlers without review and an ADR
- [ ] No secrets, keys or real transcripts in code, tests or fixtures
- [ ] No transcript text or keys added to logs
- [ ] New dependencies justified and audited
- [ ] External input (provider responses, files, settings) validated at the boundary
- [ ] No `dangerouslySetInnerHTML`, `eval`, `new Function`

---

## 11. Reporting a vulnerability

This is a personal project. If you find a security issue, please open a **private** GitHub security advisory on the repository instead of a public issue.
