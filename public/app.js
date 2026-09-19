const state = { user: null, socket: null, conversations: [], activeConversationId: null, messages: new Map(), typingTimer: null };
const $ = (s) => document.querySelector(s);

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || 'Request failed');
  return data;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value == null ? '' : String(value);
  return div.innerHTML;
}

function renderMessages(messages) {
  const container = $('#messages');
  container.replaceChildren();
  if (!messages.length) {
    container.innerHTML = '<div class="empty">No messages yet. Send the first one.</div>';
    return;
  }
  for (const message of messages) {
    const own = message.senderId === state.user.id;
    const article = document.createElement('article');
    article.className = 'message ' + (own ? 'own' : '');
    article.dataset.id = message.id;
    const time = new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    article.innerHTML = '<div class="bubble">' + escapeHtml(message.deletedAt ? 'Message deleted' : message.body) + '</div><span class="meta">' + time + (message.editedAt ? ' · edited' : '') + '</span>';
    if (own && !message.deletedAt) article.ondblclick = () => editMessage(message);
    container.appendChild(article);
  }
  container.scrollTop = container.scrollHeight;
}

function upsertMessage(message) {
  const messages = state.messages.get(message.conversationId) || [];
  const index = messages.findIndex((item) => item.id === message.id);
  if (index === -1) messages.push(message);
  else messages[index] = message;
  state.messages.set(message.conversationId, messages);
  if (state.activeConversationId === message.conversationId) renderMessages(messages);
}

function renderConversations() {
  const list = $('#conversationList');
  list.replaceChildren();
  for (const conversation of state.conversations) {
    const button = document.createElement('button');
    button.className = 'conversation ' + (conversation.id === state.activeConversationId ? 'active' : '');
    const other = conversation.participants.find((p) => p.id !== state.user.id);
    const name = other?.displayName || other?.username || 'Conversation';
    button.innerHTML = '<strong>' + escapeHtml(name) + '</strong><span>' + escapeHtml(conversation.lastMessagePreview || 'No messages yet') + '</span>';
    button.onclick = () => openConversation(conversation);
    list.appendChild(button);
  }
}

async function loadConversations() {
  const data = await api('/api/conversations');
  state.conversations = data.conversations;
  renderConversations();
  if (!state.activeConversationId && state.conversations[0]) await openConversation(state.conversations[0]);
}

async function openConversation(conversation) {
  state.activeConversationId = conversation.id;
  renderConversations();
  const other = conversation.participants.find((p) => p.id !== state.user.id);
  $('#chatTitle').textContent = other?.displayName || other?.username || 'Conversation';
  $('#chatPresence').textContent = other ? '@' + other.username : 'Conversation';
  $('#messageInput').disabled = false;
  $('#messageForm button').disabled = false;
  state.socket?.emit('conversation:join', { conversationId: conversation.id });
  const data = await api('/api/conversations/' + conversation.id + '/messages?limit=100');
  state.messages.set(conversation.id, data.messages);
  renderMessages(data.messages);
  state.socket?.emit('message:read', { conversationId: conversation.id });
}

async function editMessage(message) {
  const body = window.prompt('Edit message', message.body);
  if (!body || body.trim() === message.body) return;
  try {
    const data = await api('/api/messages/' + message.id, { method: 'PATCH', body: JSON.stringify({ body }) });
    upsertMessage(data.message);
  } catch (error) {
    window.alert(error.message);
  }
}

async function createDirectConversation(userId) {
  const data = await api('/api/conversations/direct', { method: 'POST', body: JSON.stringify({ userId }) });
  state.conversations = [data.conversation, ...state.conversations.filter((c) => c.id !== data.conversation.id)];
  renderConversations();
  await openConversation(data.conversation);
}

function connectSocket() {
  state.socket = window.io({ withCredentials: true });
  state.socket.on('connect', () => {
    $('#connectionState').textContent = 'Live';
    $('#connectionState').className = 'connection live';
    if (state.activeConversationId) state.socket.emit('conversation:join', { conversationId: state.activeConversationId });
  });
  state.socket.on('disconnect', () => {
    $('#connectionState').textContent = 'Reconnecting…';
    $('#connectionState').className = 'connection';
  });
  state.socket.on('connect_error', (error) => {
    $('#connectionState').textContent = error.message === 'UNAUTHENTICATED' ? 'Sign in required' : 'Offline';
    $('#connectionState').className = 'connection';
  });
  state.socket.on('message:new', (message) => {
    upsertMessage(message);
    const conversation = state.conversations.find((c) => c.id === message.conversationId);
    if (conversation) {
      conversation.lastMessagePreview = message.body;
      renderConversations();
    } else {
      void loadConversations();
    }
  });
  state.socket.on('message:updated', upsertMessage);
  state.socket.on('message:deleted', upsertMessage);
  state.socket.on('typing:started', (data) => {
    if (data.conversationId === state.activeConversationId && data.userId !== state.user.id) $('#typingState').textContent = 'Typing…';
  });
  state.socket.on('typing:stopped', (data) => {
    if (data.conversationId === state.activeConversationId) $('#typingState').textContent = '';
  });
  state.socket.on('presence:changed', (data) => {
    const active = state.conversations.find((c) => c.id === state.activeConversationId);
    const other = active?.participants.find((p) => p.id === data.userId);
    if (other) $('#chatPresence').textContent = data.online ? 'Online' : 'Offline';
  });
}

async function boot() {
  try {
    const data = await api('/api/auth/me');
    state.user = data.user;
    $('#currentUser').textContent = '@' + state.user.username;
    $('#authPanel').classList.add('hidden');
    $('#appPanel').classList.remove('hidden');
    connectSocket();
    await loadConversations();
  } catch {
    $('#authPanel').classList.remove('hidden');
    $('#appPanel').classList.add('hidden');
  }
}

async function authenticate(event, mode) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
  try {
    const data = await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    state.user = data.user;
    await boot();
    event.currentTarget.reset();
    $('#authStatus').textContent = '';
  } catch (error) {
    $('#authStatus').textContent = error.message;
  }
}

$('#loginForm').addEventListener('submit', (event) => authenticate(event, 'login'));
$('#registerForm').addEventListener('submit', (event) => authenticate(event, 'register'));

$('#logoutButton').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  window.location.reload();
});

$('#messageForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const body = $('#messageInput').value.trim();
  if (!body || !state.activeConversationId || !state.socket?.connected) return;
  state.socket.emit('message:send', {
    conversationId: state.activeConversationId,
    body,
    clientMessageId: crypto.randomUUID(),
  }, (result) => {
    if (!result?.ok) window.alert(result?.error || 'Message failed');
  });
  $('#messageInput').value = '';
});

$('#messageInput').addEventListener('input', () => {
  if (!state.socket?.connected || !state.activeConversationId) return;
  state.socket.emit('typing:start', { conversationId: state.activeConversationId });
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => state.socket.emit('typing:stop', { conversationId: state.activeConversationId }), 700);
});

let searchTimer;
$('#userSearch').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const value = $('#userSearch').value.trim();
    const results = $('#searchResults');
    results.replaceChildren();
    if (value.length < 2) return;
    try {
      const data = await api('/api/users?search=' + encodeURIComponent(value));
      for (const user of data.users) {
        const button = document.createElement('button');
        button.className = 'search-result';
        button.innerHTML = '<strong>' + escapeHtml(user.displayName) + '</strong><span>@' + escapeHtml(user.username) + '</span>';
        button.onclick = async () => {
          await createDirectConversation(user.id);
          $('#userSearch').value = '';
          results.replaceChildren();
        };
        results.appendChild(button);
      }
    } catch {
      results.innerHTML = '<span class="muted">Search unavailable</span>';
    }
  }, 250);
});

void boot();
