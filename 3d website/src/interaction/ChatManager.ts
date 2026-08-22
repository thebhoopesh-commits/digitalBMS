export class ChatManager {
  private history: { role: string; content: string }[] = [];
  private chatDrawer: HTMLElement | null = null;
  private messageContainer: HTMLElement | null = null;
  private chatInput: HTMLInputElement | null = null;
  private isProcessing: boolean = false;
  private typingBubble: HTMLElement | null = null;

  private getZoneContext: (() => string) | null = null;

  constructor(getZoneContext?: () => string) {
    if (getZoneContext) {
      this.getZoneContext = getZoneContext;
    }
    if (typeof window !== 'undefined') {
      this.cacheDOMElements();
      this.setupListeners();
      this.injectKeyboardHint();
      this.injectQuickPromptChips();
    }
  }

  private cacheDOMElements(): void {
    this.chatDrawer = document.getElementById('chat-drawer');
    this.messageContainer = document.getElementById('chat-messages');
    this.chatInput = document.getElementById('chat-input') as HTMLInputElement;
  }

  private setupListeners(): void {
    const chatForm = document.getElementById('chat-form');
    if (chatForm && this.chatInput) {
      chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = this.chatInput?.value.trim();
        if (msg && !this.isProcessing) {
          this.chatInput!.value = '';
          await this.sendMessage(msg);
        }
      });
    }

    const closeBtn = document.getElementById('btn-close-chat');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.toggleDrawer());
    }
  }

  /** Inject [C] keyboard shortcut badge into chat header */
  private injectKeyboardHint(): void {
    const header = document.querySelector('#chat-drawer .drawer-header');
    if (!header) return;
    const existing = header.querySelector('.chat-kbd-hint');
    if (existing) return;

    const hint = document.createElement('span');
    hint.className = 'chat-kbd-hint';
    hint.title = 'Press C or ESC to close';
    hint.textContent = 'ESC';
    // Insert before close button
    const closeBtn = header.querySelector('#btn-close-chat');
    if (closeBtn) {
      header.insertBefore(hint, closeBtn);
    } else {
      header.appendChild(hint);
    }
  }

  /** Inject 3 quick-prompt chips after the initial assistant greeting */
  private injectQuickPromptChips(): void {
    if (!this.messageContainer) return;
    const existing = document.getElementById('quick-prompt-chips');
    if (existing) return;

    const chips = document.createElement('div');
    chips.id = 'quick-prompt-chips';
    chips.className = 'quick-prompt-chips';

    const prompts = [
      { icon: '❄️', text: 'Too cold in the lobby' },
      { icon: '🔥', text: 'It\'s too warm at my desk' },
      { icon: '💨', text: 'The conference room feels stuffy' },
    ];

    prompts.forEach(({ icon, text }) => {
      const chip = document.createElement('button');
      chip.className = 'quick-prompt-chip';
      chip.innerHTML = `<span>${icon}</span> ${text}`;
      chip.addEventListener('click', async () => {
        if (this.isProcessing) return;
        // Hide chips after first use
        chips.style.opacity = '0';
        chips.style.pointerEvents = 'none';
        setTimeout(() => chips.remove(), 300);
        if (this.chatInput) this.chatInput.value = '';
        await this.sendMessage(text);
      });
      chips.appendChild(chip);
    });

    this.messageContainer.appendChild(chips);
  }

  public toggleDrawer(): void {
    if (this.chatDrawer) {
      if (this.chatDrawer.classList.contains('chat-centered')) {
        this.chatDrawer.classList.remove('chat-centered');
      }
      this.chatDrawer.classList.toggle('hidden');
      if (!this.chatDrawer.classList.contains('hidden') && this.chatInput) {
        this.chatInput.focus();
      }
    }
  }

  public isDrawerOpen(): boolean {
    return this.chatDrawer ? !this.chatDrawer.classList.contains('hidden') : false;
  }

  private appendMessage(role: 'user' | 'assistant', text: string): HTMLElement {
    if (!this.messageContainer) return document.createElement('div');
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg ${role}-msg`;
    msgDiv.textContent = text;
    this.messageContainer.appendChild(msgDiv);
    this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    return msgDiv;
  }

  /** Show animated 3-dot typing bubble */
  private showTypingBubble(): void {
    if (!this.messageContainer || this.typingBubble) return;
    const bubble = document.createElement('div');
    bubble.className = 'chat-msg assistant-msg typing-bubble';
    bubble.innerHTML = `<span></span><span></span><span></span>`;
    this.messageContainer.appendChild(bubble);
    this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    this.typingBubble = bubble;
  }

  /** Remove typing bubble */
  private removeTypingBubble(): void {
    if (this.typingBubble) {
      this.typingBubble.remove();
      this.typingBubble = null;
    }
  }

  /** Append a small HVAC applied badge below a message element */
  private appendHVACBadge(parentMsg: HTMLElement, events: any[]): void {
    if (!events || events.length === 0) return;
    const ev = events[0];
    const zone = (ev.zone_id || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    const intent = ev.intent || '';
    const isHeat = intent === 'too_cold';
    const isCool = intent === 'too_warm';
    const icon = isHeat ? '🔥' : isCool ? '❄️' : '⚡';
    const action = isHeat ? 'Heating adjusted' : isCool ? 'Cooling adjusted' : 'HVAC adjusted';
    const colorClass = isHeat ? 'badge-heat' : isCool ? 'badge-cool' : 'badge-neutral';

    const badge = document.createElement('div');
    badge.className = `hvac-applied-badge ${colorClass}`;
    badge.innerHTML = `${icon} <strong>${action}</strong> — ${zone}`;
    parentMsg.insertAdjacentElement('afterend', badge);
    if (this.messageContainer) {
      this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
    }
  }

  private setProcessingState(processing: boolean) {
    this.isProcessing = processing;
    if (this.chatInput) {
      this.chatInput.disabled = processing;
      this.chatInput.placeholder = processing
        ? 'AI is thinking...'
        : 'Type a complaint... (e.g. Too cold in lobby)';
    }
  }

  public async sendMessage(message: string): Promise<void> {
    this.appendMessage('user', message);
    this.setProcessingState(true);
    this.showTypingBubble();

    let backendMessage = message;

    // Inject spatial context if user refers to their location
    const locationRegex = /\b(here|this room|this zone|this place|my location)\b/i;
    if (locationRegex.test(message) && this.getZoneContext) {
      const currentZone = this.getZoneContext();
      if (currentZone) {
        backendMessage = `${message}\n[System Context: The user's avatar is currently located in the "${currentZone}" zone. Apply this spatial context to the request.]`;
      }
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: backendMessage, history: this.history }),
      });

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status}`);
      }

      const data = await response.json();

      this.removeTypingBubble();
      const assistantMsg = this.appendMessage('assistant', data.response_text);

      // Show HVAC applied badge if action was taken
      if (data.applied && data.translation?.events?.length > 0) {
        this.appendHVACBadge(assistantMsg, data.translation.events);
      }

      // Keep last 5 exchanges in history
      this.history.push({ role: 'user', content: message });
      this.history.push({ role: 'assistant', content: data.response_text });
      if (this.history.length > 10) {
        this.history = this.history.slice(this.history.length - 10);
      }
    } catch (err) {
      console.error('Chat error:', err);
      this.removeTypingBubble();
      this.appendMessage('assistant', '⚠️ Connection to AI backend failed.');
    } finally {
      this.setProcessingState(false);
      if (this.chatInput && !this.chatDrawer?.classList.contains('hidden')) {
        this.chatInput.focus();
      }
    }
  }
}
