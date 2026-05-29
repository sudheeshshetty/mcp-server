# widget

**Required (build).** Embeddable chat micro-frontend.

```bash
pnpm --filter @mcp-chat-template/widget build
```

Output: `dist/chat-widget.js` — served by chat-api at `/chat-widget.js` or host on your CDN.

```html
<script src="http://localhost:8787/chat-widget.js" data-api-url="http://localhost:8787" defer></script>
```

Adds a **bottom-right chat bubble**; click to open the panel. No container `div` required (the script appends to `body`).

Optional: `data-title="Support"` and `data-container="my-chat"` to mount inside a specific element.

Full guide: [docs/GUIDE.md § Widget](../docs/GUIDE.md#6-the-micro-frontend-widget)
