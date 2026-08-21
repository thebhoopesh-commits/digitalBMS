export class ChatManager {
  private history: { role: string; content: string }[] = [];
  private chatDrawer: HTMLElement | null = null;
  private messageContainer: HTMLElement | null = null;
  private chatInput: HTMLInputElement | null = null;
  private isProcessing: boolean = false;

  private getZoneContext: (() => string) | null = null;

  constructor(getZoneContext?: () => string) {
    if (getZoneContext) {
      this.getZoneContext = getZoneContext;
    }
    if (typeof window !== 'undefined') {
      this.cacheDOMElements();
      this.setupListeners();
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

  public toggleDrawer(): void {
    if (this.chatDrawer) {
      if (this.chatDrawer.classList.contains('chat-centered')) {
        this.chatDrawer.classList.remove('chat-centered');
        // If it was centered, we just uncenter it (which returns it to the right side).
        // Optionally, we could hide it completely. We will let the toggle hide it.
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

  private appendMessage(role: 'user' | 'assistant', text: string) {
    if (!this.messageContainer) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg ${role}-msg`;
    msgDiv.textContent = text;
    this.messageContainer.appendChild(msgDiv);
    this.messageContainer.scrollTop = this.messageContainer.scrollHeight;
  }

  private setProcessingState(processing: boolean) {
    this.isProcessing = processing;
    if (this.chatInput) {
      this.chatInput.disabled = processing;
      this.chatInput.placeholder = processing ? 'AI is thinking...' : 'Type a complaint... (e.g. Too cold in lobby)';
    }
  }

  public async sendMessage(message: string): Promise<void> {
    this.appendMessage('user', message);
    this.setProcessingState(true);

    let backendMessage = message;
    
    // Check if the user is referring to their current location
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
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: backendMessage,
          history: this.history
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status}`);
      }

      const data = await response.json();
      
      this.appendMessage('assistant', data.response_text);
      
      // Update history (last 5 interactions to prevent context overflow)
      this.history.push({ role: 'user', content: message });
      this.history.push({ role: 'assistant', content: data.response_text });
      
      if (this.history.length > 10) {
        this.history = this.history.slice(this.history.length - 10);
      }

    } catch (err) {
      console.error('Chat error:', err);
      this.appendMessage('assistant', '⚠️ Connection to AI backend failed.');
    } finally {
      this.setProcessingState(false);
      if (this.chatInput && !this.chatDrawer?.classList.contains('hidden')) {
        this.chatInput.focus();
      }
    }
  }
}
