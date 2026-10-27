# Hearth on the Mac App Store

Hearth has a second macOS edition for the Mac App Store: the same editor and the same built-in models, adjusted to Apple's sandbox. This page explains what differs, how to build it, and how to submit it.

## The store edition

The App Store requires every Mac app to run in Apple's App Sandbox, to update only through the App Store, and to keep its code inside its own bundle. The store edition follows those rules.

| | Edition from GitHub | Mac App Store edition |
| --- | --- | --- |
| Models | Built in, plus Ollama and LM Studio | The same |
| Agent | Reads, edits and runs commands | Reads and edits, runs no commands |
| Terminal | Yes | No |
| Folders | Any folder | Folders you open, remembered with your permission |
| Git | The git on your computer | The git in Xcode or the Command Line Tools |
| Commit author | Your git configuration | Name and email in Settings, Source control |
| Updates | Check for Updates in the Hearth menu | The App Store |

Electron's App Store build sets `process.mas`, and Hearth switches to this edition when it sees it ([src/main/edition.ts](../src/main/edition.ts)). `HEARTH_STORE_EDITION=1` turns the same behavior on in a regular build, which is how [tests/e2e/store.spec.ts](../tests/e2e/store.spec.ts) covers it on every system.

### What the sandbox allows, and why

The entitlements are in [build/entitlements.mas.plist](../build/entitlements.mas.plist) for the app and [build/entitlements.mas.inherit.plist](../build/entitlements.mas.inherit.plist) for its helpers and the model engine.

| Entitlement | Why |
| --- | --- |
| `app-sandbox` | Required for every Mac App Store app. |
| `network.client` | Downloads models from Hugging Face, and talks to the engine and to Ollama or LM Studio. |
| `network.server` | The built-in engine listens on 127.0.0.1, on a random port, with a key only Hearth knows. |
| `files.user-selected.read-write` | Reads and writes the folders the user opens. |
| `files.bookmarks.app-scope` | Reopens those folders after a restart without asking again. |
| `application-groups` | Electron's App Store build names its shared resources after the team: `TEAM_ID.dev.myrhex.hearth`. |

The engine is llama.cpp's server. It ships inside the app, is signed with it, and runs inside the same sandbox. The files Hearth downloads are model weights: data, not code.

## What has been tested

On an Apple silicon Mac, with a sandboxed build signed ad hoc (`npm run dist:mas-local`):

- It starts in its sandbox container, as the store edition.
- It downloads models from Hugging Face and runs chat, autocomplete and search by meaning on the built-in engine.
- Git status and commits work, with the author from Settings.
- The engine and every model it started stop when Hearth quits, and when it is force quit.
- It opens normally after a Force Quit. Electron's App Store build leaves its single-instance lock behind after one, and Hearth clears it.
- No file in the app carries the quarantine attribute, which App Store Connect refuses. [scripts/after-pack.cjs](../scripts/after-pack.cjs) removes it.

On every push, CI also builds this edition on a fresh Mac and runs it in the sandbox ([tests/e2e/mas.spec.ts](../tests/e2e/mas.spec.ts)): it has to start as the store edition, and open again after a Force Quit.

Not tested yet, because it needs a real signature from the developer account:

- Reopening a folder after Hearth restarts (security-scoped bookmarks).
- The signed package and its upload.

TestFlight is the place to check both, before submitting.

## One-time setup in the developer account

1. In [App Store Connect](https://appstoreconnect.apple.com), open Business and accept any agreement waiting there. Uploads and submissions stop while one is pending.
2. In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources):
   - Identifiers: register an App ID for macOS with the explicit bundle ID `dev.myrhex.hearth`. It needs no extra capability.
   - Certificates: create an **Apple Distribution** certificate and a **Mac Installer Distribution** certificate, and install both in the login keychain. Xcode can create them in Settings, Accounts, Manage Certificates. An Apple Distribution certificate made earlier, for an iPhone app for example, works too.
   - Profiles: create a **Mac App Store Connect** distribution profile for `dev.myrhex.hearth` with the Apple Distribution certificate that is in your keychain, name it Hearth, and download it.
3. In App Store Connect, Apps, New App: platform macOS, the name (see the listing below), primary language English (U.S.), bundle ID `dev.myrhex.hearth`, and any SKU, for example `hearth-mac`.
4. Note the Team ID from Membership details. It never goes into the repository: the build reads it from the environment.

## Build and upload

```bash
APPLE_TEAM_ID=XXXXXXXXXX MAS_PROVISIONING_PROFILE=~/Downloads/Hearth.provisionprofile npm run dist:mas
```

This checks that both certificates are in the keychain, builds Hearth, fetches the engine for Apple silicon if needed, signs everything with the two certificates, and writes `release/mas-arm64/Hearth-<version>-mas-arm64.pkg`. macOS may ask to let `codesign` and `productbuild` use the certificates' keys: enter the Mac's login password and click Always Allow.

Upload that package with [Transporter](https://apps.apple.com/app/transporter/id1450874784): sign in, add the package, click Deliver. Once Apple has processed it, the build shows up in App Store Connect, in TestFlight and on the version page.

Each build is numbered with the time it was made, in UTC, like 2026.1027.1530. App Store Connect takes a Mac build only when its number is higher than every build uploaded before, whatever the version, so there is nothing to set by hand, even to upload the same version again.

To try the store edition without the account, `APPLE_TEAM_ID=XXXXXXXXXX npm run dist:mas-local` builds a sandboxed app signed ad hoc in `release/mas-arm64/Hearth.app`.

## Before submitting: TestFlight

Builds from `npm run dist:mas-local` share the store app's container, so on a Mac that ran them, first delete `~/Library/Containers/dev.myrhex.hearth`: TestFlight should start from nothing, like a new user.

Install the uploaded build with TestFlight, then:

1. Open a folder, quit Hearth and open it again. The folder should reopen without asking. If Hearth asks for the folder again, the bookmark did not work.
2. Download a model, ask the agent for a change, and commit it.
3. Delete a file from the file tree: it should land in the Trash. Then use Reveal in Finder on another one.
4. Quit with a model in memory, and check in Activity Monitor that no `llama-server` is left.

## The listing

| Field | Value |
| --- | --- |
| Name | Hearth. If it is taken: Hearth Code Editor |
| Subtitle | Code with AI on your Mac |
| Category | Developer Tools, and Productivity as the second |
| Price | Free |
| Keywords | `code editor,ai,local,offline,private,llm,agent,autocomplete,coding,programming,git,developer` |
| Support URL | https://github.com/Myrhex-x/Hearth/issues |
| Marketing URL | https://github.com/Myrhex-x/Hearth |
| Privacy Policy URL | https://github.com/Myrhex-x/Hearth/blob/main/PRIVACY.md |
| Copyright | 2026 Myrhex |
| App Privacy | Data Not Collected |
| Encryption | Standard encryption only. `ITSAppUsesNonExemptEncryption` is already false in the build. |
| Screenshots | [docs/app-store](app-store), five at 2880 by 1800 |

**Promotional text**

> Models now come built in: download one from the welcome screen, and the agent, autocomplete and search by meaning run on your Mac.

**Description**

> Hearth is a code editor for AI models that run on your own Mac. Your code, your questions and the answers never leave your computer. There is no account, and nothing to pay for.
>
> Models come built in. Hearth suggests one sized for your Mac's memory and downloads it in one click. Already use Ollama or LM Studio? Hearth finds their models on its own.
>
> The agent reads your project, searches it and makes the change you ask for. You review every change and can undo it, file by file.
>
> Autocomplete suggests the rest of the line, or the next few, as you type.
>
> Search by meaning finds code by what it does, not only by the words in it.
>
> Paste a screenshot of an error or a design, and a model that can see reads it.
>
> Source control: see what changed, stage, and commit with a message the model writes.
>
> Hearth is open source.
>
> Requirements: a Mac with Apple silicon. 8 GB of memory runs the smallest agent model, and 16 GB or more is better. Source control needs Xcode or the Command Line Tools.

**Age rating.** Answer Apple's questionnaire as it stands when you submit. Hearth has no web browsing, no sharing between users and no ads, but its chat runs open models that can write any text: say so wherever the questionnaire asks about AI or generated content.

## Notes for App Review

Paste this into App Review Information, Notes. Sign-in required: no.

> Hearth is a code editor whose AI models run entirely on this Mac. There is no account and no sign-in.
>
> To try it:
> 1. On the welcome screen, click the button under "A model for the agent". It suggests a model sized for this Mac's memory, downloaded from Hugging Face. For a quicker download, click All models and choose Qwen3 4B (2.5 GB).
> 2. Click Open a folder and choose any folder with some code in it.
> 3. In the panel on the right, type a request such as "Explain what this project does" and press Return.
>
> The model engine is llama.cpp's server (MIT license). It ships inside the app bundle, is signed with it and runs inside the sandbox. It accepts connections only from 127.0.0.1, on a random port, with a key known only to Hearth, which is why the app uses the network server entitlement. The files Hearth downloads are model weights: data that adds no code and changes no feature of the app.
>
> Hearth works on its own: Ollama and LM Studio are optional. Because of the sandbox, this edition has no terminal and its agent does not run commands; it reads and writes files only in folders the user opens. Source control uses the git that comes with Xcode or the Command Line Tools when the Mac has them, and says so when it does not.

## Each release

1. Release the version from GitHub as usual.
2. Run `npm run dist:mas` with the Team ID and profile, and upload the package with Transporter.
3. In App Store Connect, add a new macOS version with the same number, choose the build, write what is new, and submit.

## Good to know

- The store build is for Apple silicon only. An Intel build would need a universal app and a universal engine.
- Hearth needs macOS 13.3 or later, like the engine. The App Store reads this from the app.
- Source control counts on Xcode or the Command Line Tools being installed. If App Review objects to relying on them (guideline 2.4.5), the way out is to bundle git in this edition, or to use a git written in JavaScript.
- Keep the bundle ID and the team: the sandbox container, and with it the downloaded models and folder permissions, belong to them.
- On an individual developer account, the App Store shows the account holder's legal name as the seller. An organization account shows the organization's name.
