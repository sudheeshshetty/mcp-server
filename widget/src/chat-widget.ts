import './styles.css';

export type ChatWidgetOptions = {
  /** Chat API base URL (POST /chat). Example: http://localhost:8787 */
  apiUrl?: string;
  title?: string;
};

type ChatMessage = {
  role: 'user' | 'assistant' | 'error';
  text: string;
  toolsUsed?: string[];
};

const DEFAULT_API = 'http://localhost:8787';
const WIDGET_ROOT_ID = 'mcp-chat-widget';

const CHAT_ICON = `<svg class="mcp-chat__launcher-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4l4 4 4-4h4c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" fill="currentColor"/>
</svg>`;

export function mountChatWidget(
  container: HTMLElement,
  options: ChatWidgetOptions = {},
): () => void {
  const apiUrl = (options.apiUrl ?? DEFAULT_API).replace(/\/+$/, '');
  const title = options.title ?? 'Chat';

  container.innerHTML = '';

  const cssHref = `${apiUrl}/chat-widget.css`;
  if (!document.querySelector(`link[href="${cssHref}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssHref;
    document.head.appendChild(link);
  }

  const shell = document.createElement('div');
  shell.className = 'mcp-chat-widget';
  shell.innerHTML = `
    <button type="button" class="mcp-chat__launcher" aria-label="Open chat" aria-expanded="false">
      ${CHAT_ICON}
    </button>
    <div class="mcp-chat" role="dialog" aria-label="${title}" aria-hidden="true">
      <header class="mcp-chat__header">
        <div class="mcp-chat__header-text">
          <h2 class="mcp-chat__title"></h2>
          <p class="mcp-chat__subtitle">Ollama + MCP tools</p>
        </div>
        <button type="button" class="mcp-chat__close" aria-label="Close chat">&times;</button>
      </header>
      <div class="mcp-chat__messages" role="log" aria-live="polite"></div>
      <form class="mcp-chat__form">
        <input type="text" class="mcp-chat__input" placeholder="Say hi or ask about employees…" autocomplete="off" />
        <button type="submit" class="mcp-chat__send">Send</button>
      </form>
    </div>
  `;

  const launcher = shell.querySelector('.mcp-chat__launcher') as HTMLButtonElement;
  const panel = shell.querySelector('.mcp-chat') as HTMLElement;
  const closeBtn = shell.querySelector('.mcp-chat__close') as HTMLButtonElement;
  const titleEl = shell.querySelector('.mcp-chat__title') as HTMLElement;
  const messagesEl = shell.querySelector('.mcp-chat__messages') as HTMLElement;
  const form = shell.querySelector('.mcp-chat__form') as HTMLFormElement;
  const input = shell.querySelector('.mcp-chat__input') as HTMLInputElement;
  const sendBtn = shell.querySelector('.mcp-chat__send') as HTMLButtonElement;

  titleEl.textContent = title;

  const messages: ChatMessage[] = [];
  let isOpen = false;

  function setOpen(open: boolean) {
    isOpen = open;
    shell.classList.toggle('mcp-chat-widget--open', open);
    panel.classList.toggle('mcp-chat--open', open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      input.focus();
    }
  }

  function render() {
    messagesEl.innerHTML = '';
    for (const m of messages) {
      const bubble = document.createElement('div');
      bubble.className = `mcp-chat__bubble mcp-chat__bubble--${m.role}`;
      bubble.textContent = m.text;
      if (m.toolsUsed?.length) {
        const tools = document.createElement('div');
        tools.className = 'mcp-chat__tools';
        tools.textContent = `Tools: ${m.toolsUsed.join(', ')}`;
        bubble.appendChild(tools);
      }
      messagesEl.appendChild(bubble);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function send(text: string) {
    messages.push({ role: 'user', text });
    render();
    input.value = '';
    sendBtn.disabled = true;
    input.disabled = true;

    try {
      const res = await fetch(`${apiUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const body = (await res.json()) as {
        reply?: string;
        toolsUsed?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      messages.push({
        role: 'assistant',
        text: body.reply ?? '(empty)',
        toolsUsed: body.toolsUsed,
      });
    } catch (e) {
      messages.push({
        role: 'error',
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      sendBtn.disabled = false;
      input.disabled = false;
      input.focus();
      render();
    }
  }

  launcher.addEventListener('click', () => setOpen(true));
  closeBtn.addEventListener('click', () => setOpen(false));

  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && isOpen) setOpen(false);
  };
  document.addEventListener('keydown', onKeydown);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) void send(text);
  });

  container.appendChild(shell);
  render();

  return () => {
    document.removeEventListener('keydown', onKeydown);
    container.innerHTML = '';
  };
}

function findWidgetScript(): HTMLScriptElement | null {
  const byData = document.querySelector('script[data-api-url]');
  if (byData) return byData as HTMLScriptElement;
  const scripts = document.querySelectorAll('script[src*="chat-widget"]');
  return scripts.length ? (scripts[scripts.length - 1] as HTMLScriptElement) : null;
}

function resolveMountContainer(script: HTMLScriptElement | null): HTMLElement {
  const containerId = script?.dataset.container;
  if (containerId) {
    const el = document.getElementById(containerId);
    if (el) return el;
    console.warn(`[McpChatWidget] No element #${containerId}, using floating widget`);
  }

  let el = document.getElementById(WIDGET_ROOT_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = WIDGET_ROOT_ID;
    document.body.appendChild(el);
  }
  return el;
}

function autoInit(): void {
  const script = (document.currentScript as HTMLScriptElement | null) ?? findWidgetScript();
  const apiUrl = script?.dataset.apiUrl ?? DEFAULT_API;
  const title = script?.dataset.title;
  mountChatWidget(resolveMountContainer(script), { apiUrl, title });
}

if (typeof window !== 'undefined') {
  (window as Window & { McpChatWidget?: { mountChatWidget: typeof mountChatWidget } }).McpChatWidget =
    { mountChatWidget };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
}
