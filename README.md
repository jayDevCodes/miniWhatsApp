# miniWhatsApp

Modern lightweight real-time messaging application built with Node.js, Express, MongoDB and Socket.IO.

## Modern architecture

Browser -> REST API + Socket.IO -> Express application -> services -> MongoDB

Domains are separated into authentication, users, conversations and messages. Realtime events use Socket.IO rooms, while message history remains available through the HTTP API.

## Features

- Session authentication with HttpOnly cookies
- Password hashing with Node.js scrypt
- Direct conversations and persistent message history
- Realtime messages, typing indicators and presence
- Idempotent message sends with client-generated IDs
- Short disconnect recovery with Socket.IO connection-state recovery
- Input validation with Zod
- Helmet security headers
- API rate limiting
- Centralized API error handling
- Responsive browser UI
- Node test runner and GitHub Actions CI

## Run locally

Requirements: Node.js 24 and MongoDB.

Install dependencies with npm install.
Start the app with npm run dev.
Open http://localhost:8080.

Optional demo data: npm run seed

Demo accounts after seeding:
ram@example.com
shyam@example.com
Password: Demo@12345

## API surface

Auth: POST /api/auth/register, POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
Users: GET /api/users?search=...
Conversations: GET /api/conversations, POST /api/conversations/direct
Messages: GET /api/conversations/:id/messages, POST /api/conversations/:id/messages, PATCH /api/messages/:id, DELETE /api/messages/:id
Health: GET /api/health

## Realtime events

conversation:join
message:send
message:edit
message:delete
message:read
typing:start
typing:stop
message:new
message:updated
message:deleted
presence:changed

## Engineering notes

This repository intentionally uses a modular monolith instead of microservices. That keeps deployment small while maintaining clear boundaries for future extraction or horizontal scaling.

Redis is not required for the baseline. A shared realtime adapter can be introduced when multiple application nodes are needed.

See docs/ARCHITECTURE.md for the detailed design.

License: ISC