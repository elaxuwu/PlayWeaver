# Hackathon_LovHack
this is a project for LovHack 2026!

### **VISIT THE PAGE HERE: https://playweaver.pages.dev/**

## Environment Variables

This project uses Cloudflare Pages Functions. The following environment variables must be set in your Cloudflare dashboard (or in a local `.dev.vars` file for development - **never commit this file**):

| Variable | Description |
|---|---|
| `FEATHERLESS_API_KEY` | API key for [Featherless AI](https://featherless.ai/) (used by chat and editor-chat functions) |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST API URL (used for auth and state storage) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST API token |
| `OPENAI_PROXY_BASE_URL` | Base URL for the OpenAI-compatible proxy used by the game generation function |
| `OPENAI_PROXY_API_KEY` | API key for the proxy (optional if the proxy handles its own authentication) |

### Local development

Create a `.dev.vars` file in the project root (this file is git-ignored):

```
FEATHERLESS_API_KEY=your_featherless_key_here
UPSTASH_REDIS_REST_URL=https://your-upstash-url.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_upstash_token_here
OPENAI_PROXY_BASE_URL=https://your-proxy.workers.dev/v1
OPENAI_PROXY_API_KEY=your_proxy_key_here
```
