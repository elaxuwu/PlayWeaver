# PlayWeaver

PlayWeaver is an AI-assisted web app that turns a plain-language game idea into:
1. A structured game design board
2. A node-based editor workflow
3. A generated playable HTML5 prototype

### **TEST IT HERE: https://playweaver.pages.dev/**

| **PlayWeaver Demo 2** - **Short version** | **PlayWeaver Demo 1** - **Full version** |
| :---: | :---: |
| [![PlayWeaver Demo 2 - Short version](https://i.ibb.co/cSjpMx8j/image.png)](https://youtu.be/y-FgiJwzyMM) | [![PlayWeaver Demo 1 - Full version](https://i.ibb.co/cSjpMx8j/image.png)](https://youtu.be/qRDpVFFkwbc) |

## What This Project Includes

- Landing page with guided idea input and onboarding
- AI chat flow to collect 8 core game design fields
- Node-based editor with live graph manipulation
- Editor assistant that can add/edit/remove nodes and attach image references
- One-click prototype generation into a live iframe preview
- Account system (signup, login, password change)
- Saved project dashboard with pin and delete actions

## Tech Stack

- Frontend: Vanilla JavaScript, HTML, CSS, Tailwind CDN, **[Mobbin.com](https://mobbin.com/) (for inspiration)**
- Backend: Cloudflare Pages Functions
- AI providers:
	- **[Featherless.ai](https://featherless.ai/)** (for creation chat + editor assistant)
	- OpenAI-compatible proxy endpoint (for prototype generation)
- Data store: Upstash Redis REST API

## Project Structure

```
.
|- functions/
|  |- auth.js
|  |- chat.js
|  |- editor-chat.js
|  |- generate.js
|  |- state.js
|  \- api/
|     \- dashboard.js
|- public/
|  |- index.html
|  |- editor.html
|  |- dashboard.html
|  |- account.html
|  |- scripts.js
|  |- editor.js
|  |- dashboard.js
|  |- account.js
|  |- auth.js
|  |- styles.css
|  \- js/
|     \- brain.js
|- package.json
\- README.md
```

## Environment Variables

Set these in Cloudflare Pages project settings, or in a local `.dev.vars` file for local development.

| Variable | Required | Purpose |
|---|---|---|
| `FEATHERLESS_API_KEY` | Yes | Used by `functions/chat.js` and `functions/editor-chat.js` |
| `UPSTASH_REDIS_REST_URL` | Yes | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash Redis REST auth token |
| `OPENAI_PROXY_BASE_URL` | Yes | OpenAI-compatible base URL used by `functions/generate.js` |
| `OPENAI_PROXY_API_KEY` | Usually | Proxy API key (can be optional if proxy handles auth internally) |

Example `.dev.vars`:

```env
FEATHERLESS_API_KEY=your_featherless_key_here
UPSTASH_REDIS_REST_URL=https://your-upstash-url.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_upstash_token_here
OPENAI_PROXY_BASE_URL=https://your-proxy.workers.dev/v1
OPENAI_PROXY_API_KEY=your_proxy_key_here
```

Never commit `.dev.vars`.

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Add local environment variables

Create `.dev.vars` at project root (see example above).

### 3. Run Cloudflare Pages Functions locally

```bash
npx wrangler pages dev public --functions functions
```

Then open the local URL shown by Wrangler (commonly `http://localhost:8788`).

## API / Functions Overview

### `POST /chat`

Collects and normalizes the 8 required game-design fields:
- `gameName`
- `genre`
- `coreMechanic`
- `artStyle`
- `setting`
- `playerCharacter`
- `enemies`
- `winCondition`

### `POST /editor-chat`

Returns JSON actions for editor updates:
- `ADD_NODE`
- `REMOVE_NODE`
- `EDIT_NODE`
- `ADD_NOTE`
- `ADD_IMAGE_ASSET`

### `POST /generate`

Generates complete playable HTML based on game config, and can incrementally update existing HTML.

### `GET /state?id=...`

Loads a stored project state.

### `POST /state`

Saves project HTML, editor graph state, and game config with ownership checks.

### `POST /auth`

Supports auth actions:
- `signup`
- `login`
- `change_password`

### `GET /api/dashboard`

Returns current user profile + project list.

### `PATCH /api/dashboard`

Updates project metadata (currently pin/unpin).

### `DELETE /api/dashboard?id=...`

Deletes a project owned by the authenticated user.

## Authentication and Storage Notes

- Session token is stored client-side in `localStorage`.
- Session validity and ownership are enforced server-side in functions.
- Redis key namespaces include:
	- `playweaver:user:*`
	- `playweaver:user_id:*`
	- `playweaver:session:*`
	- `playweaver:state:*`
	- `playweaver:user_projects:*`

## Deployment

Deploy as a Cloudflare Pages project:
- Build command: none required for this static + functions setup
- Build output directory: `public`
- Functions directory: `functions`
- Add the environment variables listed above in Pages settings

## Team Notes

- Keep function responses JSON-serializable and explicit for frontend handling.
- Preserve strict JSON contracts for AI endpoints (`/chat` and `/editor-chat`) to avoid parser breaks.
- Avoid storing secrets in frontend files.

## License

Licensed under **PolyForm Noncommercial License 1.0.0**.

In simple terms, this is **similar** to **CC BY-NC 4.0**:

    Attribution: You must credit me.

    Non-Commercial: You cannot sell this or use it for business.

See [LICENSE](LICENSE) for the full legal text.

Commercial use is not permitted under this license.
