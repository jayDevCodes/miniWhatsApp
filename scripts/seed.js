import { connectDatabase, disconnectDatabase } from '../src/db.js';
import { User, Conversation, Message } from '../src/models.js';
import { hashPassword } from '../src/security.js';

const password = 'Demo@12345';
const accounts = [
  { username: 'ram_transport', email: 'ram@example.com', displayName: 'Ram Transport' },
  { username: 'shyam_logistics', email: 'shyam@example.com', displayName: 'Shyam Logistics' },
];

await connectDatabase();

for (const account of accounts) {
  await User.updateOne(
    { email: account.email },
    { $setOnInsert: { ...account, passwordHash: await hashPassword(password) } },
    { upsert: true }
  );
}

const ram = await User.findOne({ username: 'ram_transport' });
const shyam = await User.findOne({ username: 'shyam_logistics' });

let conversation = await Conversation.findOne({
  type: 'direct',
  participants: { $all: [ram._id, shyam._id], $size: 2 },
});

if (!conversation) {
  conversation = await Conversation.create({ type: 'direct', participants: [ram._id, shyam._id] });
}

if (await Message.countDocuments({ conversationId: conversation._id }) === 0) {
  const seedMessages = [
    [ram, 'Pickup at 10:00 AM from warehouse A.'],
    [shyam, 'Confirm the loading bay on arrival.'],
    [ram, 'Documents are ready for dispatch.'],
  ];
  let lastMessage;
  for (const [sender, body] of seedMessages) {
    lastMessage = await Message.create({
      conversationId: conversation._id,
      senderId: sender._id,
      body,
      clientMessageId: 'seed-' + Date.now() + '-' + Math.random().toString(36).slice(2),
      readBy: [sender._id],
    });
  }
  await Conversation.updateOne(
    { _id: conversation._id },
    { $set: { lastMessageId: lastMessage._id, lastMessagePreview: lastMessage.body } }
  );
}

console.log('Seed complete.');
console.log('Demo password:', password);
await disconnectDatabase();