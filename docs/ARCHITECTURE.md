# Architecture

miniWhatsApp is designed as a small-footprint modular monolith.

## Runtime flow

Browser
  |
  +---- REST / JSON ----------------------+
  |                                      |
  +---- Socket.IO realtime --------------+
                                         v
                                Express application
                                         |
                      +------------------+------------------+
                      |                  |                  |
                     Auth         Conversations         Messages
                      |                  |                  |
                      +------------------+------------------+
                                         |
                                         v
                                      MongoDB

## Message flow

Client creates a UUID clientMessageId.
Socket event is authenticated and validated.
Message service checks conversation membership.
Message is persisted in MongoDB.
Server broadcasts message:new to the conversation room.
Client acknowledgement confirms the result.

The compound conversationId + clientMessageId index prevents accidental duplicate sends at the application layer.

## Realtime

Each authenticated socket joins a user room.
Conversation members join a conversation room.
Rooms are used for message, typing and read events.
Connection-state recovery is enabled for short temporary disconnects.
REST history remains the synchronization fallback.

## Security

Passwords use Node.js scrypt with random salts.
Sessions are opaque random tokens stored as SHA-256 hashes in MongoDB.
Session cookies use HttpOnly and SameSite=Lax; Secure is enabled in production.
Zod validates HTTP and Socket.IO payloads.
Helmet supplies security headers.
Rate limits protect public endpoints and authentication.
Message read/edit/delete paths verify conversation membership or message ownership.

## Scaling path

Keep the same domain modules while scaling infrastructure:

Load Balancer -> multiple Node.js + Socket.IO nodes -> shared realtime adapter -> Redis

Redis is intentionally not required by the baseline. Add it when multiple realtime nodes are actually needed.

## Test and CI path

Node test runner -> syntax checks -> GitHub Actions

The repository can later add integration and browser end-to-end tests without changing the core architecture.